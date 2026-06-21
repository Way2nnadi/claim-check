from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from io import BytesIO
from pathlib import PurePosixPath
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


def _parse_pdf_sections(document_bytes: bytes) -> list[_ParsedSection]:
    reader = PdfReader(BytesIO(document_bytes))
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


def _parse_docx_sections(document_bytes: bytes) -> list[_ParsedSection]:
    with ZipFile(BytesIO(document_bytes)) as archive:
        document_xml = archive.read("word/document.xml")
        heading_levels = _docx_heading_levels(archive)

    root = ElementTree.fromstring(document_xml)
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

    return _build_sections(lines)


def _parse_document_sections(*, content_type: str, document_bytes: bytes) -> list[_ParsedSection]:
    try:
        if content_type == PDF_CONTENT_TYPE:
            return _parse_pdf_sections(document_bytes)
        if content_type == DOCX_CONTENT_TYPE:
            return _parse_docx_sections(document_bytes)
    except (BadZipFile, ElementTree.ParseError, KeyError, PdfReadError, PdfStreamError):
        return []
    return []


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
    parsed_sections = _parse_document_sections(
        content_type=content_type,
        document_bytes=document_bytes,
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
    )
    session.add(record)
    session.flush()

    section_start_char = 0
    for index, parsed_section in enumerate(parsed_sections):
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
        if index < len(parsed_sections) - 1:
            section_start_char += len(_SECTION_GAP)

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
        retention_until=_normalize_datetime(record.retention_until),
        retention_reason=record.retention_reason,
        deleted_at=_normalize_datetime(record.deleted_at),
        deleted_by=record.deleted_by,
        deletion_reason=record.deletion_reason,
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
    for section in list_document_sections(
        session,
        document_id=document_id,
        document_version_id=document_version_id,
    ):
        start_in_section = section.content.find(quote)
        if start_in_section < 0:
            continue
        start_char = section.start_char + start_in_section
        return CitationAnchor(
            document_id=document_id,
            document_version_id=document_version_id,
            section_id=section.section_id,
            quote=quote,
            start_char=start_char,
            end_char=start_char + len(quote),
        )
    return None
