"""Authentication module — Google OIDC, Clerk, and optional dev signer."""

import time
from dataclasses import dataclass, field
from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)


class AuthError(Exception):
    """Raised when authentication fails."""

    pass


_ISSUER_TO_PROVIDER = {
    "https://accounts.google.com": "google",
    "accounts.google.com": "google",
}


@dataclass(frozen=True)
class UserClaims:
    sub: str
    email: str | None
    email_verified: bool | None
    name: str | None
    picture: str | None
    iss: str
    aud: str | list[str] | None
    exp: int

    @property
    def provider(self) -> str:
        if self.iss == settings.auth_dev_issuer:
            return "dev"
        return _ISSUER_TO_PROVIDER.get(self.iss, "unknown")

    @property
    def user_id(self) -> str:
        """Namespaced stable identifier: "{provider}:{sub}".

        Keeps `sub` spaces isolated across providers so adding a second OIDC
        provider later does not require a data migration.
        """
        return f"{self.provider}:{self.sub}"


@dataclass
class CachedJwks:
    fetched_at: float
    keys: dict[str, Any]


@dataclass
class Provider:
    """Per-issuer verification config.

    - `jwks_url` is set for providers whose keys must be fetched (Google).
    - `static_jwks` is set for providers whose keys are injected in-process
      (the dev signer).
    """

    name: str
    issuer: str
    audience: str
    verify_audience: bool = True
    authorized_parties: list[str] = field(default_factory=list)
    jwks_url: str | None = None
    static_jwks: dict[str, Any] | None = None
    # Only populated for the dev provider — never used for Google.
    _dev_private_pem: bytes | None = field(default=None, repr=False)
    _dev_kid: str | None = None


_jwks_cache: dict[str, CachedJwks] = {}
_providers: dict[str, Provider] = {}
_bearer_scheme = HTTPBearer(auto_error=False)


def register_provider(provider: Provider) -> None:
    _providers[provider.issuer] = provider
    _ISSUER_TO_PROVIDER[provider.issuer] = provider.name


def _google_provider() -> Provider:
    return Provider(
        name="google",
        issuer=settings.google_oidc_issuer,
        audience=settings.google_oidc_client_id,
        jwks_url=settings.google_oidc_jwks_url,
    )


def _clerk_provider() -> Provider | None:
    if not settings.clerk_oidc_issuer or not settings.clerk_oidc_jwks_url:
        return None

    authorized_parties = [
        item.strip() for item in settings.clerk_authorized_parties.split(",") if item.strip()
    ]

    return Provider(
        name="clerk",
        issuer=settings.clerk_oidc_issuer,
        audience="",
        verify_audience=False,
        authorized_parties=authorized_parties,
        jwks_url=settings.clerk_oidc_jwks_url,
    )


def _logto_provider() -> Provider | None:
    if not settings.logto_oidc_issuer or not settings.logto_oidc_jwks_url:
        return None
    return Provider(
        name="logto",
        issuer=settings.logto_oidc_issuer,
        audience=settings.logto_oidc_audience,
        verify_audience=bool(settings.logto_oidc_audience),
        jwks_url=settings.logto_oidc_jwks_url,
    )


def init_providers() -> None:
    """Register configured providers. Safe to call multiple times."""
    _providers.clear()
    _ISSUER_TO_PROVIDER.clear()
    _ISSUER_TO_PROVIDER.update(
        {
            "https://accounts.google.com": "google",
            "accounts.google.com": "google",
        }
    )
    register_provider(_google_provider())
    clerk = _clerk_provider()
    if clerk is not None:
        register_provider(clerk)
    logto = _logto_provider()
    if logto is not None:
        register_provider(logto)
    if settings.auth_dev_mode:
        dev = _build_dev_provider()
        register_provider(dev)
        log.warning(
            "AUTH_DEV_MODE=True — dev signer active with issuer=%s. DO NOT enable in production.",
            dev.issuer,
        )


def _build_dev_provider() -> Provider:
    """Generate an in-process RSA keypair for the dev provider."""
    import uuid

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_pem = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    jwk_dict = _public_pem_to_jwk(public_pem)
    kid = f"dev-{uuid.uuid4().hex[:12]}"
    jwk_dict["kid"] = kid
    jwk_dict["use"] = "sig"
    jwk_dict["alg"] = "RS256"

    return Provider(
        name="dev",
        issuer=settings.auth_dev_issuer,
        audience="dev-audience",
        static_jwks={"keys": [jwk_dict]},
        _dev_private_pem=private_pem,
        _dev_kid=kid,
    )


def _public_pem_to_jwk(public_pem: bytes) -> dict[str, Any]:
    """Serialize an RSA public key PEM to a JWK dict."""
    import json

    from cryptography.hazmat.primitives import serialization

    pub = serialization.load_pem_public_key(public_pem)
    # PyJWT exposes a public-key JWK serializer
    return json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(pub))


