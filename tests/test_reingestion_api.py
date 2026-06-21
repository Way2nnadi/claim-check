import json
from io import BytesIO

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from policy_pipeline.database import (
    Base,
    DocumentVersionRecord,
    ExtractionRunRecord,
    PolicyVersionRecord,
)
from policy_pipeline.extraction_registry import save_model_configuration, save_prompt_template
from policy_pipeline.main import create_app
from policy_pipeline.rules import (
    Applicability,
    Citation,
    EnforceabilityClass,
    LifecycleState,
    PolicyVersionSnapshot,
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


def _build_published_rule(
    *,
    rule_id: str,
    statement: str,
    document_version_id: str,
    section_id: str,
    start_char: int,
    end_char: int,
    value: str,
) -> Rule:
    return Rule(
        rule_id=rule_id,
        statement=statement,
        enforceability_class=EnforceabilityClass.ENFORCEABLE,
        lifecycle_state=LifecycleState.PUBLISHED,
        origin=RuleOrigin(
            source_type=RuleOriginType.EXTRACTED,
            extraction_run_id="extract-expense-policy-v1",
        ),
        scope=Scope(
            expense_category="meals",
            employee_group="employees",
        ),
        citation=Citation(
            document_id="expense-policy",
            document_version_id=document_version_id,
            section_id=section_id,
            quote=statement,
            start_char=start_char,
            end_char=end_char,
        ),
        condition=RuleCondition(
            field="meal.amount",
            operator="<=",
            value=value,
        ),
        applicability=Applicability(
            aggregation_period="per_day",
            unit="money",
            currency="USD",
            limit_basis="per employee",
        ),
        exceptions=[],
    )


@pytest.mark.anyio
async def test_admin_reingests_document_version_and_returns_added_diff_without_baseline(
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
                                "scope": {
                                    "expense_category": "meals",
                                },
                                "condition": {
                                    "field": "meal.amount",
                                    "operator": "<=",
                                    "value": "75",
                                },
                                "applicability": {
                                    "aggregation_period": "per_day",
                                    "unit": "money",
                                    "currency": "USD",
                                    "limit_basis": "per employee",
                                },
                                "citation_quote": "Meals are capped at $75 per day.",
                            }
                        ]
                    }
                ]
            },
        )
    engine.dispose()

    first_document_bytes = _make_pdf_bytes(
        [
            ("Travel Policy", 18),
            ("Meals are capped at $50 per day.", 12),
        ]
    )
    second_document_bytes = _make_pdf_bytes(
        [
            ("Travel Policy", 18),
            ("Meals are capped at $75 per day.", 12),
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
                    "expense-policy.pdf",
                    first_document_bytes,
                    "application/pdf",
                )
            },
        )
        reingestion_response = await client.post(
            "/policy-documents/expense-policy/reingestions",
            headers={"Authorization": "Bearer admin-token"},
            data={
                "extraction_run_id": "extract-expense-policy-v2",
                "prompt_template_id": "rule-extraction",
                "prompt_template_version": "v1",
                "model_configuration_id": "fake-openai",
                "model_configuration_version": "v1",
            },
            files={
                "file": (
                    "expense-policy.pdf",
                    second_document_bytes,
                    "application/pdf",
                )
            },
        )

    assert first_upload_response.status_code == 201
    assert reingestion_response.status_code == 201
    response_body = reingestion_response.json()

    assert response_body["document_version"]["document_id"] == "expense-policy"
    assert response_body["document_version"]["document_version_id"] != first_upload_response.json()[
        "document_version_id"
    ]
    assert response_body["extraction_run"]["extraction_run_id"] == "extract-expense-policy-v2"
    assert response_body["diff"]["baseline_policy_version_id"] is None
    assert [rule["rule_id"] for rule in response_body["diff"]["added"]] == [
        "extract-expense-policy-v2:1"
    ]
    assert response_body["diff"]["changed"] == []
    assert response_body["diff"]["removed"] == []
    assert response_body["diff"]["unchanged"] == []

    engine = create_engine(database_url)
    with Session(engine) as session:
        stored_versions = session.scalars(
            select(DocumentVersionRecord).order_by(DocumentVersionRecord.created_at)
        ).all()
        extraction_run = session.get(ExtractionRunRecord, "extract-expense-policy-v2")
    engine.dispose()

    assert [record.document_id for record in stored_versions] == [
        "expense-policy",
        "expense-policy",
    ]
    assert extraction_run is not None
    assert extraction_run.document_version_id == response_body["document_version"][
        "document_version_id"
    ]


