from typing import Annotated

from fastapi import Depends, FastAPI, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from policy_pipeline.audit import AuditEventListResponse, list_audit_events, record_audit_event
from policy_pipeline.auth import require_roles
from policy_pipeline.config import get_settings
from policy_pipeline.database import get_session
from policy_pipeline.identity import AuthenticatedPrincipal, Role


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
