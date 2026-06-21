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
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from policy_pipeline.audit import AuditEventListResponse, list_audit_events, record_audit_event
from policy_pipeline.auth import get_current_principal, require_roles
from policy_pipeline.config import get_settings
from policy_pipeline.database import get_session
from policy_pipeline.documents import (
    DocumentQualityGateRejectedError,
    DocumentVersion,
    DocumentVersionListResponse,
    create_document_version,
    document_version_from_record,
    get_document_version,
    list_document_versions,
    validate_upload_file,
)
from policy_pipeline.extraction_registry import (
    ExtractionRunConflictError,
    ExtractionRunListResponse,
    UnknownDocumentVersionError,
    UnknownModelConfigurationVersionError,
    UnknownPromptTemplateVersionError,
    list_extraction_runs,
)
from policy_pipeline.extraction_runs import (
    DeletedDocumentVersionError,
    ExtractionExecutionResult,
    StructuredOutputRejectedError,
    execute_extraction_run,
)
from policy_pipeline.identity import AuthenticatedPrincipal, Role
from policy_pipeline.llm_clients import HostedEndpointDisabledError
from policy_pipeline.object_storage import get_object_storage
from policy_pipeline.reingestion import ReingestionResult, reingest_document
from policy_pipeline.rule_store import (
    CandidateRuleNotFoundError,
    CandidateRuleReviewListResponse,
    InvalidCandidateRuleApprovalError,
    InvalidCandidateRuleReviewError,
    InvalidCandidateRuleTransitionError,
    approve_candidate_rule_review,
    bulk_approve_candidate_rule_reviews,
    create_rule,
    get_candidate_rule_review,
    list_candidate_rule_reviews,
    reject_candidate_rule_review,
    update_candidate_rule_review,
)
from policy_pipeline.rules import (
    Applicability,
    CandidateRuleReview,
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
    PolicyVersionListResponse,
    get_policy_version_snapshot,
    list_policy_version_summaries,
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
    if settings.cors_allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_allowed_origins),
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["Authorization", "Content-Type"],
        )

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

    @app.get("/me", response_model=AuthenticatedPrincipal)
    def read_authenticated_principal(
        principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    ) -> AuthenticatedPrincipal:
        return principal

    class CandidateRuleApprovalRequest(BaseModel):
        rationale: str

    class CandidateRuleApprovalResponse(BaseModel):
        candidate_rule_id: str
        status: str
        recorded_by: str

    class BulkCandidateRuleApprovalRequest(BaseModel):
        candidate_rule_ids: list[str] = Field(min_length=1)
        rationale: str = Field(min_length=1)

        @model_validator(mode="after")
        def validate_candidate_rule_ids(self) -> "BulkCandidateRuleApprovalRequest":
            if any(not candidate_rule_id for candidate_rule_id in self.candidate_rule_ids):
                raise ValueError("Bulk approval requires non-empty Candidate Rule ids.")
            return self

    class BulkCandidateRuleApprovalResponse(BaseModel):
        approved_candidate_rule_ids: list[str]
        status: str
        recorded_by: str

    class CandidateRuleReviewUpdateRequest(BaseModel):
        statement: str | None = Field(default=None, min_length=1)
        enforceability_class: EnforceabilityClass | None = None
        scope: Scope | None = None
        citation: Citation | None = None
        condition: RuleCondition | None = None
        applicability: Applicability | None = None
        exceptions: list[RuleException] | None = None

        @model_validator(mode="after")
        def validate_requested_fields(self) -> "CandidateRuleReviewUpdateRequest":
            if not self.model_fields_set:
                raise ValueError("Candidate Rule review update requires at least one field.")
            return self

    class CandidateRuleRejectionRequest(BaseModel):
        reason: str = Field(min_length=1)

    class CandidateRuleRejectionResponse(BaseModel):
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

    class ExtractionRunCreateRequest(BaseModel):
        extraction_run_id: str = Field(min_length=1)
        prompt_template_id: str = Field(min_length=1)
        prompt_template_version: str = Field(min_length=1)
        model_configuration_id: str = Field(min_length=1)
        model_configuration_version: str = Field(min_length=1)

    class PolicyVersionPublishRequest(BaseModel):
        policy_version_id: str = Field(min_length=1)
        change_summary: str = Field(min_length=1)

    class PolicyVersionPublishResponse(BaseModel):
        policy_version_id: str
        rule_count: int
        status: str
        published_by: str

    class DocumentVersionDeletionRequest(BaseModel):
        reason: str = Field(min_length=1, max_length=500)

    @app.get(
        "/policy-documents/{document_id}/versions",
        response_model=DocumentVersionListResponse,
    )
    def list_policy_document_versions(
        document_id: str,
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
        ],
        session: Annotated[Session, Depends(get_session)],
        include_deleted: Annotated[bool, Query()] = False,
    ) -> DocumentVersionListResponse:
        del principal
        return DocumentVersionListResponse(
            items=list_document_versions(
                session,
                document_id=document_id,
                include_deleted=include_deleted,
            )
        )

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
        retention_reason: Annotated[str | None, Form(max_length=500)] = None,
    ) -> DocumentVersion:
        filename, content_type = validate_upload_file(file)
        document_bytes = await file.read()
        try:
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
        except DocumentQualityGateRejectedError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=str(exc),
            ) from exc
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

    @app.post(
        "/policy-documents/{document_id}/reingestions",
        response_model=ReingestionResult,
        status_code=status.HTTP_201_CREATED,
    )
    async def reingest_policy_document(
        document_id: str,
        file: Annotated[UploadFile, File()],
        extraction_run_id: Annotated[str, Form(min_length=1)],
        prompt_template_id: Annotated[str, Form(min_length=1)],
        prompt_template_version: Annotated[str, Form(min_length=1)],
        model_configuration_id: Annotated[str, Form(min_length=1)],
        model_configuration_version: Annotated[str, Form(min_length=1)],
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN)),
        ],
        session: Annotated[Session, Depends(get_session)],
    ) -> ReingestionResult:
        filename, content_type = validate_upload_file(file)
        document_bytes = await file.read()
        try:
            result = reingest_document(
                session,
                document_id=document_id,
                filename=filename,
                content_type=content_type,
                document_bytes=document_bytes,
                extraction_run_id=extraction_run_id,
                prompt_template_id=prompt_template_id,
                prompt_template_version=prompt_template_version,
                model_configuration_id=model_configuration_id,
                model_configuration_version=model_configuration_version,
            )
        except DocumentQualityGateRejectedError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=str(exc),
            ) from exc
        except ExtractionRunConflictError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Extraction Run already exists and cannot be overwritten.",
            ) from exc
        except UnknownDocumentVersionError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document Version was not found.",
            ) from exc
        except DeletedDocumentVersionError as exc:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="Document Version has been deleted.",
            ) from exc
        except UnknownPromptTemplateVersionError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Prompt Template version was not found.",
            ) from exc
        except UnknownModelConfigurationVersionError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Model Configuration version was not found.",
            ) from exc
        except HostedEndpointDisabledError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    "Hosted OpenAI-compatible endpoints are disabled by runtime "
                    "configuration."
                ),
            ) from exc
        except StructuredOutputRejectedError as exc:
            session.commit()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    "Structured extraction output could not be validated after "
                    f"{exc.attempts} attempts."
                ),
            ) from exc

        record_audit_event(
            session,
            action="document_version.uploaded",
            actor_subject=principal.subject,
            actor_roles=[role.value for role in principal.roles],
            entity_type="document_version",
            entity_id=result.document_version.document_version_id,
            payload={
                "document_id": result.document_version.document_id,
                "filename": result.document_version.filename,
                "content_type": result.document_version.content_type,
                "size_bytes": result.document_version.size_bytes,
                "sha256": result.document_version.sha256,
                "retention_until": _serialize_datetime(result.document_version.retention_until),
                "retention_reason": result.document_version.retention_reason,
            },
            commit=False,
        )
        record_audit_event(
            session,
            action="extraction_run.created",
            actor_subject=principal.subject,
            actor_roles=[role.value for role in principal.roles],
            entity_type="extraction_run",
            entity_id=result.extraction_run.extraction_run_id,
            payload={
                "document_id": document_id,
                "document_version_id": result.extraction_run.document_version_id,
                "prompt_template_id": result.extraction_run.prompt_template_id,
                "prompt_template_version": result.extraction_run.prompt_template_version,
                "model_configuration_id": result.extraction_run.model_configuration_id,
                "model_configuration_version": result.extraction_run.model_configuration_version,
                "attempt_count": result.extraction_run.attempt_count,
                "candidate_rule_count": len(result.extraction_run.candidate_rules),
            },
            commit=False,
        )
        session.commit()
        return result

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
        # Persist the tombstone and audit trail before removing the source bytes.
        get_object_storage().delete_bytes(key=record.storage_key)
        return document_version_from_record(record)

    @app.get(
        "/policy-documents/{document_id}/versions/{document_version_id}/extraction-runs",
        response_model=ExtractionRunListResponse,
    )
    def list_document_extraction_runs(
        document_id: str,
        document_version_id: str,
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
        ],
        session: Annotated[Session, Depends(get_session)],
    ) -> ExtractionRunListResponse:
        del principal
        record = get_document_version(
            session,
            document_id=document_id,
            document_version_id=document_version_id,
        )
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document Version was not found.",
            )
        return ExtractionRunListResponse(
            items=list_extraction_runs(
                session,
                document_id=document_id,
                document_version_id=document_version_id,
            )
        )

    @app.get("/extraction-runs", response_model=ExtractionRunListResponse)
    def list_extraction_runs_endpoint(
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
        ],
        session: Annotated[Session, Depends(get_session)],
        document_id: Annotated[str | None, Query()] = None,
        document_version_id: Annotated[str | None, Query()] = None,
    ) -> ExtractionRunListResponse:
        del principal
        return ExtractionRunListResponse(
            items=list_extraction_runs(
                session,
                document_id=document_id,
                document_version_id=document_version_id,
            )
        )

    @app.post(
        "/policy-documents/{document_id}/versions/{document_version_id}/extraction-runs",
        response_model=ExtractionExecutionResult,
        status_code=status.HTTP_201_CREATED,
    )
    def create_document_extraction_run(
        document_id: str,
        document_version_id: str,
        request: ExtractionRunCreateRequest,
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN)),
        ],
        session: Annotated[Session, Depends(get_session)],
    ) -> ExtractionExecutionResult:
        try:
            result = execute_extraction_run(
                session,
                extraction_run_id=request.extraction_run_id,
                document_id=document_id,
                document_version_id=document_version_id,
                prompt_template_id=request.prompt_template_id,
                prompt_template_version=request.prompt_template_version,
                model_configuration_id=request.model_configuration_id,
                model_configuration_version=request.model_configuration_version,
            )
            record_audit_event(
                session,
                action="extraction_run.created",
                actor_subject=principal.subject,
                actor_roles=[role.value for role in principal.roles],
                entity_type="extraction_run",
                entity_id=result.extraction_run_id,
                payload={
                    "document_id": document_id,
                    "document_version_id": result.document_version_id,
                    "prompt_template_id": result.prompt_template_id,
                    "prompt_template_version": result.prompt_template_version,
                    "model_configuration_id": result.model_configuration_id,
                    "model_configuration_version": result.model_configuration_version,
                    "attempt_count": result.attempt_count,
                    "candidate_rule_count": len(result.candidate_rules),
                },
                commit=False,
            )
            session.commit()
            return result
        except ExtractionRunConflictError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Extraction Run already exists and cannot be overwritten.",
            ) from exc
        except UnknownDocumentVersionError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document Version was not found.",
            ) from exc
        except DeletedDocumentVersionError as exc:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="Document Version has been deleted.",
            ) from exc
        except UnknownPromptTemplateVersionError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Prompt Template version was not found.",
            ) from exc
        except UnknownModelConfigurationVersionError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Model Configuration version was not found.",
            ) from exc
        except HostedEndpointDisabledError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    "Hosted OpenAI-compatible endpoints are disabled by runtime "
                    "configuration."
                ),
            ) from exc
        except StructuredOutputRejectedError as exc:
            session.commit()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    "Structured extraction output could not be validated after "
                    f"{exc.attempts} attempts."
                ),
            ) from exc

    @app.get(
        "/candidate-rules",
        response_model=CandidateRuleReviewListResponse,
    )
    def list_candidate_rules(
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
        ],
        session: Annotated[Session, Depends(get_session)],
        lifecycle_state: Annotated[list[LifecycleState] | None, Query()] = None,
        document_id: Annotated[str | None, Query()] = None,
        document_version_id: Annotated[str | None, Query()] = None,
        extraction_run_id: Annotated[str | None, Query()] = None,
    ) -> CandidateRuleReviewListResponse:
        del principal
        lifecycle_states = set(lifecycle_state) if lifecycle_state else None
        return CandidateRuleReviewListResponse(
            items=list_candidate_rule_reviews(
                session,
                lifecycle_states=lifecycle_states,
                document_id=document_id,
                document_version_id=document_version_id,
                extraction_run_id=extraction_run_id,
            )
        )

    @app.post(
        "/candidate-rules/{candidate_rule_id}/approvals",
        response_model=CandidateRuleApprovalResponse,
        status_code=status.HTTP_201_CREATED,
    )
    def approve_candidate_rule_endpoint(
        candidate_rule_id: str,
        approval: CandidateRuleApprovalRequest,
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER)),
        ],
        session: Annotated[Session, Depends(get_session)],
    ) -> CandidateRuleApprovalResponse:
        try:
            approve_candidate_rule_review(
                session,
                candidate_rule_id=candidate_rule_id,
                commit=False,
            )
        except CandidateRuleNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Candidate Rule was not found.",
            ) from exc
        except InvalidCandidateRuleTransitionError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Candidate Rule cannot transition from "
                    f"{exc.current_state.value} to {exc.target_state.value}."
                ),
            ) from exc
        except InvalidCandidateRuleApprovalError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=exc.detail,
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
            candidate_rule_id=candidate_rule_id,
            status="approved",
            recorded_by=principal.subject,
        )

    @app.post(
        "/candidate-rules/approvals/bulk",
        response_model=BulkCandidateRuleApprovalResponse,
    )
    def bulk_approve_candidate_rules_endpoint(
        approval: BulkCandidateRuleApprovalRequest,
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER)),
        ],
        session: Annotated[Session, Depends(get_session)],
    ) -> BulkCandidateRuleApprovalResponse:
        try:
            reviews = bulk_approve_candidate_rule_reviews(
                session,
                candidate_rule_ids=approval.candidate_rule_ids,
                commit=False,
            )
        except CandidateRuleNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Candidate Rule was not found.",
            ) from exc
        except InvalidCandidateRuleTransitionError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Candidate Rule cannot transition from "
                    f"{exc.current_state.value} to {exc.target_state.value}."
                ),
            ) from exc
        except InvalidCandidateRuleApprovalError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=exc.detail,
            ) from exc

        approved_candidate_rule_ids = [review.candidate_rule_id for review in reviews]
        for candidate_rule_id in approved_candidate_rule_ids:
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
        return BulkCandidateRuleApprovalResponse(
            approved_candidate_rule_ids=approved_candidate_rule_ids,
            status="approved",
            recorded_by=principal.subject,
        )

    @app.get(
        "/candidate-rules/{candidate_rule_id}",
        response_model=CandidateRuleReview,
    )
    def get_candidate_rule(
        candidate_rule_id: str,
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
        ],
        session: Annotated[Session, Depends(get_session)],
    ) -> CandidateRuleReview:
        del principal
        try:
            return get_candidate_rule_review(
                session,
                candidate_rule_id=candidate_rule_id,
            )
        except CandidateRuleNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Candidate Rule was not found.",
            ) from exc

    @app.patch(
        "/candidate-rules/{candidate_rule_id}",
        response_model=CandidateRuleReview,
    )
    def update_candidate_rule(
        candidate_rule_id: str,
        request: CandidateRuleReviewUpdateRequest,
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER)),
        ],
        session: Annotated[Session, Depends(get_session)],
    ) -> CandidateRuleReview:
        updated_fields = sorted(request.model_fields_set)
        try:
            review = update_candidate_rule_review(
                session,
                candidate_rule_id=candidate_rule_id,
                updates=request.model_dump(mode="json", exclude_unset=True),
                commit=False,
            )
        except CandidateRuleNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Candidate Rule was not found.",
            ) from exc
        except InvalidCandidateRuleTransitionError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Candidate Rule cannot transition from "
                    f"{exc.current_state.value} to {exc.target_state.value}."
                ),
            ) from exc
        except InvalidCandidateRuleReviewError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=exc.detail,
            ) from exc
        record_audit_event(
            session,
            action="candidate_rule.edited",
            actor_subject=principal.subject,
            actor_roles=[role.value for role in principal.roles],
            entity_type="candidate_rule",
            entity_id=candidate_rule_id,
            payload={
                "fields": updated_fields,
                "to_lifecycle_state": review.lifecycle_state.value,
            },
            commit=False,
        )
        session.commit()
        return review

    @app.post(
        "/candidate-rules/{candidate_rule_id}/rejections",
        response_model=CandidateRuleRejectionResponse,
    )
    def reject_candidate_rule(
        candidate_rule_id: str,
        rejection: CandidateRuleRejectionRequest,
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER)),
        ],
        session: Annotated[Session, Depends(get_session)],
    ) -> CandidateRuleRejectionResponse:
        try:
            reject_candidate_rule_review(
                session,
                candidate_rule_id=candidate_rule_id,
                commit=False,
            )
        except CandidateRuleNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Candidate Rule was not found.",
            ) from exc
        except InvalidCandidateRuleTransitionError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Candidate Rule cannot transition from "
                    f"{exc.current_state.value} to {exc.target_state.value}."
                ),
            ) from exc
        record_audit_event(
            session,
            action="candidate_rule.rejected",
            actor_subject=principal.subject,
            actor_roles=[role.value for role in principal.roles],
            entity_type="candidate_rule",
            entity_id=candidate_rule_id,
            payload={"reason": rejection.reason},
            commit=False,
        )
        session.commit()
        return CandidateRuleRejectionResponse(
            candidate_rule_id=candidate_rule_id,
            status="rejected",
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

    @app.get("/policy-versions", response_model=PolicyVersionListResponse)
    def list_policy_versions(
        principal: Annotated[
            AuthenticatedPrincipal,
            Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
        ],
        session: Annotated[Session, Depends(get_session)],
    ) -> PolicyVersionListResponse:
        del principal
        return PolicyVersionListResponse(items=list_policy_version_summaries(session))

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
