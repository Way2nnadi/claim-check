import json
from hashlib import sha256

import httpx
import pytest
from sqlalchemy import create_engine

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

    document_bytes = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"
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

    first_document_bytes = b"PK\x03\x04first-docx-version"
    second_document_bytes = b"PK\x03\x04second-docx-version"

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

    document_bytes = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"
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
