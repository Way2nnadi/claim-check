import json
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from policy_pipeline.database import Base
from policy_pipeline.main import create_app


def _configure_local_auth(
    monkeypatch: pytest.MonkeyPatch,
    database_url: str,
    object_storage_root: str,
) -> None:
    monkeypatch.setenv("POLICY_PIPELINE_DATABASE_URL", database_url)
    monkeypatch.setenv("POLICY_PIPELINE_OBJECT_STORAGE_ROOT", object_storage_root)
    monkeypatch.setenv(
        "POLICY_PIPELINE_LOCAL_AUTH_IDENTITIES",
        json.dumps(
            [
                {
                    "token": "admin-token",
                    "subject": "admin-user",
                    "roles": ["admin"],
                },
                {
                    "token": "approver-token",
                    "subject": "approver-user",
                    "roles": ["approver"],
                },
                {
                    "token": "viewer-token",
                    "subject": "viewer-user",
                    "roles": ["viewer"],
                },
            ]
        ),
    )


def _make_image_only_pdf_bytes() -> bytes:
    objects: list[bytes] = []

    def add_object(payload: bytes) -> int:
        objects.append(payload)
        return len(objects)

    image_id = add_object(
        b"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 "
        b"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\n"
        b"\xff\xff\xff"
        b"\nendstream"
    )
    content_stream = b"q\n100 0 0 100 0 0 cm\n/Im0 Do\nQ"
    content_id = add_object(
        f"<< /Length {len(content_stream)} >>\nstream\n".encode()
        + content_stream
        + b"\nendstream"
    )
    page_id = add_object(
        f"<< /Type /Page /Parent 4 0 R /MediaBox [0 0 100 100] "
        f"/Resources << /ProcSet [/PDF /ImageC] /XObject << /Im0 {image_id} 0 R >> >> "
        f"/Contents {content_id} 0 R >>".encode()
    )
    pages_id = add_object(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    catalog_id = add_object(b"<< /Type /Catalog /Pages 4 0 R >>")

    assert (image_id, content_id, page_id, pages_id, catalog_id) == (1, 2, 3, 4, 5)

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
            f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode()
    )
    return buffer.getvalue()


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


@pytest.mark.anyio
async def test_admin_uploads_pdf_document_version_and_viewer_access_is_audited(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    object_storage_root = tmp_path / "object-storage"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url, str(object_storage_root))

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    document_bytes = _make_pdf_bytes(
        [
            ("Travel Policy", 18),
            ("Meals are capped at $75 per day.", 12),
        ]
    )
    expected_sha256 = sha256(document_bytes).hexdigest()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        upload_response = await client.post(
            "/policy-documents/expense-policy/versions",
            headers={"Authorization": "Bearer admin-token"},
            files={
                "file": (
                    "expense-policy.pdf",
                    document_bytes,
                    "application/pdf",
                )
            },
        )

        assert upload_response.status_code == 201
        payload = upload_response.json()

        access_response = await client.get(
            f"/policy-documents/expense-policy/versions/{payload['document_version_id']}",
            headers={"Authorization": "Bearer viewer-token"},
        )
        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={
                "entity_type": "document_version",
                "entity_id": payload["document_version_id"],
            },
        )

    assert payload == {
        "document_id": "expense-policy",
        "document_version_id": payload["document_version_id"],
        "filename": "expense-policy.pdf",
        "content_type": "application/pdf",
        "size_bytes": len(document_bytes),
        "sha256": expected_sha256,
        "retention_until": None,
        "retention_reason": None,
        "deleted_at": None,
        "deleted_by": None,
        "deletion_reason": None,
        "quality_gate": {
            "status": "passed",
            "ingestion_confidence": 1.0,
            "table_extraction_confidence": 0.0,
            "unsupported_content_warnings": [],
            "rejection_reason": None,
        },
        "table_extraction": {
            "table_count": 0,
            "tables": [],
        },
    }

    assert access_response.status_code == 200
    assert access_response.content == document_bytes
    assert access_response.headers["content-type"] == "application/pdf"
    assert (
        access_response.headers["content-disposition"]
        == 'attachment; filename="expense-policy.pdf"'
    )

    assert audit_response.status_code == 200
    assert audit_response.json() == {
        "items": [
            {
                "action": "document_version.uploaded",
                "actor_subject": "admin-user",
                "actor_roles": ["admin"],
                "entity_type": "document_version",
                "entity_id": payload["document_version_id"],
                "payload": {
                    "document_id": "expense-policy",
                    "filename": "expense-policy.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": len(document_bytes),
                    "sha256": expected_sha256,
                    "retention_until": None,
                    "retention_reason": None,
                },
            },
            {
                "action": "document_version.accessed",
                "actor_subject": "viewer-user",
                "actor_roles": ["viewer"],
                "entity_type": "document_version",
                "entity_id": payload["document_version_id"],
                "payload": {
                    "document_id": "expense-policy",
                    "filename": "expense-policy.pdf",
                },
            },
        ]
    }


