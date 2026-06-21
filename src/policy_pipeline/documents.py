from __future__ import annotations

from hashlib import sha256
from pathlib import PurePosixPath
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from policy_pipeline.database import DocumentVersionRecord
from policy_pipeline.object_storage import get_object_storage

PDF_CONTENT_TYPE = "application/pdf"
DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
SUPPORTED_DOCUMENT_TYPES = {
    ".pdf": PDF_CONTENT_TYPE,
    ".docx": DOCX_CONTENT_TYPE,
}


class DocumentVersion(BaseModel):
    document_id: str
    document_version_id: str
    filename: str
    content_type: str
    size_bytes: int
    sha256: str


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


def create_document_version(
    session: Session,
    *,
    document_id: str,
    filename: str,
    content_type: str,
    document_bytes: bytes,
    commit: bool = True,
) -> DocumentVersion:
    document_version_id = f"docv-{uuid4().hex}"
    content_hash = sha256(document_bytes).hexdigest()
    storage_key = (
        PurePosixPath("policy-documents")
        / document_id
        / document_version_id
        / PurePosixPath(filename).name
    ).as_posix()

    get_object_storage().put_bytes(
        key=storage_key,
        data=document_bytes,
        content_type=content_type,
    )

    record = DocumentVersionRecord(
        document_version_id=document_version_id,
        document_id=document_id,
        filename=filename,
        content_type=content_type,
        storage_key=storage_key,
        size_bytes=len(document_bytes),
        sha256=content_hash,
    )
    session.add(record)
    session.flush()
    if commit:
        session.commit()

    return document_version_from_record(record)


def get_document_version(
    session: Session,
    *,
    document_id: str,
    document_version_id: str,
) -> DocumentVersionRecord | None:
    statement: Select[tuple[DocumentVersionRecord]] = select(DocumentVersionRecord).where(
        DocumentVersionRecord.document_id == document_id,
        DocumentVersionRecord.document_version_id == document_version_id,
    )
    return session.scalar(statement)


def document_version_from_record(record: DocumentVersionRecord) -> DocumentVersion:
    return DocumentVersion(
        document_id=record.document_id,
        document_version_id=record.document_version_id,
        filename=record.filename,
        content_type=record.content_type,
        size_bytes=record.size_bytes,
        sha256=record.sha256,
    )
