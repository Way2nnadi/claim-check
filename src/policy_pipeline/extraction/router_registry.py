from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from policy_pipeline.auth.auth import require_roles
from policy_pipeline.auth.identity import AuthenticatedPrincipal, Role
from policy_pipeline.extraction.registry import (
    ModelConfigurationListResponse,
    PromptTemplateListResponse,
    list_model_configurations,
    list_prompt_templates,
)
from policy_pipeline.shared.database import get_session

router = APIRouter()


@router.get("/prompt-templates", response_model=PromptTemplateListResponse)
def list_prompt_templates_endpoint(
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> PromptTemplateListResponse:
    del principal
    return PromptTemplateListResponse(items=list_prompt_templates(session))


@router.get("/model-configurations", response_model=ModelConfigurationListResponse)
def list_model_configurations_endpoint(
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> ModelConfigurationListResponse:
    del principal
    return ModelConfigurationListResponse(items=list_model_configurations(session))
