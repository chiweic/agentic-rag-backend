"""Tests for AUTH_DEV_MODE signer + /auth/dev-token endpoint."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.auth_dev import router as auth_dev_router
from app.core import auth
from app.core.config import settings


@pytest.fixture
def dev_mode_app(monkeypatch):
    """Spin up a minimal app with dev mode enabled and providers re-initialised."""
    monkeypatch.setattr(settings, "auth_dev_mode", True)
    auth.init_providers()

    app = FastAPI()
    app.include_router(auth_dev_router)
    return app


@pytest.fixture
async def dev_client(dev_mode_app):
    transport = ASGITransport(app=dev_mode_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_dev_token_endpoint_issues_usable_token(dev_client):
    resp = await dev_client.post(
        "/auth/dev-token",
        json={"sub": "alice", "email": "alice@test", "name": "Alice"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "Bearer"
    assert body["expires_in"] == 3600
    assert body["access_token"]

    # Token should verify through the standard verifier path
    claims = await auth.verify_bearer_token(body["access_token"])
    assert claims.sub == "alice"
    assert claims.email == "alice@test"
    assert claims.iss == settings.auth_dev_issuer
    assert claims.provider == "dev"
    assert claims.user_id == "dev:alice"


@pytest.mark.asyncio
async def test_dev_issued_token_verifies_via_standard_verifier(dev_mode_app):
    token = auth.mint_dev_token("bob", email="bob@test")
    claims = await auth.verify_bearer_token(token)
    assert claims.sub == "bob"
    assert claims.provider == "dev"


@pytest.mark.asyncio
async def test_mint_dev_token_raises_when_dev_mode_off(monkeypatch):
    monkeypatch.setattr(settings, "auth_dev_mode", False)
    auth.init_providers()
    with pytest.raises(auth.AuthError):
        auth.mint_dev_token("eve")


@pytest.mark.asyncio
async def test_dev_router_is_not_mounted_when_dev_mode_off(client):
    """The main app is built with AUTH_DEV_MODE=False by default, so
    /auth/dev-token must return 404 there (endpoint-existence probe)."""
    resp = await client.post("/auth/dev-token", json={"sub": "anyone"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_dev_key_cannot_masquerade_as_google(dev_mode_app, monkeypatch):
    """Signing with the dev private key but claiming iss=google must fail:
    the verifier routes by iss, so lookup goes to Google's JWKS where the
    dev kid does not exist."""
    import jwt as pyjwt

    dev = auth._providers[settings.auth_dev_issuer]

    # Pretend Google's JWKS is a fixed (empty-ish) response so no live fetch.
    async def fake_fetch(url):
        return {"keys": []}

    monkeypatch.setattr(auth, "_fetch_jwks", fake_fetch)
    auth._jwks_cache.clear()

    bogus = pyjwt.encode(
        {
            "sub": "attacker",
            "iss": "https://accounts.google.com",
            "aud": "any-aud",
            "exp": 9999999999,
        },
        dev._dev_private_pem,
        algorithm="RS256",
        headers={"kid": dev._dev_kid},
    )
    with pytest.raises(auth.AuthError):
        await auth.verify_bearer_token(bogus)
