from __future__ import annotations

from datetime import UTC, datetime
from hashlib import sha256
from pathlib import PurePosixPath
from uuid import uuid4

from pydantic import BaseModel, Field
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from policy_pipeline.policy_documents.parsing import (
    SECTION_GAP,
    DocumentQualityGate,
    DocumentQualityGateRejectedError,
    DocumentTableExtraction,
    analyze_document,
    quality_gate_result,
    stable_section_id,
    table_extraction_result,
)
from policy_pipeline.shared.database import DocumentSectionRecord, DocumentVersionRecord
from policy_pipeline.shared.object_storage import get_object_storage


class DocumentSection(BaseModel):
    document_id: str
    document_version_id: str
    section_id: str
    heading_path: list[str] = Field(default_factory=list)
    content: str
    start_char: int
    end_char: int


class DocumentVersion(BaseModel):
    document_id: str
    document_version_id: str
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    created_at: datetime
    retention_until: datetime | None = None
    retention_reason: str | None = None
    deleted_at: datetime | None = None
    deleted_by: str | None = None
    deletion_reason: str | None = None
    quality_gate: DocumentQualityGate = Field(default_factory=quality_gate_result)
    table_extraction: DocumentTableExtraction = Field(default_factory=table_extraction_result)


def normalize_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def utc_now() -> datetime:
    return datetime.now(UTC)


def serialize_datetime(value: datetime | None) -> str | None:
    normalized = normalize_datetime(value)
    if normalized is None:
        return None
    return normalized.isoformat().replace("+00:00", "Z")


class DocumentVersionNotFoundError(Exception):
    pass


class DocumentVersionAlreadyDeletedError(Exception):
    pass


class DocumentVersionRetentionActiveError(Exception):
    def __init__(self, retention_until: datetime) -> None:
        self.retention_until = retention_until
        super().__init__(
            "Document Version is retained until "
            f"{serialize_datetime(retention_until)} and cannot be deleted yet."
        )


def create_document_version(
    session: Session,
    *,
    document_id: str,
    filename: str,
    content_type: str,
    document_bytes: bytes,
    retention_until: datetime | None = None,
    retention_reason: str | None = None,
    commit: bool = True,
) -> DocumentVersion:
    document_version_id = f"docv-{uuid4().hex}"
    content_hash = sha256(document_bytes).hexdigest()
    analysis = analyze_document(
        content_type=content_type,
        document_bytes=document_bytes,
    )
    if analysis.quality_gate.status == "rejected":
        raise DocumentQualityGateRejectedError(
            analysis.quality_gate.rejection_reason or "Document Quality Gate rejected upload."
        )

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
        retention_until=retention_until,
        retention_reason=retention_reason,
        quality_gate=analysis.quality_gate.model_dump(mode="json"),
        table_extraction=analysis.table_extraction.model_dump(mode="json"),
    )
    session.add(record)
    session.flush()

    section_start_char = 0
    for index, parsed_section in enumerate(analysis.sections):
        section_end_char = section_start_char + len(parsed_section.content)
        session.add(
            DocumentSectionRecord(
                document_version_id=document_version_id,
                section_id=stable_section_id(parsed_section.heading_path, parsed_section.content),
                document_id=document_id,
                heading_path=parsed_section.heading_path,
                content=parsed_section.content,
                start_char=section_start_char,
                end_char=section_end_char,
            )
        )
        section_start_char = section_end_char
        if index < len(analysis.sections) - 1:
            section_start_char += len(SECTION_GAP)

    if commit:
        session.commit()

    return document_version_from_record(record)


class DocumentVersionListResponse(BaseModel):
    items: list[DocumentVersion]


class DocumentSectionListResponse(BaseModel):
    items: list[DocumentSection]


class PolicyDocumentSummary(BaseModel):
    document_id: str
    latest_document_version_id: str
    latest_uploaded_at: datetime
    version_count: int = Field(ge=0)
    active_version_count: int = Field(ge=0)
    has_deleted_versions: bool = False


class PolicyDocumentListResponse(BaseModel):
    items: list[PolicyDocumentSummary]


