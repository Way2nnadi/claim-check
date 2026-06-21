import re
from datetime import UTC, datetime
from typing import Annotated

from fastapi import (
    Body,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from policy_pipeline.audit import AuditEventListResponse, list_audit_events, record_audit_event
from policy_pipeline.auth import require_roles
from policy_pipeline.config import get_settings
from policy_pipeline.database import get_session
from policy_pipeline.documents import (
    DocumentVersion,
    create_document_version,
    document_version_from_record,
    get_document_version,
    validate_upload_file,
)
from policy_pipeline.identity import AuthenticatedPrincipal, Role
from policy_pipeline.object_storage import get_object_storage
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


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _serialize_datetime(value: datetime | None) -> str | None:
    normalized = _as_utc(value)
    if normalized is None:
        return None
    return normalized.isoformat().replace("+00:00", "Z")


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
    def config_smoke() -> dict[str, str | dict[str, str | bool | None]]:
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

    class DocumentVersionDeletionRequest(BaseModel):
        reason: str = Field(min_length=1)

    @app.post(
        "/policy-documents/{document_id}/versions",
        response_model=DocumentVersion,
        status_code=status.HTTP_201_CREATED,
    )
    async def upload_policy_document_version(
        document_id: str,
        file: Annotated[UploadFile, File()],
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN)),
        ],
        session: Annotated[Session, Depends(get_session)],
        retention_until: Annotated[datetime | None, Form()] = None,
        retention_reason: Annotated[str | None, Form()] = None,
    ) -> DocumentVersion:
        filename, content_type = validate_upload_file(file)
        document_bytes = await file.read()
        document_version = create_document_version(
            session,
            document_id=document_id,
            filename=filename,
            content_type=content_type,
            document_bytes=document_bytes,
            retention_until=retention_until,
            retention_reason=retention_reason,
            commit=False,
        )
        record_audit_event(
            session,
            action="document_version.uploaded",
            actor_subject=principal.subject,
            actor_roles=[role.value for role in principal.roles],
            entity_type="document_version",
            entity_id=document_version.document_version_id,
            payload={
                "document_id": document_version.document_id,
                "filename": document_version.filename,
                "content_type": document_version.content_type,
                "size_bytes": document_version.size_bytes,
                "sha256": document_version.sha256,
                "retention_until": _serialize_datetime(document_version.retention_until),
                "retention_reason": document_version.retention_reason,
            },
            commit=False,
        )
        session.commit()
        return document_version

    @app.get("/policy-documents/{document_id}/versions/{document_version_id}")
    def download_policy_document_version(
        document_id: str,
        document_version_id: str,
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
        ],
        session: Annotated[Session, Depends(get_session)],
    ) -> Response:
        record = get_document_version(
            session,
            document_id=document_id,
            document_version_id=document_version_id,
        )
        if record is None:
            return Response(status_code=status.HTTP_404_NOT_FOUND)
        if record.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="Document Version has been deleted.",
            )

        document_bytes = get_object_storage().get_bytes(key=record.storage_key)
        record_audit_event(
            session,
            action="document_version.accessed",
            actor_subject=principal.subject,
            actor_roles=[role.value for role in principal.roles],
            entity_type="document_version",
            entity_id=record.document_version_id,
            payload={
                "document_id": record.document_id,
                "filename": record.filename,
            },
            commit=False,
        )
        session.commit()
        return Response(
            content=document_bytes,
            media_type=record.content_type,
            headers={"Content-Disposition": f'attachment; filename="{record.filename}"'},
        )

    @app.delete(
        "/policy-documents/{document_id}/versions/{document_version_id}",
        response_model=DocumentVersion,
    )
    def delete_policy_document_version(
        document_id: str,
        document_version_id: str,
        deletion: Annotated[DocumentVersionDeletionRequest, Body()],
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN)),
        ],
        session: Annotated[Session, Depends(get_session)],
    ) -> DocumentVersion:
        record = get_document_version(
            session,
            document_id=document_id,
            document_version_id=document_version_id,
        )
        if record is None:
            return Response(status_code=status.HTTP_404_NOT_FOUND)
        if record.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Document Version has already been deleted.",
            )
        retention_until = _as_utc(record.retention_until)
        if retention_until is not None and retention_until > _utc_now():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Document Version is retained until "
                    f"{_serialize_datetime(retention_until)} "
                    "and cannot be deleted yet."
                ),
            )

        get_object_storage().delete_bytes(key=record.storage_key)
        record.deleted_at = _utc_now()
        record.deleted_by = principal.subject
        record.deletion_reason = deletion.reason
        session.flush()
        record_audit_event(
            session,
            action="document_version.deleted",
            actor_subject=principal.subject,
            actor_roles=[role.value for role in principal.roles],
            entity_type="document_version",
            entity_id=record.document_version_id,
            payload={
                "document_id": record.document_id,
                "filename": record.filename,
                "retention_until": _serialize_datetime(retention_until),
                "deleted_at": _serialize_datetime(record.deleted_at),
                "reason": deletion.reason,
            },
            commit=False,
        )
        session.commit()
        return document_version_from_record(record)

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
