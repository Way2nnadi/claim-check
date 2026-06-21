from __future__ import annotations

import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from difflib import SequenceMatcher
from enum import StrEnum
from hashlib import sha256
from io import BytesIO
from pathlib import PurePosixPath
from typing import Literal
from uuid import uuid4
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from fastapi import HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from pypdf import PdfReader
from pypdf.errors import PdfReadError, PdfStreamError
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from policy_pipeline.database import DocumentSectionRecord, DocumentVersionRecord
from policy_pipeline.object_storage import get_object_storage

PDF_CONTENT_TYPE = "application/pdf"
DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
SUPPORTED_DOCUMENT_TYPES = {
    ".pdf": PDF_CONTENT_TYPE,
    ".docx": DOCX_CONTENT_TYPE,
}
_WORDPROCESSINGML_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
_HEADING_STYLE_RE = re.compile(r"heading\s*(\d+)", re.IGNORECASE)
_SECTION_GAP = "\n\n"
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
_MAX_SECTION_ID_LENGTH = 255
_IMAGE_WARNING = "Embedded images are not supported and may contain uncaptured policy content."
_CHART_WARNING = "Embedded charts are not supported and may contain uncaptured policy content."
_EMBEDDING_WARNING = (
    "Embedded files are not supported and may contain uncaptured policy content."
)
_IMAGE_ONLY_PDF_REASON = (
    "Image-only PDFs are not supported because no extractable text was found."
)
_MALFORMED_PDF_REASON = (
    "Malformed PDF files are not supported because the file could not be parsed."
)
_MALFORMED_DOCX_REASON = (
    "Malformed DOCX files are not supported because the file could not be parsed."
)
_FUZZY_CITATION_MIN_RATIO = 0.82
_MONEY_AMOUNT_RE = re.compile(r"\$\s*(\d+(?:\.\d+)?)")


@dataclass(frozen=True)
class _DocumentLine:
    text: str
    heading_level: int | None = None


@dataclass(frozen=True)
class _ParsedSection:
    heading_path: list[str]
    content: str


class DocumentSection(BaseModel):
    document_id: str
    document_version_id: str
    section_id: str
    heading_path: list[str] = Field(default_factory=list)
    content: str
    start_char: int
    end_char: int


class DocumentQualityGate(BaseModel):
    status: Literal["passed", "rejected"]
    ingestion_confidence: float = Field(ge=0.0, le=1.0)
    table_extraction_confidence: float = Field(ge=0.0, le=1.0)
    unsupported_content_warnings: list[str] = Field(default_factory=list)
    rejection_reason: str | None = None


class ExtractedTableMetadata(BaseModel):
    table_id: str
    row_count: int
    column_count: int


class DocumentTableExtraction(BaseModel):
    table_count: int
    tables: list[ExtractedTableMetadata] = Field(default_factory=list)


class DocumentVersion(BaseModel):
    document_id: str
    document_version_id: str
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    retention_until: datetime | None = None
    retention_reason: str | None = None
    deleted_at: datetime | None = None
    deleted_by: str | None = None
    deletion_reason: str | None = None
    quality_gate: DocumentQualityGate = Field(default_factory=lambda: _quality_gate_result())
    table_extraction: DocumentTableExtraction = Field(
        default_factory=lambda: _table_extraction_result()
    )


class DocumentQualityGateRejectedError(Exception):
    pass


@dataclass(frozen=True)
class _DocumentAnalysis:
    sections: list[_ParsedSection]
    quality_gate: DocumentQualityGate
    table_extraction: DocumentTableExtraction


def _normalize_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class CitationAnchor(BaseModel):
    document_id: str
    document_version_id: str
    section_id: str
    quote: str
    start_char: int
    end_char: int


class CitationMatchKind(StrEnum):
    EXACT = "exact"
    CASE_INSENSITIVE = "case_insensitive"
    FLEXIBLE_WHITESPACE = "flexible_whitespace"
    FUZZY = "fuzzy"


