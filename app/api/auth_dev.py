"""Dev-only auth endpoints — present only when AUTH_DEV_MODE=True.

These endpoints let Playwright / integration tests mint signed JWTs without
going through Google. The router is only mounted when `settings.auth_dev_mode`
is True, so probes against a production server get a standard 404.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import AuthError, mint_dev_token
from app.core.logging import get_logger

log = get_logger(__name__)
router = APIRouter(tags=["auth-dev"])


class DevTokenRequest(BaseModel):
    sub: str = Field(..., min_length=1, max_length=128)
    email: str | None = None
    name: str | None = None
    ttl_seconds: int = Field(default=3600, ge=1, le=86400)


class DevTokenResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int


@router.post("/auth/dev-token", response_model=DevTokenResponse)
async def create_dev_token(request: DevTokenRequest) -> DevTokenResponse:
    try:
        token = mint_dev_token(
            sub=request.sub,
            email=request.email,
            name=request.name,
            ttl_seconds=request.ttl_seconds,
        )
    except AuthError as e:
        raise HTTPException(status_code=500, detail=str(e))

    log.info("Dev token issued for sub=%s", request.sub)
    return DevTokenResponse(
        access_token=token,
        expires_in=request.ttl_seconds,
    )