@pytest.mark.anyio
async def test_admin_reingestion_diffs_candidate_rules_against_current_policy_version(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    object_storage_root = tmp_path / "object-storage"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url, str(object_storage_root))

    current_rules = [
        _build_published_rule(
            rule_id="rule-current-domestic-meals",
            statement="Domestic meals are capped at $75 per day.",
            document_version_id="docv-old",
            section_id="meals#domestic-v1",
            start_char=10,
            end_char=50,
            value="75",
        ),
        _build_published_rule(
            rule_id="rule-current-international-meals",
            statement="International meals are capped at $100 per day.",
            document_version_id="docv-old",
            section_id="meals#international-v1",
            start_char=55,
            end_char=103,
            value="100",
        ),
        _build_published_rule(
            rule_id="rule-current-ground-transport",
            statement="Ground transport is capped at $60 per day.",
            document_version_id="docv-old",
            section_id="transport#ground-v1",
            start_char=108,
            end_char=151,
            value="60",
        ),
    ]

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
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
                                "statement": "Domestic meals are capped at $75 per day.",
                                "enforceability_class": "enforceable",
                                "scope": {
                                    "expense_category": "meals",
                                    "employee_group": "employees",
                                },
                                "condition": {
                                    "field": "meal.amount",
                                    "operator": "<=",
                                    "value": "75",
                                },
                                "applicability": {
                                    "aggregation_period": "per_day",
                                    "unit": "money",
                                    "currency": "USD",
                                    "limit_basis": "per employee",
                                },
                                "citation_quote": "Domestic meals are capped at $75 per day.",
                            },
                            {
                                "statement": "International meals are capped at $110 per day.",
                                "enforceability_class": "enforceable",
                                "scope": {
                                    "expense_category": "meals",
                                    "employee_group": "employees",
                                },
                                "condition": {
                                    "field": "meal.amount",
                                    "operator": "<=",
                                    "value": "110",
                                },
                                "applicability": {
                                    "aggregation_period": "per_day",
                                    "unit": "money",
                                    "currency": "USD",
                                    "limit_basis": "per employee",
                                },
                                "citation_quote": "International meals are capped at $110 per day.",
                            },
                            {
                                "statement": "Lodging is capped at $250 per night.",
                                "enforceability_class": "enforceable",
                                "scope": {
                                    "expense_category": "lodging",
                                    "employee_group": "employees",
                                },
                                "condition": {
                                    "field": "lodging.amount",
                                    "operator": "<=",
                                    "value": "250",
                                },
                                "applicability": {
                                    "aggregation_period": "per_night",
                                    "unit": "money",
                                    "currency": "USD",
                                    "limit_basis": "per employee",
                                },
                                "citation_quote": "Lodging is capped at $250 per night.",
                            },
                        ]
                    }
                ]
            },
        )
        session.add(
            PolicyVersionRecord(
                policy_version_id="policy-v1",
                published_by="approver-user",
                change_summary="Initial published policy version.",
                snapshot=PolicyVersionSnapshot(
                    policy_version_id="policy-v1",
                    published_by="approver-user",
                    change_summary="Initial published policy version.",
                    rules=current_rules,
                ).model_dump(mode="json"),
            )
        )
        session.commit()
    engine.dispose()

    reingested_document_bytes = _make_pdf_bytes(
        [
            ("Travel Policy", 18),
            ("Domestic meals are capped at $75 per day.", 12),
            ("International meals are capped at $110 per day.", 12),
            ("Lodging is capped at $250 per night.", 12),
        ]
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        reingestion_response = await client.post(
            "/policy-documents/expense-policy/reingestions",
            headers={"Authorization": "Bearer admin-token"},
            data={
                "extraction_run_id": "extract-expense-policy-v3",
                "prompt_template_id": "rule-extraction",
                "prompt_template_version": "v1",
                "model_configuration_id": "fake-openai",
                "model_configuration_version": "v1",
            },
            files={
                "file": (
                    "expense-policy.pdf",
                    reingested_document_bytes,
                    "application/pdf",
                )
            },
        )

    assert reingestion_response.status_code == 201
    response_body = reingestion_response.json()

    assert response_body["diff"]["baseline_policy_version_id"] == "policy-v1"
    assert [rule["rule_id"] for rule in response_body["diff"]["added"]] == [
        "extract-expense-policy-v3:3"
    ]
    assert response_body["diff"]["changed"] == [
        {
            "current_rule": current_rules[1].model_dump(mode="json"),
            "candidate_rule": {
                **response_body["extraction_run"]["candidate_rules"][1],
            },
            "lifecycle_state": "superseded",
        }
    ]
    assert response_body["diff"]["removed"] == [
        {
            "current_rule": current_rules[2].model_dump(mode="json"),
            "lifecycle_state": "withdrawn",
        }
    ]
    assert response_body["diff"]["unchanged"] == [
        {
            "current_rule": current_rules[0].model_dump(mode="json"),
            "candidate_rule": {
                **response_body["extraction_run"]["candidate_rules"][0],
            },
        }
    ]