@dataclass(frozen=True)
class CitationResolution:
    anchor: CitationAnchor
    match_kind: CitationMatchKind
    requested_quote: str


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


def _normalize_text(value: str) -> str:
    return " ".join(value.split())


def _slugify_heading(value: str) -> str:
    slug = _NON_ALNUM_RE.sub("-", value.strip().lower()).strip("-")
    return slug or "section"


def _stable_section_id(heading_path: list[str], content: str) -> str:
    slug = "--".join(_slugify_heading(part) for part in heading_path) or "section"
    content_hash = sha256(content.encode("utf-8")).hexdigest()[:12]
    section_id = f"{slug}-{content_hash}"
    if len(section_id) <= _MAX_SECTION_ID_LENGTH:
        return section_id

    heading_hash = sha256("\x1f".join(heading_path).encode("utf-8")).hexdigest()[:12]
    max_slug_length = _MAX_SECTION_ID_LENGTH - len(heading_hash) - len(content_hash) - 2
    truncated_slug = slug[:max_slug_length].rstrip("-") or "section"
    return f"{truncated_slug}-{heading_hash}-{content_hash}"


def _build_sections(lines: list[_DocumentLine]) -> list[_ParsedSection]:
    sections: list[_ParsedSection] = []
    heading_stack: list[str] = []
    current_heading_path: list[str] | None = None
    current_lines: list[str] = []

    def flush_current() -> None:
        nonlocal current_heading_path, current_lines
        if current_heading_path is None or not current_lines:
            return
        sections.append(
            _ParsedSection(
                heading_path=list(current_heading_path),
                content="\n".join(current_lines),
            )
        )
        current_heading_path = None
        current_lines = []

    for line in lines:
        if line.heading_level is not None:
            flush_current()
            heading_stack[:] = heading_stack[: line.heading_level - 1]
            heading_stack.append(line.text)
            current_heading_path = list(heading_stack)
            current_lines = [line.text]
            continue

        if current_heading_path is None:
            current_heading_path = ["Preamble"]
            current_lines = []
        current_lines.append(line.text)

    flush_current()
    return sections


def _quality_gate_result(
    *,
    status: Literal["passed", "rejected"] = "passed",
    ingestion_confidence: float = 0.0,
    table_extraction_confidence: float = 0.0,
    unsupported_content_warnings: list[str] | None = None,
    rejection_reason: str | None = None,
) -> DocumentQualityGate:
    return DocumentQualityGate(
        status=status,
        ingestion_confidence=ingestion_confidence,
        table_extraction_confidence=table_extraction_confidence,
        unsupported_content_warnings=list(unsupported_content_warnings or []),
        rejection_reason=rejection_reason,
    )


def _table_extraction_result(
    tables: list[ExtractedTableMetadata] | None = None,
) -> DocumentTableExtraction:
    extracted_tables = list(tables or [])
    return DocumentTableExtraction(
        table_count=len(extracted_tables),
        tables=extracted_tables,
    )


def _extract_pdf_lines(reader: PdfReader) -> list[tuple[str, float]]:
    pdf_lines: list[tuple[str, float]] = []

    def visitor(
        text: str,
        _cm: object,
        _tm: list[float],
        _font_dict: object,
        font_size: float,
    ) -> None:
        for part in text.splitlines():
            normalized = _normalize_text(part)
            if normalized:
                pdf_lines.append((normalized, font_size))

    for page in reader.pages:
        page.extract_text(visitor_text=visitor)

    return pdf_lines


def _build_pdf_sections(pdf_lines: list[tuple[str, float]]) -> list[_ParsedSection]:
    if not pdf_lines:
        return []

    font_counts = Counter(font_size for _, font_size in pdf_lines)
    max_count = max(font_counts.values())
    body_font_size = min(
        font_size for font_size, count in font_counts.items() if count == max_count
    )
    heading_sizes = sorted(
        {font_size for _, font_size in pdf_lines if font_size > body_font_size},
        reverse=True,
    )
    heading_levels = {font_size: index + 1 for index, font_size in enumerate(heading_sizes)}
    lines = [
        _DocumentLine(text=text, heading_level=heading_levels.get(font_size))
        for text, font_size in pdf_lines
    ]
    return _build_sections(lines)


