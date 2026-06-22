from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from policy_pipeline.audit.events import record_audit_event
from policy_pipeline.auth.auth import require_roles
from policy_pipeline.auth.identity import AuthenticatedPrincipal, Role
from policy_pipeline.extraction.errors import (
    map_extraction_exception,
    raise_extraction_http_exception,
)
from policy_pipeline.policy_documents.parsing import DocumentQualityGateRejectedError
from policy_pipeline.policy_documents.service import serialize_datetime
from policy_pipeline.policy_documents.upload_validation import validate_upload_file
from policy_pipeline.reingestion.workflow import ReingestionResult, reingest_document
from policy_pipeline.shared.database import get_session

router = APIRouter()


@router.post(
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
    except Exception as exc:
        mapping = map_extraction_exception(
            exc,
            extraction_run_id=extraction_run_id,
            document_id=document_id,
            prompt_template_id=prompt_template_id,
            prompt_template_version=prompt_template_version,
            model_configuration_id=model_configuration_id,
            model_configuration_version=model_configuration_version,
        )
        if mapping is None:
            raise
        if mapping.audit_action is not None and mapping.audit_payload is not None:
            record_audit_event(
                session,
                action=mapping.audit_action,
                actor_subject=principal.subject,
                actor_roles=[role.value for role in principal.roles],
                entity_type="extraction_run",
                entity_id=extraction_run_id,
                payload=mapping.audit_payload,
                commit=False,
            )
            session.commit()
        raise_extraction_http_exception(mapping)

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
            "retention_until": serialize_datetime(result.document_version.retention_until),
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
