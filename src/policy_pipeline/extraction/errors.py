from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, status

from policy_pipeline.extraction.llm_clients import HostedEndpointDisabledError
from policy_pipeline.extraction.registry import (
    ExtractionRunConflictError,
    UnknownDocumentVersionError,
    UnknownModelConfigurationVersionError,
    UnknownPromptTemplateVersionError,
)
from policy_pipeline.extraction.runs import (
    DeletedDocumentVersionError,
    StructuredOutputRejectedError,
)


@dataclass(frozen=True)
class ExtractionErrorMapping:
    status_code: int
    detail: str
    audit_action: str | None = None
    audit_payload: dict[str, object] | None = None


def map_extraction_exception(
    exc: Exception,
    *,
    extraction_run_id: str,
    document_id: str,
    document_version_id: str | None = None,
    prompt_template_id: str,
    prompt_template_version: str,
    model_configuration_id: str,
    model_configuration_version: str,
) -> ExtractionErrorMapping | None:
    if isinstance(exc, ExtractionRunConflictError):
        return ExtractionErrorMapping(
            status_code=status.HTTP_409_CONFLICT,
            detail="Extraction Run already exists and cannot be overwritten.",
        )
    if isinstance(exc, UnknownDocumentVersionError):
        return ExtractionErrorMapping(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document Version was not found.",
        )
    if isinstance(exc, DeletedDocumentVersionError):
        return ExtractionErrorMapping(
            status_code=status.HTTP_410_GONE,
            detail="Document Version has been deleted.",
        )
    if isinstance(exc, UnknownPromptTemplateVersionError):
        return ExtractionErrorMapping(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Prompt Template version was not found.",
        )
    if isinstance(exc, UnknownModelConfigurationVersionError):
        return ExtractionErrorMapping(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Model Configuration version was not found.",
        )
    if isinstance(exc, HostedEndpointDisabledError):
        return ExtractionErrorMapping(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Hosted OpenAI-compatible endpoints are disabled by runtime "
                "configuration."
            ),
        )
    if isinstance(exc, StructuredOutputRejectedError):
        audit_payload: dict[str, object] = {
            "document_id": document_id,
            "prompt_template_id": prompt_template_id,
            "prompt_template_version": prompt_template_version,
            "model_configuration_id": model_configuration_id,
            "model_configuration_version": model_configuration_version,
            "attempt_count": exc.attempts,
            "failure_detail": exc.detail,
        }
        if document_version_id is not None:
            audit_payload["document_version_id"] = document_version_id
        return ExtractionErrorMapping(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Structured extraction output could not be validated after "
                f"{exc.attempts} attempts."
            ),
            audit_action="extraction_run.failed",
            audit_payload=audit_payload,
        )
    return None


def raise_extraction_http_exception(mapping: ExtractionErrorMapping) -> None:
    raise HTTPException(status_code=mapping.status_code, detail=mapping.detail)
