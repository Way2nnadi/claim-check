from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from typing import Literal
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from pydantic import BaseModel, Field
from pypdf import PdfReader
from pypdf.errors import PdfReadError, PdfStreamError

PDF_CONTENT_TYPE = "application/pdf"
DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
SUPPORTED_DOCUMENT_TYPES = {
    ".pdf": PDF_CONTENT_TYPE,
    ".docx": DOCX_CONTENT_TYPE,
}
_WORDPROCESSINGML_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
_HEADING_STYLE_RE = re.compile(r"heading\s*(\d+)", re.IGNORECASE)
SECTION_GAP = "\n\n"
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


@dataclass(frozen=True)
class _DocumentLine:
    text: str
    heading_level: int | None = None


@dataclass(frozen=True)
class _ParsedSection:
    heading_path: list[str]
    content: str


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


class DocumentQualityGateRejectedError(Exception):
    pass


@dataclass(frozen=True)
class _DocumentAnalysis:
    sections: list[_ParsedSection]
    quality_gate: DocumentQualityGate
    table_extraction: DocumentTableExtraction


def _normalize_text(value: str) -> str:
    return " ".join(value.split())


def _slugify_heading(value: str) -> str:
    slug = _NON_ALNUM_RE.sub("-", value.strip().lower()).strip("-")
    return slug or "section"


def stable_section_id(heading_path: list[str], content: str) -> str:
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


def quality_gate_result(
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


def table_extraction_result(
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
            quality_gate=quality_gate_result(
                status="rejected",
                rejection_reason=_MALFORMED_PDF_REASON,
            ),
            table_extraction=table_extraction_result(),
        )

    pdf_lines = _extract_pdf_lines(reader)
    image_count = _count_pdf_images(reader)
    warnings = [_IMAGE_WARNING] if image_count > 0 else []
    if not pdf_lines and image_count > 0:
        return _DocumentAnalysis(
            sections=[],
            quality_gate=quality_gate_result(
                status="rejected",
                ingestion_confidence=0.0,
                table_extraction_confidence=0.0,
                unsupported_content_warnings=warnings,
                rejection_reason=_IMAGE_ONLY_PDF_REASON,
            ),
            table_extraction=table_extraction_result(),
        )

    return _DocumentAnalysis(
        sections=_build_pdf_sections(pdf_lines),
        quality_gate=quality_gate_result(
            ingestion_confidence=1.0 if pdf_lines else 0.0,
            table_extraction_confidence=0.0,
            unsupported_content_warnings=warnings,
        ),
        table_extraction=table_extraction_result(),
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
            quality_gate=quality_gate_result(
                status="rejected",
                rejection_reason=_MALFORMED_DOCX_REASON,
            ),
            table_extraction=table_extraction_result(),
        )

    lines = _docx_lines(root, heading_levels)
    tables = _docx_table_metadata(root)
    return _DocumentAnalysis(
        sections=_build_sections(lines),
        quality_gate=quality_gate_result(
            ingestion_confidence=1.0 if lines else 0.0,
            table_extraction_confidence=1.0,
            unsupported_content_warnings=warnings,
        ),
        table_extraction=table_extraction_result(tables),
    )


def analyze_document(*, content_type: str, document_bytes: bytes) -> _DocumentAnalysis:
    if content_type == PDF_CONTENT_TYPE:
        return _analyze_pdf_document(document_bytes)
    if content_type == DOCX_CONTENT_TYPE:
        return _analyze_docx_document(document_bytes)
    return _DocumentAnalysis(
        sections=[],
        quality_gate=quality_gate_result(),
        table_extraction=table_extraction_result(),
    )
