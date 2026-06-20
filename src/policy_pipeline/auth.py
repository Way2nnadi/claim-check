from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from policy_pipeline.config import get_settings
from policy_pipeline.identity import AuthenticatedPrincipal, Role

http_bearer = HTTPBearer(auto_error=False)


def get_current_principal(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(http_bearer)],
) -> AuthenticatedPrincipal:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided.",
        )

    settings = get_settings()
    identity = settings.local_identity_for_token(credentials.credentials)
    if identity is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials are invalid.",
        )

    return AuthenticatedPrincipal(
        subject=identity.subject,
        roles=identity.roles,
    )


def require_roles(*allowed_roles: Role):
    allowed = set(allowed_roles)

    def dependency(
        principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    ) -> AuthenticatedPrincipal:
        if not allowed.intersection(principal.roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this resource.",
            )
        return principal

    return dependency
