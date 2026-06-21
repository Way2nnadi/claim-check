from __future__ import annotations

import json
from io import BytesIO

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from policy_pipeline.database import Base
from policy_pipeline.extraction_registry import save_model_configuration, save_prompt_template
from policy_pipeline.main import create_app
from policy_pipeline.rule_store import create_rule
from policy_pipeline.rules import (
    Applicability,
    Citation,
    EnforceabilityClass,
    LifecycleState,
    Rule,
    RuleCondition,
    RuleOrigin,
    RuleOriginType,
    Scope,
)


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


def _make_pdf_bytes(lines: list[tuple[str, int]]) -> bytes:
    objects: list[bytes] = []

    def add_object(payload: bytes) -> int:
        objects.append(payload)
        return len(objects)

    add_object(b"<< /Type /Catalog /Pages 2 0 R >>")
    add_object(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")

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

    add_object(
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
    )
    add_object(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    add_object(
        f"<< /Length {len(content_stream)} >>\nstream\n".encode()
        + content_stream
        + b"\nendstream"
    )

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


def _seed_registry(session: Session) -> None:
    save_prompt_template(
        session,
        prompt_template_id="rule-extraction",
        version="v1",
        template="Extract candidate Rules from the Policy Document.",
    )
    save_model_configuration(
        session,
        model_configuration_id="fake-openai",
        version="v1",
        model="gpt-5-mini",
        endpoint="https://fake-openai.local/v1/chat/completions",
        settings={
            "fake_structured_outputs": [
                {
                    "candidate_rules": [
                        {
                            "statement": "Meals are capped at $75 per day.",
                            "enforceability_class": "enforceable",
                            "scope": {"expense_category": "meals"},
                            "condition": {
                                "field": "meal.amount",
                                "operator": "<=",
                                "value": "75",
                            },
                            "applicability": {
                                "aggregation_period": "per_day",
                                "unit": "money",
                                "currency": "USD",
                            },
                            "citation_quote": "Meals are capped at $75 per day.",
                        }
                    ]
                }
            ]
        },
    )


@pytest.mark.anyio
async def test_list_document_versions_excludes_deleted_by_default(
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

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        first_upload = await client.post(
            "/policy-documents/expense-policy/versions",
            headers={"Authorization": "Bearer admin-token"},
            files={
                "file": (
                    "expense-policy-v1.pdf",
                    document_bytes,
                    "application/pdf",
                )
            },
        )
        second_upload = await client.post(
            "/policy-documents/expense-policy/versions",
            headers={"Authorization": "Bearer admin-token"},
            files={
                "file": (
                    "expense-policy-v2.pdf",
                    document_bytes,
                    "application/pdf",
                )
            },
        )
        first_version_id = first_upload.json()["document_version_id"]
        delete_response = await client.request(
            "DELETE",
            f"/policy-documents/expense-policy/versions/{first_version_id}",
            headers={"Authorization": "Bearer admin-token"},
            json={"reason": "superseded by v2"},
        )
        assert delete_response.status_code == 200
        default_list = await client.get(
            "/policy-documents/expense-policy/versions",
            headers={"Authorization": "Bearer viewer-token"},
        )
        include_deleted_list = await client.get(
            "/policy-documents/expense-policy/versions",
            headers={"Authorization": "Bearer viewer-token"},
            params={"include_deleted": "true"},
        )

    assert first_upload.status_code == 201
    assert second_upload.status_code == 201
    assert default_list.status_code == 200
    assert include_deleted_list.status_code == 200

    default_ids = [item["document_version_id"] for item in default_list.json()["items"]]
    include_deleted_ids = [
        item["document_version_id"] for item in include_deleted_list.json()["items"]
    ]
    second_version_id = second_upload.json()["document_version_id"]

    assert default_ids == [second_version_id]
    assert set(include_deleted_ids) == {second_version_id, first_version_id}
    deleted_item = next(
        item
        for item in include_deleted_list.json()["items"]
        if item["document_version_id"] == first_version_id
    )
    assert deleted_item["deletion_reason"] == "superseded by v2"


@pytest.mark.anyio
async def test_list_candidate_rules_supports_lifecycle_and_document_filters(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    object_storage_root = tmp_path / "object-storage"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url, str(object_storage_root))

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        _seed_registry(session)
    engine.dispose()

    document_bytes = _make_pdf_bytes(
        [
            ("Travel Policy", 18),
            ("Meals are capped at $75 per day.", 12),
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
                "file": (
                    "expense-policy.pdf",
                    document_bytes,
                    "application/pdf",
                )
            },
        )
        document_version_id = upload_response.json()["document_version_id"]
        extraction_response = await client.post(
            f"/policy-documents/expense-policy/versions/{document_version_id}/extraction-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={
                "extraction_run_id": "extract-expense-policy-v1",
                "prompt_template_id": "rule-extraction",
                "prompt_template_version": "v1",
                "model_configuration_id": "fake-openai",
                "model_configuration_version": "v1",
            },
        )
        all_candidates = await client.get(
            "/candidate-rules",
            headers={"Authorization": "Bearer approver-token"},
        )
        extracted_only = await client.get(
            "/candidate-rules",
            headers={"Authorization": "Bearer approver-token"},
            params={
                "lifecycle_state": ["extracted"],
                "document_id": "expense-policy",
                "extraction_run_id": "extract-expense-policy-v1",
            },
        )
        unauthenticated = await client.get("/candidate-rules")

    assert upload_response.status_code == 201
    assert extraction_response.status_code == 201
    assert all_candidates.status_code == 200
    assert extracted_only.status_code == 200
    assert unauthenticated.status_code == 401

    candidate_rule_id = extraction_response.json()["candidate_rules"][0]["rule_id"]
    assert [item["candidate_rule_id"] for item in all_candidates.json()["items"]] == [
        candidate_rule_id
    ]
    assert extracted_only.json()["items"][0]["lifecycle_state"] == "extracted"
    assert (
        extracted_only.json()["items"][0]["current_rule"]["citation"]["document_id"]
        == "expense-policy"
    )


@pytest.mark.anyio
async def test_list_extraction_runs_returns_run_metadata_and_candidate_counts(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    object_storage_root = tmp_path / "object-storage"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url, str(object_storage_root))

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        _seed_registry(session)
    engine.dispose()

    document_bytes = _make_pdf_bytes(
        [
            ("Travel Policy", 18),
            ("Meals are capped at $75 per day.", 12),
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
                "file": (
                    "expense-policy.pdf",
                    document_bytes,
                    "application/pdf",
                )
            },
        )
        document_version_id = upload_response.json()["document_version_id"]
        await client.post(
            f"/policy-documents/expense-policy/versions/{document_version_id}/extraction-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={
                "extraction_run_id": "extract-expense-policy-v1",
                "prompt_template_id": "rule-extraction",
                "prompt_template_version": "v1",
                "model_configuration_id": "fake-openai",
                "model_configuration_version": "v1",
            },
        )
        nested_list = await client.get(
            f"/policy-documents/expense-policy/versions/{document_version_id}/extraction-runs",
            headers={"Authorization": "Bearer viewer-token"},
        )
        global_list = await client.get(
            "/extraction-runs",
            headers={"Authorization": "Bearer viewer-token"},
            params={"document_id": "expense-policy"},
        )
        missing_document_version = await client.get(
            "/policy-documents/expense-policy/versions/docv-missing/extraction-runs",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert nested_list.status_code == 200
    assert global_list.status_code == 200
    assert missing_document_version.status_code == 404

    run_item = nested_list.json()["items"][0]
    assert run_item["extraction_run_id"] == "extract-expense-policy-v1"
    assert run_item["document_id"] == "expense-policy"
    assert run_item["document_version_id"] == document_version_id
    assert run_item["candidate_rule_count"] == 1
    assert global_list.json()["items"] == nested_list.json()["items"]


@pytest.mark.anyio
async def test_list_policy_versions_returns_newest_first(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    object_storage_root = tmp_path / "object-storage"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url, str(object_storage_root))

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        create_rule(
            session,
            rule=Rule(
                rule_id="rule-meals-cap",
                statement="Meals are capped at $75 per day.",
                enforceability_class=EnforceabilityClass.ENFORCEABLE,
                lifecycle_state=LifecycleState.APPROVED,
                origin=RuleOrigin(
                    source_type=RuleOriginType.EXTRACTED,
                    extraction_run_id="extract-expense-policy-v1",
                ),
                scope=Scope(expense_category="meals"),
                citation=Citation(
                    document_id="expense-policy",
                    document_version_id="expense-policy-v1",
                    section_id="meals-abc123",
                    quote="Meals are capped at $75 per day.",
                    start_char=10,
                    end_char=42,
                ),
                condition=RuleCondition(field="meal.amount", operator="<=", value="75"),
                applicability=Applicability(
                    aggregation_period="per_day",
                    unit="money",
                    currency="USD",
                ),
            ),
        )
    engine.dispose()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await client.post(
            "/policy-versions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "policy_version_id": "policy-v1",
                "change_summary": "Initial publish",
            },
        )
        await client.post(
            "/policy-versions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "policy_version_id": "policy-v2",
                "change_summary": "Second publish",
            },
        )
        list_response = await client.get(
            "/policy-versions",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert list_response.status_code == 200
    items = list_response.json()["items"]
    assert [item["policy_version_id"] for item in items] == ["policy-v2", "policy-v1"]
    assert items[0]["rule_count"] == 1
    assert items[0]["published_by"] == "approver-user"
    assert items[0]["change_summary"] == "Second publish"
