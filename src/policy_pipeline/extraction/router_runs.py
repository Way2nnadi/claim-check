from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from policy_pipeline.audit.events import record_audit_event
from policy_pipeline.auth.auth import require_roles
from policy_pipeline.auth.identity import AuthenticatedPrincipal, Role
from policy_pipeline.extraction.errors import (
    map_extraction_exception,
    raise_extraction_http_exception,
)
from policy_pipeline.extraction.registry import ExtractionRunListResponse, list_extraction_runs
from policy_pipeline.extraction.runs import ExtractionExecutionResult, execute_extraction_run
from policy_pipeline.policy_documents.service import (
    DocumentSectionListResponse,
    get_document_version,
    list_document_sections,
)
from policy_pipeline.shared.database import get_session

router = APIRouter()


class ExtractionRunCreateRequest(BaseModel):
    extraction_run_id: str = Field(min_length=1)
    prompt_template_id: str = Field(min_length=1)
    prompt_template_version: str = Field(min_length=1)
    model_configuration_id: str = Field(min_length=1)
    model_configuration_version: str = Field(min_length=1)


@router.get("/extraction-runs", response_model=ExtractionRunListResponse)
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


@router.get(
    "/policy-documents/{document_id}/versions/{document_version_id}/sections",
    response_model=DocumentSectionListResponse,
)
def list_document_version_sections(
    document_id: str,
    document_version_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> DocumentSectionListResponse:
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
    return DocumentSectionListResponse(
        items=list_document_sections(
            session,
            document_id=document_id,
            document_version_id=document_version_id,
        )
    )


@router.get(
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


@router.post(
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
    except Exception as exc:
        mapping = map_extraction_exception(
            exc,
            extraction_run_id=request.extraction_run_id,
            document_id=document_id,
            document_version_id=document_version_id,
            prompt_template_id=request.prompt_template_id,
            prompt_template_version=request.prompt_template_version,
            model_configuration_id=request.model_configuration_id,
            model_configuration_version=request.model_configuration_version,
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
                entity_id=request.extraction_run_id,
                payload=mapping.audit_payload,
                commit=False,
            )
            session.commit()
        raise_extraction_http_exception(mapping)
