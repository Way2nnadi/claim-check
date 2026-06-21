from __future__ import annotations

from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from policy_pipeline.database import Base
from policy_pipeline.documents import (
    create_document_version,
    list_document_sections,
    resolve_citation_anchor,
)


def _make_pdf_bytes(lines: list[tuple[str, int]]) -> bytes:
    objects: list[bytes] = []

    def add_object(payload: bytes) -> int:
        objects.append(payload)
        return len(objects)

    catalog_id = add_object(b"<< /Type /Catalog /Pages 2 0 R >>")
    pages_id = add_object(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")

    content_lines = ["BT", "/F1 18 Tf", "72 720 Td"]
    first_line = True
    for text, font_size in lines:
        escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        if first_line:
            content_lines.append(f"/F1 {font_size} Tf")
            content_lines.append(f"({escaped}) Tj")
            first_line = False
            continue

        content_lines.append("0 -24 Td")
        content_lines.append(f"/F1 {font_size} Tf")
        content_lines.append(f"({escaped}) Tj")
    content_lines.append("ET")
    content_stream = "\n".join(content_lines).encode("utf-8")

    page_id = add_object(
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
    )
    font_id = add_object(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    content_id = add_object(
        f"<< /Length {len(content_stream)} >>\nstream\n".encode()
        + content_stream
        + b"\nendstream"
    )

    assert (catalog_id, pages_id, page_id, font_id, content_id) == (1, 2, 3, 4, 5)

    buffer = BytesIO()
    buffer.write(b"%PDF-1.4\n")
    offsets = [0]
    for object_number, payload in enumerate(objects, start=1):
        offsets.append(buffer.tell())
        buffer.write(f"{object_number} 0 obj\n".encode())
        buffer.write(payload)
        buffer.write(b"\nendobj\n")

    xref_offset = buffer.tell()
    buffer.write(f"xref\n0 {len(objects) + 1}\n".encode())
    buffer.write(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        buffer.write(f"{offset:010} 00000 n \n".encode())
    buffer.write(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode()
    )
    return buffer.getvalue()


def _make_docx_bytes(paragraphs: list[tuple[str, str]]) -> bytes:
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default
    Extension="rels"
    ContentType="application/vnd.openxmlformats-package.relationships+xml"
  />
  <Default Extension="xml" ContentType="application/xml"/>
  <Override
    PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
  />
  <Override
    PartName="/word/styles.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"
  />
</Types>
"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship
    Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"
  />
</Relationships>
"""
    styles = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:outlineLvl w:val="0"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:outlineLvl w:val="1"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
</w:styles>
"""

    body = []
    for text, style_id in paragraphs:
        escaped = (
            text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        )
        body.append(
            f"""
  <w:p>
    <w:pPr><w:pStyle w:val="{style_id}"/></w:pPr>
    <w:r><w:t>{escaped}</w:t></w:r>
  </w:p>"""
        )
    document = (
        """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>"""
        + "".join(body)
        + """
    <w:sectPr />
  </w:body>
</w:document>
"""
    )

    buffer = BytesIO()
    with ZipFile(buffer, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", rels)
        archive.writestr("word/document.xml", document)
        archive.writestr("word/styles.xml", styles)
    return buffer.getvalue()


def test_pdf_document_version_is_parsed_into_stable_sections() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    document_bytes = _make_pdf_bytes(
        [
            ("Travel Policy", 18),
            ("Meals are capped at $75 per day.", 12),
            ("Lodging", 18),
            ("Hotel stays require itemized receipts.", 12),
        ]
    )

    with Session(engine) as session:
        first_version = create_document_version(
            session,
            document_id="expense-policy",
            filename="expense-policy.pdf",
            content_type="application/pdf",
            document_bytes=document_bytes,
        )
        second_version = create_document_version(
            session,
            document_id="expense-policy",
            filename="expense-policy.pdf",
            content_type="application/pdf",
            document_bytes=document_bytes,
        )

        first_sections = list_document_sections(
            session,
            document_id="expense-policy",
            document_version_id=first_version.document_version_id,
        )
        second_sections = list_document_sections(
            session,
            document_id="expense-policy",
            document_version_id=second_version.document_version_id,
        )

    assert [section.heading_path for section in first_sections] == [
        ["Travel Policy"],
        ["Lodging"],
    ]
    assert [section.section_id for section in first_sections] == [
        section.section_id for section in second_sections
    ]
    assert first_sections[0].start_char == 0
    assert first_sections[0].end_char <= first_sections[1].start_char
    assert first_sections[0].content == "Travel Policy\nMeals are capped at $75 per day."
    assert first_sections[1].content == "Lodging\nHotel stays require itemized receipts."


def test_docx_document_version_is_parsed_into_nested_sections_with_stable_ids() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    document_bytes = _make_docx_bytes(
        [
            ("Travel Policy", "Heading1"),
            ("Meals", "Heading2"),
            ("Domestic meals are capped at $75 per day.", "Normal"),
            ("Lodging", "Heading2"),
            ("Hotel stays require itemized receipts.", "Normal"),
        ]
    )

    with Session(engine) as session:
        first_version = create_document_version(
            session,
            document_id="expense-policy",
            filename="expense-policy.docx",
            content_type=(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ),
            document_bytes=document_bytes,
        )
        second_version = create_document_version(
            session,
            document_id="expense-policy",
            filename="expense-policy.docx",
            content_type=(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ),
            document_bytes=document_bytes,
        )

        first_sections = list_document_sections(
            session,
            document_id="expense-policy",
            document_version_id=first_version.document_version_id,
        )
        second_sections = list_document_sections(
            session,
            document_id="expense-policy",
            document_version_id=second_version.document_version_id,
        )

    assert [section.heading_path for section in first_sections] == [
        ["Travel Policy"],
        ["Travel Policy", "Meals"],
        ["Travel Policy", "Lodging"],
    ]
    assert [section.section_id for section in first_sections] == [
        section.section_id for section in second_sections
    ]
    assert first_sections[0].content == "Travel Policy"
    assert first_sections[1].content == "Meals\nDomestic meals are capped at $75 per day."
    assert first_sections[2].content == "Lodging\nHotel stays require itemized receipts."


def test_long_heading_paths_produce_bounded_stable_section_ids() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    long_heading = "Travel " + "and lodging " * 20
    document_bytes = _make_docx_bytes(
        [
            (long_heading, "Heading1"),
            ("Meals " + "international " * 20, "Heading2"),
            ("Domestic meals are capped at $75 per day.", "Normal"),
        ]
    )

    with Session(engine) as session:
        first_version = create_document_version(
            session,
            document_id="expense-policy",
            filename="expense-policy.docx",
            content_type=(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ),
            document_bytes=document_bytes,
        )
        second_version = create_document_version(
            session,
            document_id="expense-policy",
            filename="expense-policy.docx",
            content_type=(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ),
            document_bytes=document_bytes,
        )

        first_sections = list_document_sections(
            session,
            document_id="expense-policy",
            document_version_id=first_version.document_version_id,
        )
        second_sections = list_document_sections(
            session,
            document_id="expense-policy",
            document_version_id=second_version.document_version_id,
        )

    assert all(len(section.section_id) <= 255 for section in first_sections)
    assert [section.section_id for section in first_sections] == [
        section.section_id for section in second_sections
    ]


def test_quote_anchor_lookup_resolves_quote_back_to_section_and_offsets() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    document_bytes = _make_docx_bytes(
        [
            ("Travel Policy", "Heading1"),
            ("Lodging", "Heading2"),
            ("Hotel stays require itemized receipts.", "Normal"),
        ]
    )

    with Session(engine) as session:
        document_version = create_document_version(
            session,
            document_id="expense-policy",
            filename="expense-policy.docx",
            content_type=(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ),
            document_bytes=document_bytes,
        )
        sections = list_document_sections(
            session,
            document_id="expense-policy",
            document_version_id=document_version.document_version_id,
        )

        anchor = resolve_citation_anchor(
            session,
            document_id="expense-policy",
            document_version_id=document_version.document_version_id,
            quote="Hotel stays require itemized receipts.",
        )

    assert anchor is not None
    assert anchor.section_id == sections[1].section_id
    assert anchor.start_char == sections[1].start_char + sections[1].content.index(anchor.quote)
    assert anchor.end_char == anchor.start_char + len(anchor.quote)