def _count_pdf_images(reader: PdfReader) -> int:
    image_count = 0
    for page in reader.pages:
        resources = page.get("/Resources")
        if resources is None:
            continue
        if hasattr(resources, "get_object"):
            resources = resources.get_object()
        xobjects = resources.get("/XObject")
        if xobjects is None:
            continue
        if hasattr(xobjects, "get_object"):
            xobjects = xobjects.get_object()
        for obj in xobjects.values():
            resolved = obj.get_object() if hasattr(obj, "get_object") else obj
            if resolved.get("/Subtype") == "/Image":
                image_count += 1
    return image_count


def _analyze_pdf_document(document_bytes: bytes) -> _DocumentAnalysis:
    try:
        reader = PdfReader(BytesIO(document_bytes))
    except (PdfReadError, PdfStreamError):
        return _DocumentAnalysis(
            sections=[],
            quality_gate=_quality_gate_result(
                status="rejected",
                rejection_reason=_MALFORMED_PDF_REASON,
            ),
            table_extraction=_table_extraction_result(),
        )

    pdf_lines = _extract_pdf_lines(reader)
    image_count = _count_pdf_images(reader)
    warnings = [_IMAGE_WARNING] if image_count > 0 else []
    if not pdf_lines and image_count > 0:
        return _DocumentAnalysis(
            sections=[],
            quality_gate=_quality_gate_result(
                status="rejected",
                ingestion_confidence=0.0,
                table_extraction_confidence=0.0,
                unsupported_content_warnings=warnings,
                rejection_reason=_IMAGE_ONLY_PDF_REASON,
            ),
            table_extraction=_table_extraction_result(),
        )

    return _DocumentAnalysis(
        sections=_build_pdf_sections(pdf_lines),
        quality_gate=_quality_gate_result(
            ingestion_confidence=1.0 if pdf_lines else 0.0,
            table_extraction_confidence=0.0,
            unsupported_content_warnings=warnings,
        ),
        table_extraction=_table_extraction_result(),
    )


def _docx_heading_levels(archive: ZipFile) -> dict[str, int]:
    try:
        styles_xml = archive.read("word/styles.xml")
    except KeyError:
        return {}

    root = ElementTree.fromstring(styles_xml)
    levels: dict[str, int] = {}
    for style in root.findall("w:style", _WORDPROCESSINGML_NS):
        style_id = style.attrib.get(f"{{{_WORDPROCESSINGML_NS['w']}}}styleId")
        if not style_id:
            continue
        name = style.find("w:name", _WORDPROCESSINGML_NS)
        if name is not None:
            style_name = name.attrib.get(f"{{{_WORDPROCESSINGML_NS['w']}}}val", "")
            match = _HEADING_STYLE_RE.fullmatch(style_name.strip())
            if match is not None:
                levels[style_id] = int(match.group(1))
                continue
        outline_level = style.find("w:pPr/w:outlineLvl", _WORDPROCESSINGML_NS)
        if outline_level is not None:
            level = outline_level.attrib.get(f"{{{_WORDPROCESSINGML_NS['w']}}}val")
            if level is not None:
                levels[style_id] = int(level) + 1
    return levels


def _docx_lines(root: ElementTree.Element, heading_levels: dict[str, int]) -> list[_DocumentLine]:
    lines: list[_DocumentLine] = []
    for paragraph in root.findall(".//w:body/w:p", _WORDPROCESSINGML_NS):
        text = "".join(
            node.text or "" for node in paragraph.findall(".//w:t", _WORDPROCESSINGML_NS)
        )
        normalized = _normalize_text(text)
        if not normalized:
            continue
        style = paragraph.find("w:pPr/w:pStyle", _WORDPROCESSINGML_NS)
        style_id = None
        if style is not None:
            style_id = style.attrib.get(f"{{{_WORDPROCESSINGML_NS['w']}}}val")
        lines.append(
            _DocumentLine(
                text=normalized,
                heading_level=heading_levels.get(style_id) if style_id else None,
            )
        )

    return lines


