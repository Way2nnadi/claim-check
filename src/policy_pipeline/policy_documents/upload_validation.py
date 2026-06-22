from __future__ import annotations

from pathlib import PurePosixPath

from fastapi import HTTPException, UploadFile, status

from policy_pipeline.policy_documents.parsing import SUPPORTED_DOCUMENT_TYPES


def validate_upload_file(file: UploadFile) -> tuple[str, str]:
    filename = file.filename or ""
    suffix = PurePosixPath(filename).suffix.lower()
    expected_content_type = SUPPORTED_DOCUMENT_TYPES.get(suffix)
    if expected_content_type is None or file.content_type != expected_content_type:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only native-digital PDF and DOCX Policy Documents are supported.",
        )

    safe_filename = PurePosixPath(filename).name
    return safe_filename, expected_content_type
