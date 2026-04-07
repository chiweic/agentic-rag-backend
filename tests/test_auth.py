"""Tests for Google OIDC authentication module."""

import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.core import auth
from app.core.config import settings

# Generate a mock RSA keypair for testing
private_key = rsa.generate_private_key(
    public_exponent=65537,
    key_size=2048,
)
public_key = private_key.public_key()
private_pem = private_key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
)
public_pem = public_key.public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo,
)


def create_test_token(
    kid: str = "test-kid",
    sub: str = "test-sub",
    iss: str = "https://accounts.google.com",
    aud: str | None = "test-client-id",
    exp: int | None = None,
    email: str = "test@example.com",
    key: bytes = private_pem,
    algo: str = "RS256",
) -> str:
    """Generate a test JWT."""
    if exp is None:
        exp = int(time.time()) + 3600

    payload = {"sub": sub, "iss": iss, "exp": exp, "email": email}
    if aud is not None:
        payload["aud"] = aud
    headers = {"kid": kid}
    return jwt.encode(payload, key, algorithm=algo, headers=headers)


@pytest.fixture(autouse=True)
def setup_mock_jwks(monkeypatch: pytest.MonkeyPatch):
    """Set up fake config and mock JWKS fetch before each test."""
    settings.google_oidc_client_id = "test-client-id"
    settings.google_oidc_issuer = "https://accounts.google.com"
    settings.clerk_oidc_issuer = ""
    settings.clerk_oidc_jwks_url = ""
    settings.clerk_authorized_parties = ""

    import json

    jwk_dict = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(public_key))
    jwk_dict["kid"] = "test-kid"

    mock_jwks = {"keys": [jwk_dict]}

    async def mock_fetch_jwks(url: str) -> dict[str, Any]:
        return mock_jwks

    monkeypatch.setattr(auth, "_fetch_jwks", mock_fetch_jwks)
    auth._jwks_cache.clear()
    auth.init_providers()


@pytest.mark.asyncio
async def test_valid_token_returns_claims():
    token = create_test_token(aud="test-client-id")
    claims = await auth.verify_bearer_token(token)
    assert claims.sub == "test-sub"
    assert claims.email == "test@example.com"
    assert claims.iss == "https://accounts.google.com"


@pytest.mark.asyncio
async def test_expired_token_returns_401():
    token = create_test_token(aud="test-client-id", exp=int(time.time()) - 100)
    with pytest.raises(auth.AuthError) as exc:
        await auth.verify_bearer_token(token)
    assert "expired" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_wrong_issuer_returns_401():
    token = create_test_token(aud="test-client-id", iss="https://wrong.issuer")
    with pytest.raises(auth.AuthError):
        await auth.verify_bearer_token(token)


@pytest.mark.asyncio
async def test_wrong_audience_returns_401():
    token = create_test_token(aud="wrong-audience")
    with pytest.raises(auth.AuthError):
        await auth.verify_bearer_token(token)


@pytest.mark.asyncio
async def test_valid_clerk_token_returns_claims(monkeypatch: pytest.MonkeyPatch):
    settings.clerk_oidc_issuer = "https://clerk.test"
    settings.clerk_oidc_jwks_url = "https://clerk.test/.well-known/jwks.json"
    settings.clerk_authorized_parties = "http://localhost:3001"

    import json

    jwk_dict = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(public_key))
    jwk_dict["kid"] = "clerk-kid"

    async def mock_fetch_jwks(url: str) -> dict[str, Any]:
        if url == settings.clerk_oidc_jwks_url:
            return {"keys": [jwk_dict]}
        return {"keys": []}

    monkeypatch.setattr(auth, "_fetch_jwks", mock_fetch_jwks)
    auth._jwks_cache.clear()
    auth.init_providers()

    token = jwt.encode(
        {
            "sub": "clerk-user",
            "iss": settings.clerk_oidc_issuer,
            "exp": int(time.time()) + 3600,
            "email": "clerk@example.com",
            "azp": "http://localhost:3001",
        },
        private_pem,
        algorithm="RS256",
        headers={"kid": "clerk-kid"},
    )

    claims = await auth.verify_bearer_token(token)
    assert claims.sub == "clerk-user"
    assert claims.provider == "clerk"
    assert claims.user_id == "clerk:clerk-user"


@pytest.mark.asyncio
async def test_invalid_signature_returns_401():
    # Sign with a completely different key
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other_pem = other_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    token = create_test_token(aud="test-client-id", key=other_pem)
    with pytest.raises(auth.AuthError):
        await auth.verify_bearer_token(token)


@pytest.mark.asyncio
async def test_missing_kid_in_cache_triggers_refresh(monkeypatch: pytest.MonkeyPatch):
    token = create_test_token(kid="new-kid", aud="test-client-id")

    fetch_calls = 0

    # Provide the correct key during the refresh fetch
    import json

    jwk_dict = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(public_key))
    jwk_dict["kid"] = "new-kid"
    mock_jwks = {"keys": [jwk_dict]}

    async def mock_fetch_jwks(url: str) -> dict[str, Any]:
        nonlocal fetch_calls
        fetch_calls += 1
        return mock_jwks

    monkeypatch.setattr(auth, "_fetch_jwks", mock_fetch_jwks)

    # Initial populated cache with wrong kid, but not expired
    auth._jwks_cache.clear()
    auth._jwks_cache[settings.google_oidc_jwks_url] = auth.CachedJwks(
        fetched_at=time.time(), keys={"keys": [{"kid": "old-kid", "kty": "RSA"}]}
    )

    claims = await auth.verify_bearer_token(token)
    assert claims.sub == "test-sub"
    assert fetch_calls == 1

    # Should use cache for the second call
    await auth.verify_bearer_token(token)
    assert fetch_calls == 1


@pytest.mark.asyncio
async def test_stale_cache_no_fallback(monkeypatch: pytest.MonkeyPatch):
    token = create_test_token(aud="test-client-id")

    async def mock_fetch_jwks_error(url: str) -> dict[str, Any]:
        raise auth.AuthError("Network error")

    monkeypatch.setattr(auth, "_fetch_jwks", mock_fetch_jwks_error)

    # Initial populated cache, but expired
    import json

    jwk_dict = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(public_key))
    jwk_dict["kid"] = "test-kid"
    auth._jwks_cache[settings.google_oidc_jwks_url] = auth.CachedJwks(
        fetched_at=time.time() - settings.auth_jwks_cache_ttl_seconds - 100,
        keys={"keys": [jwk_dict]},
    )

    # The token is valid, and the key is in the stale cache, but because it's expired
    # and fetch fails, we should NOT fall back to the stale cache.
    with pytest.raises(auth.AuthError) as exc:
        await auth.verify_bearer_token(token)
    assert "Network error" in str(exc.value)


@pytest.mark.asyncio
async def test_get_current_user_dependency():
    token = create_test_token(aud="test-client-id")
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    claims = await auth.get_current_user(creds)
    assert claims.sub == "test-sub"


@pytest.mark.asyncio
async def test_get_current_user_missing_credentials():
    with pytest.raises(HTTPException) as exc:
        await auth.get_current_user(None)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_wrong_scheme():
    creds = HTTPAuthorizationCredentials(scheme="Basic", credentials="xyz")
    with pytest.raises(HTTPException) as exc:
        await auth.get_current_user(creds)
    assert exc.value.status_code == 401