def _docx_table_metadata(root: ElementTree.Element) -> list[ExtractedTableMetadata]:
    tables: list[ExtractedTableMetadata] = []
    for index, table in enumerate(root.findall(".//w:body/w:tbl", _WORDPROCESSINGML_NS), start=1):
        rows = table.findall("w:tr", _WORDPROCESSINGML_NS)
        row_count = len(rows)
        column_count = max(
            (
                len(row.findall("w:tc", _WORDPROCESSINGML_NS))
                for row in rows
            ),
            default=0,
        )
        tables.append(
            ExtractedTableMetadata(
                table_id=f"table-{index}",
                row_count=row_count,
                column_count=column_count,
            )
        )
    return tables


def _docx_unsupported_content_warnings(archive: ZipFile) -> list[str]:
    names = set(archive.namelist())
    warnings: list[str] = []
    if any(name.startswith("word/media/") for name in names):
        warnings.append(_IMAGE_WARNING)
    if any(name.startswith("word/charts/") for name in names):
        warnings.append(_CHART_WARNING)
    if any(name.startswith("word/embeddings/") for name in names):
        warnings.append(_EMBEDDING_WARNING)
    return warnings


def _analyze_docx_document(document_bytes: bytes) -> _DocumentAnalysis:
    try:
        with ZipFile(BytesIO(document_bytes)) as archive:
            document_xml = archive.read("word/document.xml")
            heading_levels = _docx_heading_levels(archive)
            warnings = _docx_unsupported_content_warnings(archive)
        root = ElementTree.fromstring(document_xml)
    except (BadZipFile, ElementTree.ParseError, KeyError):
        return _DocumentAnalysis(
            sections=[],
            quality_gate=_quality_gate_result(
                status="rejected",
                rejection_reason=_MALFORMED_DOCX_REASON,
            ),
            table_extraction=_table_extraction_result(),
        )

    lines = _docx_lines(root, heading_levels)
    tables = _docx_table_metadata(root)
    return _DocumentAnalysis(
        sections=_build_sections(lines),
        quality_gate=_quality_gate_result(
            ingestion_confidence=1.0 if lines else 0.0,
            table_extraction_confidence=1.0,
            unsupported_content_warnings=warnings,
        ),
        table_extraction=_table_extraction_result(tables),
    )


def _analyze_document(*, content_type: str, document_bytes: bytes) -> _DocumentAnalysis:
    if content_type == PDF_CONTENT_TYPE:
        return _analyze_pdf_document(document_bytes)
    if content_type == DOCX_CONTENT_TYPE:
        return _analyze_docx_document(document_bytes)
    return _DocumentAnalysis(
        sections=[],
        quality_gate=_quality_gate_result(),
        table_extraction=_table_extraction_result(),
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
    analysis = _analyze_document(
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
                section_id=_stable_section_id(parsed_section.heading_path, parsed_section.content),
                document_id=document_id,
                heading_path=parsed_section.heading_path,
                content=parsed_section.content,
                start_char=section_start_char,
                end_char=section_end_char,
            )
        )
        section_start_char = section_end_char
        if index < len(analysis.sections) - 1:
            section_start_char += len(_SECTION_GAP)

    if commit:
        session.commit()

    return document_version_from_record(record)


class DocumentVersionListResponse(BaseModel):
    items: list[DocumentVersion]


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

        created_at = _normalize_datetime(latest_record.created_at)
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


