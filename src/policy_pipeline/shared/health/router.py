from typing import Annotated

from fastapi import APIRouter, Depends

from policy_pipeline.auth.auth import get_current_principal
from policy_pipeline.auth.identity import AuthenticatedPrincipal
from policy_pipeline.shared.config import get_settings

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.service_name,
        "environment": settings.environment,
    }


@router.get("/config")
def config_smoke() -> dict[str, str | dict[str, str | bool | None]]:
    settings = get_settings()
    return {
        "service": settings.service_name,
        "environment": settings.environment,
        "database": {
            "driver": settings.database.driver,
        },
        "object_storage": {
            "encryption_at_rest_required": (
                settings.object_storage_encryption_at_rest_required
            ),
            "server_side_encryption_algorithm": (
                settings.object_storage_server_side_encryption_algorithm
            ),
            "kms_key_id": settings.object_storage_kms_key_id,
        },
    }


@router.get("/me", response_model=AuthenticatedPrincipal)
def read_authenticated_principal(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> AuthenticatedPrincipal:
    return principal
