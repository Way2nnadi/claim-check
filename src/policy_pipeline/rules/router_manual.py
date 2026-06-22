from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from policy_pipeline.audit.events import record_audit_event
from policy_pipeline.auth.auth import require_roles
from policy_pipeline.auth.identity import AuthenticatedPrincipal, Role
from policy_pipeline.rules.models import (
    Applicability,
    Citation,
    EnforceabilityClass,
    LifecycleState,
    Rule,
    RuleCondition,
    RuleException,
    RuleOrigin,
    RuleOriginType,
    Scope,
)
from policy_pipeline.rules.store import create_rule
from policy_pipeline.shared.database import get_session

router = APIRouter()


class ManualRuleCreateRequest(BaseModel):
    rule_id: str = Field(min_length=1)
    statement: str = Field(min_length=1)
    enforceability_class: EnforceabilityClass
    rationale: str = Field(min_length=1)
    scope: Scope
    citation: Citation | None = None
    condition: RuleCondition | None = None
    applicability: Applicability | None = None
    exceptions: list[RuleException] = Field(default_factory=list)


@router.post(
    "/rules/manual",
    response_model=Rule,
    status_code=status.HTTP_201_CREATED,
)
def create_manual_rule(
    request: ManualRuleCreateRequest,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> Rule:
    rule = Rule(
        rule_id=request.rule_id,
        statement=request.statement,
        enforceability_class=request.enforceability_class,
        lifecycle_state=LifecycleState.APPROVED,
        origin=RuleOrigin(
            source_type=RuleOriginType.MANUAL,
            rationale=request.rationale,
        ),
        scope=request.scope,
        citation=request.citation,
        condition=request.condition,
        applicability=request.applicability,
        exceptions=request.exceptions,
    )
    create_rule(session, rule=rule, commit=False)
    record_audit_event(
        session,
        action="rule.created",
        actor_subject=principal.subject,
        actor_roles=[role.value for role in principal.roles],
        entity_type="rule",
        entity_id=rule.rule_id,
        payload={
            "origin": rule.origin.source_type.value,
            "rationale": request.rationale,
            "has_citation": request.citation is not None,
        },
        commit=False,
    )
    session.commit()
    return rule