def mint_dev_token(
    sub: str, email: str | None = None, name: str | None = None, ttl_seconds: int = 3600
) -> str:
    """Sign a dev-only JWT with the in-process RSA key.

    Raises if AUTH_DEV_MODE is off or the dev provider is not registered.
    """
    if not settings.auth_dev_mode:
        raise AuthError("Dev mode is disabled")

    dev = _providers.get(settings.auth_dev_issuer)
    if dev is None or dev._dev_private_pem is None or dev._dev_kid is None:
        raise AuthError("Dev provider is not initialised")

    now = int(time.time())
    payload = {
        "sub": sub,
        "iss": dev.issuer,
        "aud": dev.audience,
        "exp": now + ttl_seconds,
        "iat": now,
    }
    if email:
        payload["email"] = email
        payload["email_verified"] = True
    if name:
        payload["name"] = name

    return jwt.encode(
        payload,
        dev._dev_private_pem,
        algorithm="RS256",
        headers={"kid": dev._dev_kid},
    )


async def _fetch_jwks(url: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        log.error("Failed to fetch JWKS from %s: %s", url, e)
        raise AuthError("Failed to fetch JWKS")


async def _get_jwk_for_kid(
    provider: Provider, kid: str, force_refresh: bool = False
) -> dict[str, Any] | None:
    """Look up a JWK by kid for the given provider.

    Static JWKS (dev provider) is an exact match, no fetch / TTL semantics.
    """
    if provider.static_jwks is not None:
        for key in provider.static_jwks.get("keys", []):
            if key.get("kid") == kid:
                return key
        return None

    assert provider.jwks_url is not None  # guaranteed for remote providers
    url = provider.jwks_url
    now = time.time()
    cached = _jwks_cache.get(url)

    needs_refresh = (
        not cached
        or force_refresh
        or (now - cached.fetched_at) > settings.auth_jwks_cache_ttl_seconds
    )

    if needs_refresh:
        jwks = await _fetch_jwks(url)
        _jwks_cache[url] = CachedJwks(fetched_at=now, keys=jwks)
        cached = _jwks_cache[url]

    for key in cached.keys.get("keys", []):
        if key.get("kid") == kid:
            return key

    return None


def _provider_for_token(token: str) -> Provider:
    try:
        unverified = jwt.decode(token, options={"verify_signature": False})
    except Exception as e:
        log.debug("Malformed JWT payload: %s", e)
        raise AuthError("Malformed token payload")

    iss = unverified.get("iss")
    if not iss:
        raise AuthError("Missing issuer in token")

    provider = _providers.get(iss)
    if provider is None:
        log.debug("Unknown issuer: %s", iss)
        raise AuthError("Invalid token issuer")
    return provider


async def verify_bearer_token(token: str) -> UserClaims:
    # Lazy init so tests that only touch auth.py still get a registered provider.
    if not _providers:
        init_providers()

    provider = _provider_for_token(token)

    try:
        unverified_header = jwt.get_unverified_header(token)
    except Exception as e:
        log.debug("Malformed JWT header: %s", e)
        raise AuthError("Malformed token header")

    kid = unverified_header.get("kid")
    if not kid:
        log.debug("Missing kid in JWT header")
        raise AuthError("Missing key ID in token")

    jwk = await _get_jwk_for_kid(provider, kid, force_refresh=False)

    if not jwk and provider.static_jwks is None:
        log.debug("Key ID %s not found in cache, forcing refresh", kid)
        jwk = await _get_jwk_for_kid(provider, kid, force_refresh=True)

    if not jwk:
        log.debug("Key ID %s not found in JWKS", kid)
        raise AuthError("Key ID not found in JWKS")

    try:
        kty = jwk.get("kty", "RSA")
        if kty == "EC":
            public_key = jwt.algorithms.ECAlgorithm.from_jwk(jwk)
        else:
            public_key = jwt.algorithms.RSAAlgorithm.from_jwk(jwk)
    except Exception as e:
        log.error("Failed to parse JWK: %s", e)
        raise AuthError("Invalid JWK format")

    alg = jwk.get("alg", "RS256")

    try:
        decode_options = {"require": ["exp", "iss", "sub"]}
        if provider.verify_audience:
            decode_options["require"].append("aud")

        payload = jwt.decode(
            token,
            key=public_key,
            algorithms=[alg],
            issuer=provider.issuer,
            audience=provider.audience if provider.verify_audience else None,
            leeway=settings.auth_allowed_clock_skew_seconds,
            options={
                "require": decode_options["require"],
                "verify_aud": provider.verify_audience,
            },
        )
    except jwt.ExpiredSignatureError:
        log.debug("Token is expired")
        raise AuthError("Token is expired")
    except jwt.InvalidIssuerError:
        log.debug("Invalid issuer")
        raise AuthError("Invalid token issuer")
    except jwt.InvalidAudienceError:
        log.debug("Invalid audience")
        raise AuthError("Invalid token audience")
    except Exception as e:
        log.debug("JWT verification failed: %s", e)
        raise AuthError("Invalid token signature or claims")

    if not payload.get("sub"):
        log.debug("Missing sub in token payload")
        raise AuthError("Missing subject in token")

    if provider.authorized_parties:
        azp = payload.get("azp")
        if azp and azp not in provider.authorized_parties:
            log.debug("Invalid authorized party")
            raise AuthError("Invalid token authorized party")

    return UserClaims(
        sub=payload["sub"],
        email=payload.get("email"),
        email_verified=payload.get("email_verified"),
        name=payload.get("name"),
        picture=payload.get("picture"),
        iss=payload["iss"],
        aud=payload.get("aud"),
        exp=payload["exp"],
    )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> UserClaims:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Missing or invalid authentication scheme")

    try:
        return await verify_bearer_token(credentials.credentials)
    except AuthError as e:
        raise HTTPException(status_code=401, detail=str(e))
