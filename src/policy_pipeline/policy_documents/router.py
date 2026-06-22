from datetime import datetime
from typing import Annotated

from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from policy_pipeline.audit.events import record_audit_event
from policy_pipeline.auth.auth import require_roles
from policy_pipeline.auth.identity import AuthenticatedPrincipal, Role
from policy_pipeline.policy_documents.parsing import DocumentQualityGateRejectedError
from policy_pipeline.policy_documents.service import (
    DocumentVersion,
    DocumentVersionAlreadyDeletedError,
    DocumentVersionListResponse,
    DocumentVersionNotFoundError,
    DocumentVersionRetentionActiveError,
    PolicyDocumentListResponse,
    create_document_version,
    delete_document_version,
    get_document_version,
    list_document_versions,
    list_policy_document_summaries,
    normalize_datetime,
    purge_document_version_storage,
    serialize_datetime,
)
from policy_pipeline.policy_documents.upload_validation import validate_upload_file
from policy_pipeline.shared.database import get_session
from policy_pipeline.shared.object_storage import get_object_storage

router = APIRouter()


class DocumentVersionDeletionRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


@router.get("/policy-documents", response_model=PolicyDocumentListResponse)
def list_policy_documents(
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
    include_deleted: Annotated[bool, Query()] = False,
) -> PolicyDocumentListResponse:
    del principal
    return PolicyDocumentListResponse(
        items=list_policy_document_summaries(session, include_deleted=include_deleted)
    )


@router.get(
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


@router.post(
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
            "retention_until": serialize_datetime(document_version.retention_until),
            "retention_reason": document_version.retention_reason,
        },
        commit=False,
    )
    session.commit()
    return document_version


@router.get("/policy-documents/{document_id}/versions/{document_version_id}")
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


@router.delete(
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
    try:
        record, document_version = delete_document_version(
            session,
            document_id=document_id,
            document_version_id=document_version_id,
            reason=deletion.reason,
            deleted_by=principal.subject,
        )
    except DocumentVersionNotFoundError:
        return Response(status_code=status.HTTP_404_NOT_FOUND)
    except DocumentVersionAlreadyDeletedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Document Version has already been deleted.",
        ) from exc
    except DocumentVersionRetentionActiveError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    retention_until = normalize_datetime(record.retention_until)
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
            "retention_until": serialize_datetime(retention_until),
            "deleted_at": serialize_datetime(record.deleted_at),
            "reason": deletion.reason,
        },
        commit=False,
    )
    session.commit()
    # Persist the tombstone and audit trail before removing the source bytes.
    purge_document_version_storage(record)
    return document_version
