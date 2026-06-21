import re
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
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
    PolicyVersionSnapshot,
    Rule,
    RuleCondition,
    RuleException,
    RuleOrigin,
    RuleOriginType,
    Scope,
)
from policy_pipeline.structured_policy_store import (
    NoApprovedRulesError,
    PolicyVersionConflictError,
    get_policy_version_snapshot,
    publish_policy_version,
)

_SNAPSHOT_FILENAME_UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def _snapshot_filename(policy_version_id: str) -> str:
    safe_stem = _SNAPSHOT_FILENAME_UNSAFE_CHARS.sub("_", policy_version_id).strip("._-")
    if not safe_stem:
        safe_stem = "policy-version"
    return f"{safe_stem}.json"


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

    class PolicyVersionPublishRequest(BaseModel):
        policy_version_id: str = Field(min_length=1)
        change_summary: str = Field(min_length=1)

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

    @app.post(
        "/policy-versions",
        response_model=PolicyVersionPublishResponse,
        status_code=status.HTTP_201_CREATED,
    )
    def create_policy_version(
        request: PolicyVersionPublishRequest,
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER)),
        ],
        session: Annotated[Session, Depends(get_session)],
    ) -> PolicyVersionPublishResponse:
        try:
            snapshot = publish_policy_version(
                session,
                policy_version_id=request.policy_version_id,
                change_summary=request.change_summary,
                published_by=principal.subject,
            )
        except PolicyVersionConflictError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Published Policy Versions are immutable and cannot be overwritten.",
            ) from exc
        except NoApprovedRulesError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Policy Version requires at least one approved Rule.",
            ) from exc

        record_audit_event(
            session,
            action="policy_version.published",
            actor_subject=principal.subject,
            actor_roles=[role.value for role in principal.roles],
            entity_type="policy_version",
            entity_id=request.policy_version_id,
            payload={
                "change_summary": request.change_summary,
                "rule_count": len(snapshot.rules),
            },
            commit=False,
        )
        session.commit()
        return PolicyVersionPublishResponse(
            policy_version_id=snapshot.policy_version_id,
            rule_count=len(snapshot.rules),
            status="published",
            published_by=snapshot.published_by,
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
        snapshot = get_policy_version_snapshot(
            session,
            policy_version_id=policy_version_id,
        )
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
    ) -> JSONResponse:
        del principal
        snapshot = get_policy_version_snapshot(
            session,
            policy_version_id=policy_version_id,
        )
        if snapshot is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Policy Version was not found.",
            )
        return JSONResponse(
            content=snapshot.model_dump(mode="json"),
            headers={
                "Content-Disposition": (
                    f'attachment; filename="{_snapshot_filename(policy_version_id)}"'
                )
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
