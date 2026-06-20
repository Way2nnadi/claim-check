from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from policy_pipeline.audit import (
    AuditEventListResponse,
    list_audit_events,
    record_audit_event,
)
from policy_pipeline.auth import require_roles
from policy_pipeline.config import get_settings
from policy_pipeline.database import get_session
from policy_pipeline.identity import AuthenticatedPrincipal, Role
from policy_pipeline.rules import PolicyVersionSnapshot
from policy_pipeline.structured_policy_store import (
    CandidateRuleNotFoundError,
    InvalidRuleLifecycleError,
    NoApprovedRulesError,
    PolicyVersionConflictError,
    get_policy_version_snapshot,
    publish_policy_version,
)
from policy_pipeline.structured_policy_store import (
    approve_candidate_rule as approve_candidate_rule_in_store,
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

    class PolicyVersionPublishRequest(BaseModel):
        policy_version_id: str
        change_summary: str

    class PolicyVersionPublishResponse(BaseModel):
        policy_version_id: str
        rule_count: int
        status: str
        published_by: str

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
        try:
            approved_rule = approve_candidate_rule_in_store(
                session,
                candidate_rule_id=candidate_rule_id,
            )
        except CandidateRuleNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Candidate Rule was not found.",
            ) from exc
        except InvalidRuleLifecycleError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Candidate Rule cannot be approved from lifecycle state '{exc.args[0]}'.",
            ) from exc

        record_audit_event(
            session,
            action="candidate_rule.approved",
            actor_subject=principal.subject,
            actor_roles=[role.value for role in principal.roles],
            entity_type="candidate_rule",
            entity_id=candidate_rule_id,
            payload={"rationale": approval.rationale},
            commit=False,
        )
        session.commit()
        return CandidateRuleApprovalResponse(
            candidate_rule_id=approved_rule.rule_id,
            status=approved_rule.lifecycle_state.value,
            recorded_by=principal.subject,
        )

    @app.post(
        "/policy-versions",
        response_model=PolicyVersionPublishResponse,
        status_code=status.HTTP_201_CREATED,
    )
    def publish_first_policy_version(
        publish_request: PolicyVersionPublishRequest,
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER)),
        ],
        session: Annotated[Session, Depends(get_session)],
    ) -> PolicyVersionPublishResponse:
        try:
            snapshot = publish_policy_version(
                session,
                policy_version_id=publish_request.policy_version_id,
                change_summary=publish_request.change_summary,
                published_by=principal.subject,
            )
        except PolicyVersionConflictError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Published Policy Versions are immutable and cannot be overwritten.",
            ) from exc
        except NoApprovedRulesError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="At least one approved Rule is required to publish a Policy Version.",
            ) from exc

        record_audit_event(
            session,
            action="policy_version.published",
            actor_subject=principal.subject,
            actor_roles=[role.value for role in principal.roles],
            entity_type="policy_version",
            entity_id=snapshot.policy_version_id,
            payload={"rule_ids": [rule.rule_id for rule in snapshot.rules]},
            commit=False,
        )
        session.commit()
        return PolicyVersionPublishResponse(
            policy_version_id=snapshot.policy_version_id,
            rule_count=len(snapshot.rules),
            status="published",
            published_by=principal.subject,
        )

    @app.get("/policy-versions/{policy_version_id}", response_model=PolicyVersionSnapshot)
    def get_policy_version(
        policy_version_id: str,
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
        ],
        session: Annotated[Session, Depends(get_session)],
    ) -> PolicyVersionSnapshot:
        del principal
        snapshot = get_policy_version_snapshot(session, policy_version_id=policy_version_id)
        if snapshot is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Policy Version was not found.",
            )
        return snapshot

    @app.get("/policy-versions/{policy_version_id}/snapshot")
    def export_policy_version_snapshot(
        policy_version_id: str,
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
        ],
        session: Annotated[Session, Depends(get_session)],
    ) -> Response:
        del principal
        snapshot = get_policy_version_snapshot(session, policy_version_id=policy_version_id)
        if snapshot is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Policy Version was not found.",
            )
        return Response(
            content=snapshot.model_dump_json(),
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="{policy_version_id}.json"'
            },
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
