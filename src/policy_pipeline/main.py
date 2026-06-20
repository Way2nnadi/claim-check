from typing import Annotated

from fastapi import Depends, FastAPI, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from policy_pipeline.audit import AuditEventListResponse, list_audit_events, record_audit_event
from policy_pipeline.auth import require_roles
from policy_pipeline.config import get_settings
from policy_pipeline.database import get_session
from policy_pipeline.identity import AuthenticatedPrincipal, Role
from policy_pipeline.rule_store import create_rule
from policy_pipeline.rules import (
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


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.service_name)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "service": settings.service_name,
            "environment": settings.environment,
        }

    @app.get("/config")
    def config_smoke() -> dict[str, str | dict[str, str]]:
        return {
            "service": settings.service_name,
            "environment": settings.environment,
            "database": {
                "driver": settings.database.driver,
            },
        }

    class CandidateRuleApprovalRequest(BaseModel):
        rationale: str

    class CandidateRuleApprovalResponse(BaseModel):
        candidate_rule_id: str
        status: str
        recorded_by: str

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

    @app.post(
        "/candidate-rules/{candidate_rule_id}/approvals",
        response_model=CandidateRuleApprovalResponse,
        status_code=status.HTTP_201_CREATED,
    )
    def approve_candidate_rule(
        candidate_rule_id: str,
        approval: CandidateRuleApprovalRequest,
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER)),
        ],
        session: Annotated[Session, Depends(get_session)],
    ) -> CandidateRuleApprovalResponse:
        record_audit_event(
            session,
            action="candidate_rule.approved",
            actor_subject=principal.subject,
            actor_roles=[role.value for role in principal.roles],
            entity_type="candidate_rule",
            entity_id=candidate_rule_id,
            payload={"rationale": approval.rationale},
        )
        return CandidateRuleApprovalResponse(
            candidate_rule_id=candidate_rule_id,
            status="approved",
            recorded_by=principal.subject,
        )

    @app.post(
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

    @app.get("/audit-events", response_model=AuditEventListResponse)
    def get_audit_events(
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
        ],
        session: Annotated[Session, Depends(get_session)],
        entity_type: str | None = None,
        entity_id: str | None = None,
    ) -> AuditEventListResponse:
        del principal
        return AuditEventListResponse(
            items=list_audit_events(
                session,
                entity_type=entity_type,
                entity_id=entity_id,
            )
        )

    return app


app = create_app()