def list_policy_document_summaries(
    session: Session,
    *,
    include_deleted: bool = False,
) -> list[PolicyDocumentSummary]:
    statement: Select[tuple[DocumentVersionRecord]] = select(DocumentVersionRecord).order_by(
        DocumentVersionRecord.created_at.desc(),
        DocumentVersionRecord.document_version_id.desc(),
    )
    records = session.scalars(statement).all()

    grouped: dict[str, list[DocumentVersionRecord]] = {}
    for record in records:
        grouped.setdefault(record.document_id, []).append(record)

    summaries: list[PolicyDocumentSummary] = []
    for document_id in sorted(grouped):
        versions = grouped[document_id]
        active_versions = [version for version in versions if version.deleted_at is None]
        has_deleted_versions = len(active_versions) < len(versions)
        latest_record = active_versions[0] if active_versions else versions[0]
        if not include_deleted and not active_versions:
            continue

        created_at = normalize_datetime(latest_record.created_at)
        assert created_at is not None

        summaries.append(
            PolicyDocumentSummary(
                document_id=document_id,
                latest_document_version_id=latest_record.document_version_id,
                latest_uploaded_at=created_at,
                version_count=len(versions),
                active_version_count=len(active_versions),
                has_deleted_versions=has_deleted_versions,
            )
        )

    return summaries


def list_document_versions(
    session: Session,
    *,
    document_id: str | None = None,
    include_deleted: bool = False,
) -> list[DocumentVersion]:
    statement: Select[tuple[DocumentVersionRecord]] = select(DocumentVersionRecord)
    if document_id is not None:
        statement = statement.where(DocumentVersionRecord.document_id == document_id)
    if not include_deleted:
        statement = statement.where(DocumentVersionRecord.deleted_at.is_(None))
    statement = statement.order_by(
        DocumentVersionRecord.created_at.desc(),
        DocumentVersionRecord.document_version_id.desc(),
    )
    return [
        document_version_from_record(record) for record in session.scalars(statement).all()
    ]


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


def delete_document_version(
    session: Session,
    *,
    document_id: str,
    document_version_id: str,
    reason: str,
    deleted_by: str,
) -> tuple[DocumentVersionRecord, DocumentVersion]:
    record = get_document_version(
        session,
        document_id=document_id,
        document_version_id=document_version_id,
    )
    if record is None:
        raise DocumentVersionNotFoundError()
    if record.deleted_at is not None:
        raise DocumentVersionAlreadyDeletedError()
    retention_until = normalize_datetime(record.retention_until)
    if retention_until is not None and retention_until > utc_now():
        raise DocumentVersionRetentionActiveError(retention_until)

    record.deleted_at = utc_now()
    record.deleted_by = deleted_by
    record.deletion_reason = reason
    session.flush()
    return record, document_version_from_record(record)


def purge_document_version_storage(record: DocumentVersionRecord) -> None:
    get_object_storage().delete_bytes(key=record.storage_key)


def document_version_from_record(record: DocumentVersionRecord) -> DocumentVersion:
    created_at = normalize_datetime(record.created_at)
    assert created_at is not None
    return DocumentVersion(
        document_id=record.document_id,
        document_version_id=record.document_version_id,
        filename=record.filename,
        content_type=record.content_type,
        size_bytes=record.size_bytes,
        sha256=record.sha256,
        created_at=created_at,
        retention_until=normalize_datetime(record.retention_until),
        retention_reason=record.retention_reason,
        deleted_at=normalize_datetime(record.deleted_at),
        deleted_by=record.deleted_by,
        deletion_reason=record.deletion_reason,
        quality_gate=DocumentQualityGate.model_validate(
            record.quality_gate or quality_gate_result().model_dump(mode="json")
        ),
        table_extraction=DocumentTableExtraction.model_validate(
            record.table_extraction or table_extraction_result().model_dump(mode="json")
        ),
    )


def list_document_sections(
    session: Session,
    *,
    document_id: str,
    document_version_id: str,
) -> list[DocumentSection]:
    statement: Select[tuple[DocumentSectionRecord]] = (
        select(DocumentSectionRecord)
        .where(
            DocumentSectionRecord.document_id == document_id,
            DocumentSectionRecord.document_version_id == document_version_id,
        )
        .order_by(DocumentSectionRecord.start_char, DocumentSectionRecord.section_id)
    )
    return [document_section_from_record(record) for record in session.scalars(statement)]


def document_section_from_record(record: DocumentSectionRecord) -> DocumentSection:
    return DocumentSection(
        document_id=record.document_id,
        document_version_id=record.document_version_id,
        section_id=record.section_id,
        heading_path=list(record.heading_path),
        content=record.content,
        start_char=record.start_char,
        end_char=record.end_char,
    )