@pytest.mark.anyio
async def test_upload_rejects_image_only_pdf_with_clear_reason(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    object_storage_root = tmp_path / "object-storage"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url, str(object_storage_root))

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        upload_response = await client.post(
            "/policy-documents/expense-policy/versions",
            headers={"Authorization": "Bearer admin-token"},
            files={
                "file": (
                    "expense-policy.pdf",
                    _make_image_only_pdf_bytes(),
                    "application/pdf",
                )
            },
        )

    assert upload_response.status_code == 422
    assert upload_response.json() == {
        "detail": "Image-only PDFs are not supported because no extractable text was found.",
    }


@pytest.mark.anyio
async def test_upload_rejects_malformed_pdf_with_clear_reason(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    object_storage_root = tmp_path / "object-storage"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url, str(object_storage_root))

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        upload_response = await client.post(
            "/policy-documents/expense-policy/versions",
            headers={"Authorization": "Bearer admin-token"},
            files={
                "file": (
                    "expense-policy.pdf",
                    b"not a pdf",
                    "application/pdf",
                )
            },
        )

    assert upload_response.status_code == 422
    assert upload_response.json() == {
        "detail": "Malformed PDF files are not supported because the file could not be parsed.",
    }


@pytest.mark.anyio
async def test_reuploading_docx_policy_document_creates_new_immutable_document_versions(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    object_storage_root = tmp_path / "object-storage"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url, str(object_storage_root))

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    first_document_bytes = _make_docx_bytes(
        [
            ("Travel Policy", "Heading1"),
            ("Meals are capped at $75 per day.", "Normal"),
        ]
    )
    second_document_bytes = _make_docx_bytes(
        [
            ("Travel Policy", "Heading1"),
            ("Meals are capped at $90 per day.", "Normal"),
        ]
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        first_upload_response = await client.post(
            "/policy-documents/expense-policy/versions",
            headers={"Authorization": "Bearer admin-token"},
            files={
                "file": (
                    "expense-policy.docx",
                    first_document_bytes,
                    (
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    ),
                )
            },
        )
        second_upload_response = await client.post(
            "/policy-documents/expense-policy/versions",
            headers={"Authorization": "Bearer admin-token"},
            files={
                "file": (
                    "expense-policy.docx",
                    second_document_bytes,
                    (
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    ),
                )
            },
        )

        assert first_upload_response.status_code == 201
        assert second_upload_response.status_code == 201
        first_version = first_upload_response.json()
        second_version = second_upload_response.json()

        first_access_response = await client.get(
            (
                "/policy-documents/expense-policy/versions/"
                f"{first_version['document_version_id']}"
            ),
            headers={"Authorization": "Bearer viewer-token"},
        )
        second_access_response = await client.get(
            (
                "/policy-documents/expense-policy/versions/"
                f"{second_version['document_version_id']}"
            ),
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert first_version["document_id"] == "expense-policy"
    assert second_version["document_id"] == "expense-policy"
    assert first_version["filename"] == "expense-policy.docx"
    assert second_version["filename"] == "expense-policy.docx"
    assert (
        first_version["content_type"]
        == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert (
        second_version["content_type"]
        == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert first_version["document_version_id"] != second_version["document_version_id"]
    assert first_version["sha256"] != second_version["sha256"]

    assert first_access_response.status_code == 200
    assert first_access_response.content == first_document_bytes
    assert second_access_response.status_code == 200
    assert second_access_response.content == second_document_bytes


@pytest.mark.anyio
async def test_uploading_duplicate_pdf_bytes_still_creates_distinct_document_versions(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    object_storage_root = tmp_path / "object-storage"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url, str(object_storage_root))

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    document_bytes = _make_pdf_bytes(
        [
            ("Travel Policy", 18),
            ("Meals are capped at $75 per day.", 12),
        ]
    )
    expected_sha256 = sha256(document_bytes).hexdigest()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        first_upload_response = await client.post(
            "/policy-documents/expense-policy/versions",
            headers={"Authorization": "Bearer admin-token"},
            files={
                "file": (
                    "expense-policy.pdf",
                    document_bytes,
                    "application/pdf",
                )
            },
        )
        second_upload_response = await client.post(
            "/policy-documents/expense-policy/versions",
            headers={"Authorization": "Bearer admin-token"},
            files={
                "file": (
                    "expense-policy.pdf",
                    document_bytes,
                    "application/pdf",
                )
            },
        )

        assert first_upload_response.status_code == 201
        assert second_upload_response.status_code == 201
        first_version = first_upload_response.json()
        second_version = second_upload_response.json()

        first_access_response = await client.get(
            (
                "/policy-documents/expense-policy/versions/"
                f"{first_version['document_version_id']}"
            ),
            headers={"Authorization": "Bearer viewer-token"},
        )
        second_access_response = await client.get(
            (
                "/policy-documents/expense-policy/versions/"
                f"{second_version['document_version_id']}"
            ),
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert first_version["document_id"] == "expense-policy"
    assert second_version["document_id"] == "expense-policy"
    assert first_version["document_version_id"] != second_version["document_version_id"]
    assert first_version["sha256"] == expected_sha256
    assert second_version["sha256"] == expected_sha256

    assert first_access_response.status_code == 200
    assert first_access_response.content == document_bytes
    assert second_access_response.status_code == 200
    assert second_access_response.content == document_bytes


@pytest.mark.anyio
async def test_uploading_document_version_with_retention_metadata_blocks_early_deletion(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    object_storage_root = tmp_path / "object-storage"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url, str(object_storage_root))

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    document_bytes = _make_pdf_bytes(
        [
            ("Travel Policy", 18),
            ("Retained document.", 12),
        ]
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        upload_response = await client.post(
            "/policy-documents/expense-policy/versions",
            headers={"Authorization": "Bearer admin-token"},
            files={
                "file": ("expense-policy.pdf", document_bytes, "application/pdf"),
                "retention_until": (None, "2099-01-01T00:00:00Z"),
                "retention_reason": (None, "Finance seven-year retention schedule."),
            },
        )

        assert upload_response.status_code == 201
        document_version = upload_response.json()

        delete_response = await client.request(
            "DELETE",
            (
                "/policy-documents/expense-policy/versions/"
                f"{document_version['document_version_id']}"
            ),
            headers={"Authorization": "Bearer admin-token"},
            json={"reason": "Cleanup before retention expires."},
        )

    assert document_version["retention_until"] == "2099-01-01T00:00:00Z"
    assert document_version["retention_reason"] == "Finance seven-year retention schedule."
    assert delete_response.status_code == 409
    assert delete_response.json() == {
        "detail": (
            "Document Version is retained until 2099-01-01T00:00:00Z "
            "and cannot be deleted yet."
        ),
    }


@pytest.mark.anyio
async def test_admin_deletes_document_version_after_retention_and_audit_trail_is_preserved(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    object_storage_root = tmp_path / "object-storage"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url, str(object_storage_root))

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    document_bytes = _make_pdf_bytes(
        [
            ("Travel Policy", 18),
            ("Delete me.", 12),
        ]
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        upload_response = await client.post(
            "/policy-documents/expense-policy/versions",
            headers={"Authorization": "Bearer admin-token"},
            files={
                "file": ("expense-policy.pdf", document_bytes, "application/pdf"),
                "retention_until": (None, "2000-01-01T00:00:00Z"),
                "retention_reason": (None, "Legacy retention window already satisfied."),
            },
        )

        assert upload_response.status_code == 201
        document_version = upload_response.json()

        storage_path = (
            Path(object_storage_root)
            / "policy-documents"
            / "expense-policy"
            / document_version["document_version_id"]
            / "expense-policy.pdf"
        )
        assert storage_path.exists()

        delete_response = await client.request(
            "DELETE",
            (
                "/policy-documents/expense-policy/versions/"
                f"{document_version['document_version_id']}"
            ),
            headers={"Authorization": "Bearer admin-token"},
            json={"reason": "Retention period satisfied; purge source bytes."},
        )
        download_response = await client.get(
            (
                "/policy-documents/expense-policy/versions/"
                f"{document_version['document_version_id']}"
            ),
            headers={"Authorization": "Bearer viewer-token"},
        )
        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={
                "entity_type": "document_version",
                "entity_id": document_version["document_version_id"],
            },
        )

    assert delete_response.status_code == 200
    deleted_version = delete_response.json()
    assert deleted_version["document_id"] == "expense-policy"
    assert deleted_version["retention_until"] == "2000-01-01T00:00:00Z"
    assert deleted_version["retention_reason"] == "Legacy retention window already satisfied."
    assert deleted_version["deleted_by"] == "admin-user"
    assert deleted_version["deletion_reason"] == "Retention period satisfied; purge source bytes."
    assert deleted_version["deleted_at"] is not None

    assert download_response.status_code == 410
    assert download_response.json() == {
        "detail": "Document Version has been deleted.",
    }
    assert not storage_path.exists()

    assert audit_response.status_code == 200
    assert audit_response.json() == {
        "items": [
            {
                "action": "document_version.uploaded",
                "actor_subject": "admin-user",
                "actor_roles": ["admin"],
                "entity_type": "document_version",
                "entity_id": document_version["document_version_id"],
                "payload": {
                    "document_id": "expense-policy",
                    "filename": "expense-policy.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": len(document_bytes),
                    "sha256": sha256(document_bytes).hexdigest(),
                    "retention_until": "2000-01-01T00:00:00Z",
                    "retention_reason": "Legacy retention window already satisfied.",
                },
            },
            {
                "action": "document_version.deleted",
                "actor_subject": "admin-user",
                "actor_roles": ["admin"],
                "entity_type": "document_version",
                "entity_id": document_version["document_version_id"],
                "payload": {
                    "document_id": "expense-policy",
                    "filename": "expense-policy.pdf",
                    "retention_until": "2000-01-01T00:00:00Z",
                    "deleted_at": deleted_version["deleted_at"],
                    "reason": "Retention period satisfied; purge source bytes.",
                },
            },
        ]
    }


@pytest.mark.anyio
async def test_delete_commit_failure_keeps_document_bytes_available(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    object_storage_root = tmp_path / "object-storage"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url, str(object_storage_root))

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    document_bytes = _make_pdf_bytes(
        [
            ("Travel Policy", 18),
            ("Commit failure.", 12),
        ]
    )
    commit_count = 0

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        upload_response = await client.post(
            "/policy-documents/expense-policy/versions",
            headers={"Authorization": "Bearer admin-token"},
            files={
                "file": ("expense-policy.pdf", document_bytes, "application/pdf"),
            },
        )

        assert upload_response.status_code == 201
        document_version = upload_response.json()

    storage_path = (
        Path(object_storage_root)
        / "policy-documents"
        / "expense-policy"
        / document_version["document_version_id"]
        / "expense-policy.pdf"
    )
    assert storage_path.exists()

    original_commit = Session.commit

    def flaky_commit(self) -> None:
        nonlocal commit_count
        commit_count += 1
        if commit_count == 1:
            raise RuntimeError("commit failed")
        original_commit(self)

    monkeypatch.setattr(Session, "commit", flaky_commit)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app(), raise_app_exceptions=False),
        base_url="http://testserver",
    ) as client:
        delete_response = await client.request(
            "DELETE",
            (
                "/policy-documents/expense-policy/versions/"
                f"{document_version['document_version_id']}"
            ),
            headers={"Authorization": "Bearer admin-token"},
            json={"reason": "Retention period satisfied; purge source bytes."},
        )
        download_response = await client.get(
            (
                "/policy-documents/expense-policy/versions/"
                f"{document_version['document_version_id']}"
            ),
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert delete_response.status_code == 500
    assert storage_path.exists()
    assert download_response.status_code == 200
    assert download_response.content == document_bytes


@pytest.mark.anyio
async def test_reason_fields_enforce_database_length_limits(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    object_storage_root = tmp_path / "object-storage"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url, str(object_storage_root))

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    document_bytes = _make_pdf_bytes(
        [
            ("Travel Policy", 18),
            ("Validated reasons.", 12),
        ]
    )
    oversized_reason = "x" * 501

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        upload_response = await client.post(
            "/policy-documents/expense-policy/versions",
            headers={"Authorization": "Bearer admin-token"},
            files={
                "file": ("expense-policy.pdf", document_bytes, "application/pdf"),
                "retention_reason": (None, oversized_reason),
            },
        )

        valid_upload_response = await client.post(
            "/policy-documents/expense-policy/versions",
            headers={"Authorization": "Bearer admin-token"},
            files={
                "file": ("expense-policy.pdf", document_bytes, "application/pdf"),
            },
        )

        assert valid_upload_response.status_code == 201
        document_version = valid_upload_response.json()

        delete_response = await client.request(
            "DELETE",
            (
                "/policy-documents/expense-policy/versions/"
                f"{document_version['document_version_id']}"
            ),
            headers={"Authorization": "Bearer admin-token"},
            json={"reason": oversized_reason},
        )
        download_response = await client.get(
            (
                "/policy-documents/expense-policy/versions/"
                f"{document_version['document_version_id']}"
            ),
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert upload_response.status_code == 422
    assert delete_response.status_code == 422
    assert download_response.status_code == 200
    assert download_response.content == document_bytes
