from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from policy_pipeline.audit.events import record_audit_event
from policy_pipeline.auth.auth import require_roles
from policy_pipeline.auth.identity import AuthenticatedPrincipal, Role
from policy_pipeline.compiled_rule_sets.models import CompiledRuleSet, CompiledRuleSetListResponse
from policy_pipeline.compiled_rule_sets.store import (
    PolicyVersionNotFoundError,
    compile_policy_version,
    get_compiled_rule_set,
    get_compiled_rule_set_for_policy_version,
    list_compiled_rule_sets,
)
from policy_pipeline.shared.database import get_session

router = APIRouter()


@router.post(
    "/policy-versions/{policy_version_id}/compiled-rule-sets",
    response_model=CompiledRuleSet,
)
def create_compiled_rule_set(
    policy_version_id: str,
    response: Response,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> CompiledRuleSet:
    try:
        compiled_rule_set, created = compile_policy_version(
            session,
            policy_version_id=policy_version_id,
            compiled_by=principal.subject,
        )
    except PolicyVersionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Policy Version was not found.",
        ) from exc

    if created:
        record_audit_event(
            session,
            action="compiled_rule_set.created",
            actor_subject=principal.subject,
            actor_roles=[role.value for role in principal.roles],
            entity_type="compiled_rule_set",
            entity_id=compiled_rule_set.compiled_rule_set_id,
            payload={
                "policy_version_id": compiled_rule_set.policy_version_id,
                "summary": compiled_rule_set.summary.model_dump(mode="json"),
            },
            commit=False,
        )
        response.status_code = status.HTTP_201_CREATED
    else:
        response.status_code = status.HTTP_200_OK

    session.commit()
    return compiled_rule_set


@router.get(
    "/policy-versions/{policy_version_id}/compiled-rule-sets",
    response_model=CompiledRuleSetListResponse,
)
def list_compiled_rule_sets_for_policy_version(
    policy_version_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> CompiledRuleSetListResponse:
    del principal
    compiled_rule_set = get_compiled_rule_set_for_policy_version(
        session,
        policy_version_id=policy_version_id,
    )
    if compiled_rule_set is None:
        return CompiledRuleSetListResponse(items=[])
    return CompiledRuleSetListResponse(items=[compiled_rule_set])


@router.get("/compiled-rule-sets", response_model=CompiledRuleSetListResponse)
def list_compiled_rule_set_catalog(
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> CompiledRuleSetListResponse:
    del principal
    return CompiledRuleSetListResponse(items=list_compiled_rule_sets(session))


@router.get(
    "/compiled-rule-sets/{compiled_rule_set_id}",
    response_model=CompiledRuleSet,
)
def get_compiled_rule_set_detail(
    compiled_rule_set_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> CompiledRuleSet:
    del principal
    compiled_rule_set = get_compiled_rule_set(
        session,
        compiled_rule_set_id=compiled_rule_set_id,
    )
    if compiled_rule_set is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compiled Rule Set was not found.",
        )
    return compiled_rule_set