def document_version_from_record(record: DocumentVersionRecord) -> DocumentVersion:
    return DocumentVersion(
        document_id=record.document_id,
        document_version_id=record.document_version_id,
        filename=record.filename,
        content_type=record.content_type,
        size_bytes=record.size_bytes,
        sha256=record.sha256,
        retention_until=_normalize_datetime(record.retention_until),
        retention_reason=record.retention_reason,
        deleted_at=_normalize_datetime(record.deleted_at),
        deleted_by=record.deleted_by,
        deletion_reason=record.deletion_reason,
        quality_gate=DocumentQualityGate.model_validate(
            record.quality_gate or _quality_gate_result().model_dump(mode="json")
        ),
        table_extraction=DocumentTableExtraction.model_validate(
            record.table_extraction or _table_extraction_result().model_dump(mode="json")
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


def resolve_citation_anchor(
    session: Session,
    *,
    document_id: str,
    document_version_id: str,
    quote: str,
) -> CitationAnchor | None:
    resolution = resolve_citation_anchor_with_fallback(
        session,
        document_id=document_id,
        document_version_id=document_version_id,
        quote=quote,
    )
    return resolution.anchor if resolution is not None else None


def resolve_citation_anchor_with_fallback(
    session: Session,
    *,
    document_id: str,
    document_version_id: str,
    quote: str,
    fallback_quotes: Sequence[str] = (),
) -> CitationResolution | None:
    sections = list_document_sections(
        session,
        document_id=document_id,
        document_version_id=document_version_id,
    )
    for candidate_quote in (quote, *fallback_quotes):
        if not candidate_quote:
            continue
        resolution = _resolve_citation_in_sections(
            sections=sections,
            document_id=document_id,
            document_version_id=document_version_id,
            requested_quote=candidate_quote,
        )
        if resolution is not None:
            return resolution
    return None


def _resolve_citation_in_sections(
    *,
    sections: Sequence[DocumentSection],
    document_id: str,
    document_version_id: str,
    requested_quote: str,
) -> CitationResolution | None:
    for section in sections:
        exact_resolution = _resolve_exact_citation_in_section(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            requested_quote=requested_quote,
        )
        if exact_resolution is not None:
            return exact_resolution

        fuzzy_resolution = _resolve_fuzzy_citation_in_section(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            requested_quote=requested_quote,
        )
        if fuzzy_resolution is not None:
            return fuzzy_resolution

        for line_resolution in _resolve_line_based_citations_in_section(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            requested_quote=requested_quote,
        ):
            return line_resolution
    return None


def _resolve_line_based_citations_in_section(
    *,
    section: DocumentSection,
    document_id: str,
    document_version_id: str,
    requested_quote: str,
) -> list[CitationResolution]:
    resolutions: list[CitationResolution] = []
    for line in section.content.splitlines():
        stripped_line = line.strip()
        if not stripped_line:
            continue
        start_in_section = section.content.find(stripped_line)
        if start_in_section < 0:
            continue

        case_insensitive_resolution = _resolve_case_insensitive_citation_in_line(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            requested_quote=requested_quote,
            line=stripped_line,
            start_in_section=start_in_section,
        )
        if case_insensitive_resolution is not None:
            resolutions.append(case_insensitive_resolution)
            continue

        flexible_whitespace_resolution = _resolve_flexible_whitespace_citation_in_line(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            requested_quote=requested_quote,
            line=stripped_line,
            start_in_section=start_in_section,
        )
        if flexible_whitespace_resolution is not None:
            resolutions.append(flexible_whitespace_resolution)

    return resolutions


def _resolve_exact_citation_in_section(
    *,
    section: DocumentSection,
    document_id: str,
    document_version_id: str,
    requested_quote: str,
) -> CitationResolution | None:
    start_in_section = section.content.find(requested_quote)
    if start_in_section < 0:
        return None
    return CitationResolution(
        anchor=_citation_anchor_from_span(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            start_in_section=start_in_section,
            end_in_section=start_in_section + len(requested_quote),
            quote=requested_quote,
        ),
        match_kind=CitationMatchKind.EXACT,
        requested_quote=requested_quote,
    )


def _resolve_case_insensitive_citation_in_line(
    *,
    section: DocumentSection,
    document_id: str,
    document_version_id: str,
    requested_quote: str,
    line: str,
    start_in_section: int,
) -> CitationResolution | None:
    if line.lower().find(requested_quote.lower()) < 0:
        return None
    matched_quote = line
    return CitationResolution(
        anchor=_citation_anchor_from_span(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            start_in_section=start_in_section,
            end_in_section=start_in_section + len(matched_quote),
            quote=matched_quote,
        ),
        match_kind=CitationMatchKind.CASE_INSENSITIVE,
        requested_quote=requested_quote,
    )


def _resolve_flexible_whitespace_citation_in_line(
    *,
    section: DocumentSection,
    document_id: str,
    document_version_id: str,
    requested_quote: str,
    line: str,
    start_in_section: int,
) -> CitationResolution | None:
    parts = requested_quote.split()
    if not parts:
        return None
    pattern = re.compile(
        r"\s+".join(re.escape(part) for part in parts),
        re.IGNORECASE,
    )
    match = pattern.search(line)
    if match is None:
        return None
    matched_quote = line[match.start() : match.end()]
    return CitationResolution(
        anchor=_citation_anchor_from_span(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            start_in_section=start_in_section + match.start(),
            end_in_section=start_in_section + match.end(),
            quote=matched_quote,
        ),
        match_kind=CitationMatchKind.FLEXIBLE_WHITESPACE,
        requested_quote=requested_quote,
    )


def _resolve_fuzzy_citation_in_section(
    *,
    section: DocumentSection,
    document_id: str,
    document_version_id: str,
    requested_quote: str,
) -> CitationResolution | None:
    normalized_requested_quote = _normalize_citation_text(requested_quote)
    if not normalized_requested_quote:
        return None

    best_line: str | None = None
    best_ratio = 0.0
    for line in section.content.splitlines():
        stripped_line = line.strip()
        if not stripped_line:
            continue
        normalized_line = _normalize_citation_text(stripped_line)
        ratio = SequenceMatcher(
            None,
            normalized_requested_quote,
            normalized_line,
        ).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_line = stripped_line

    if best_line is None or best_ratio < _FUZZY_CITATION_MIN_RATIO:
        return None
    if not _money_amounts_compatible(requested_quote, best_line):
        return None

    start_in_section = section.content.find(best_line)
    if start_in_section < 0:
        return None
    return CitationResolution(
        anchor=_citation_anchor_from_span(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            start_in_section=start_in_section,
            end_in_section=start_in_section + len(best_line),
            quote=best_line,
        ),
        match_kind=CitationMatchKind.FUZZY,
        requested_quote=requested_quote,
    )


def _citation_anchor_from_span(
    *,
    section: DocumentSection,
    document_id: str,
    document_version_id: str,
    start_in_section: int,
    end_in_section: int,
    quote: str,
) -> CitationAnchor:
    start_char = section.start_char + start_in_section
    end_char = section.start_char + end_in_section
    return CitationAnchor(
        document_id=document_id,
        document_version_id=document_version_id,
        section_id=section.section_id,
        quote=quote,
        start_char=start_char,
        end_char=end_char,
    )


def _normalize_citation_text(value: str) -> str:
    normalized = value.lower().replace("\u2019", "'").replace("\u2018", "'")
    normalized = normalized.replace("\u201c", '"').replace("\u201d", '"')
    return " ".join(normalized.split())


def _money_amounts(value: str) -> set[str]:
    return {match.group(1) for match in _MONEY_AMOUNT_RE.finditer(value)}


def _money_amounts_compatible(requested_quote: str, matched_quote: str) -> bool:
    requested_amounts = _money_amounts(requested_quote)
    matched_amounts = _money_amounts(matched_quote)
    if not requested_amounts or not matched_amounts:
        return True
    return not requested_amounts.isdisjoint(matched_amounts)
