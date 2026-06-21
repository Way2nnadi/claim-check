import json
from io import BytesIO

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from policy_pipeline.database import Base, ExtractionRunRecord, RuleRecord
from policy_pipeline.extraction_registry import save_model_configuration, save_prompt_template
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


@pytest.mark.anyio
async def test_admin_creates_extraction_run_and_persists_extracted_candidate_rules(
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
                            },
                            {
                                "statement": "Hotel stays require itemized receipts.",
                                "enforceability_class": "guidance",
                                "scope": {
                                    "expense_category": "lodging",
                                },
                                "citation_quote": "Hotel stays require itemized receipts.",
                            },
                        ]
                    }
                ]
            },
        )
    engine.dispose()

    document_bytes = _make_pdf_bytes(
        [
            ("Travel Policy", 18),
            ("Meals are capped at $75 per day.", 12),
            ("Lodging", 18),
            ("Hotel stays require itemized receipts.", 12),
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
        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={
                "entity_type": "extraction_run",
                "entity_id": "extract-expense-policy-v1",
            },
        )

    assert upload_response.status_code == 201
    assert extraction_response.status_code == 201
    assert audit_response.status_code == 200
    response_body = extraction_response.json()
    assert response_body["extraction_run_id"] == "extract-expense-policy-v1"
    assert response_body["document_version_id"] == document_version_id
    assert response_body["prompt_template_id"] == "rule-extraction"
    assert response_body["prompt_template_version"] == "v1"
    assert response_body["model_configuration_id"] == "fake-openai"
    assert response_body["model_configuration_version"] == "v1"
    assert response_body["attempt_count"] == 1
    assert response_body["candidate_rules"] == [
        {
            "rule_id": "extract-expense-policy-v1:1",
            "statement": "Meals are capped at $75 per day.",
            "enforceability_class": "enforceable",
            "lifecycle_state": "extracted",
            "origin": {
                "source_type": "extracted",
                "extraction_run_id": "extract-expense-policy-v1",
                "rationale": None,
            },
            "scope": {
                "country": None,
                "expense_category": "meals",
                "travel_type": None,
                "employee_group": None,
                "effective_start_date": None,
                "effective_end_date": None,
            },
            "citation": {
                "document_id": "expense-policy",
                "document_version_id": document_version_id,
                "section_id": response_body["candidate_rules"][0]["citation"]["section_id"],
                "quote": "Meals are capped at $75 per day.",
                "start_char": response_body["candidate_rules"][0]["citation"]["start_char"],
                "end_char": response_body["candidate_rules"][0]["citation"]["end_char"],
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
            "exceptions": [],
            "qa_flags": [],
        },
        {
            "rule_id": "extract-expense-policy-v1:2",
            "statement": "Hotel stays require itemized receipts.",
            "enforceability_class": "guidance",
            "lifecycle_state": "extracted",
            "origin": {
                "source_type": "extracted",
                "extraction_run_id": "extract-expense-policy-v1",
                "rationale": None,
            },
            "scope": {
                "country": None,
                "expense_category": "lodging",
                "travel_type": None,
                "employee_group": None,
                "effective_start_date": None,
                "effective_end_date": None,
            },
            "citation": {
                "document_id": "expense-policy",
                "document_version_id": document_version_id,
                "section_id": response_body["candidate_rules"][1]["citation"]["section_id"],
                "quote": "Hotel stays require itemized receipts.",
                "start_char": response_body["candidate_rules"][1]["citation"]["start_char"],
                "end_char": response_body["candidate_rules"][1]["citation"]["end_char"],
            },
            "condition": None,
            "applicability": None,
            "exceptions": [],
            "qa_flags": [],
        },
    ]
    first_citation = response_body["candidate_rules"][0]["citation"]
    second_citation = response_body["candidate_rules"][1]["citation"]
    assert first_citation["end_char"] > first_citation["start_char"]
    assert second_citation["end_char"] > second_citation["start_char"]
    assert audit_response.json() == {
        "items": [
            {
                "action": "extraction_run.created",
                "actor_subject": "admin-user",
                "actor_roles": ["admin"],
                "entity_type": "extraction_run",
                "entity_id": "extract-expense-policy-v1",
                "payload": {
                    "document_id": "expense-policy",
                    "document_version_id": document_version_id,
                    "prompt_template_id": "rule-extraction",
                    "prompt_template_version": "v1",
                    "model_configuration_id": "fake-openai",
                    "model_configuration_version": "v1",
                    "attempt_count": 1,
                    "candidate_rule_count": 2,
                },
            }
        ]
    }

    engine = create_engine(database_url)
    with Session(engine) as session:
        extraction_run = session.get(ExtractionRunRecord, "extract-expense-policy-v1")
        stored_rules = session.scalars(select(RuleRecord).order_by(RuleRecord.rule_id)).all()
    engine.dispose()

    assert extraction_run is not None
    assert extraction_run.document_version_id == document_version_id
    assert extraction_run.prompt_template_id == "rule-extraction"
    assert extraction_run.prompt_template_version == "v1"
    assert extraction_run.model_configuration_id == "fake-openai"
    assert extraction_run.model_configuration_version == "v1"
    assert [record.rule_id for record in stored_rules] == [
        "extract-expense-policy-v1:1",
        "extract-expense-policy-v1:2",
    ]


@pytest.mark.anyio
async def test_extraction_run_retries_invalid_structured_output_before_persisting_rules(
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
                "max_validation_attempts": 2,
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
                            }
                        ]
                    },
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
                                "citation_quote": "Meals are capped at $75 per day.",
                            }
                        ]
                    },
                ]
            },
        )
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
                "extraction_run_id": "extract-expense-policy-v2",
                "prompt_template_id": "rule-extraction",
                "prompt_template_version": "v1",
                "model_configuration_id": "fake-openai",
                "model_configuration_version": "v1",
            },
        )

    assert upload_response.status_code == 201
    assert extraction_response.status_code == 201
    assert extraction_response.json()["attempt_count"] == 2
    assert extraction_response.json()["candidate_rules"][0]["citation"]["quote"] == (
        "Meals are capped at $75 per day."
    )

    engine = create_engine(database_url)
    with Session(engine) as session:
        stored_rules = session.scalars(select(RuleRecord).order_by(RuleRecord.rule_id)).all()
    engine.dispose()

    assert [record.rule_id for record in stored_rules] == ["extract-expense-policy-v2:1"]


@pytest.mark.anyio
async def test_extraction_run_rejects_malformed_partial_conditions_instead_of_flagging_them(
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
                "max_validation_attempts": 1,
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
                ],
            },
        )
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
                "extraction_run_id": "extract-expense-policy-v2b",
                "prompt_template_id": "rule-extraction",
                "prompt_template_version": "v1",
                "model_configuration_id": "fake-openai",
                "model_configuration_version": "v1",
            },
        )

    assert upload_response.status_code == 201
    assert extraction_response.status_code == 422
    assert extraction_response.json() == {
        "detail": "Structured extraction output could not be validated after 1 attempts."
    }

    engine = create_engine(database_url)
    with Session(engine) as session:
        extraction_run = session.get(ExtractionRunRecord, "extract-expense-policy-v2b")
        stored_rules = session.scalars(select(RuleRecord).order_by(RuleRecord.rule_id)).all()
    engine.dispose()

    assert extraction_run is not None
    assert stored_rules == []


@pytest.mark.anyio
async def test_extraction_run_attaches_deterministic_qa_flags_to_candidate_rules(
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
                "max_validation_attempts": 1,
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
                                },
                                "applicability": {
                                    "aggregation_period": "per_day",
                                    "unit": "money",
                                    "currency": "USD",
                                },
                                "citation_quote": "Meals are capped at $75 per day.",
                            },
                            {
                                "statement": "Lodging is capped at $250 per night.",
                                "enforceability_class": "enforceable",
                                "scope": {
                                    "expense_category": "lodging",
                                },
                                "condition": {
                                    "field": "lodging.amount",
                                    "operator": "<=",
                                    "value": "250",
                                },
                                "applicability": {
                                    "aggregation_period": "per_quarter",
                                    "unit": "money",
                                    "currency": "USD",
                                },
                                "citation_quote": "Lodging is capped at $250 per night.",
                            },
                            {
                                "statement": "Ground transportation is capped at $50 per day.",
                                "enforceability_class": "enforceable",
                                "scope": {
                                    "expense_category": "transportation",
                                },
                                "condition": {
                                    "field": "ground_transport.amount",
                                    "operator": "<=",
                                    "value": "50",
                                },
                                "citation_quote": "Ground transportation is capped at $50 per day.",
                            },
                            {
                                "statement": "Client dinners are capped at $150 per event.",
                                "enforceability_class": "enforceable",
                                "scope": {
                                    "expense_category": "meals",
                                },
                                "condition": {
                                    "field": "meal.amount",
                                    "operator": "<=",
                                    "value": "150",
                                },
                                "applicability": {
                                    "aggregation_period": "per_transaction",
                                    "unit": "money",
                                    "currency": "USD",
                                },
                                "citation_quote": "Client dinners are capped at $150 per event.",
                                "extraction_confidence": 0.41,
                            },
                            {
                                "statement": "Breakfast is capped at $25 per day.",
                                "enforceability_class": "enforceable",
                                "scope": {
                                    "expense_category": "meals",
                                },
                                "condition": {
                                    "field": "meal.amount",
                                    "operator": "<=",
                                    "value": "25",
                                },
                                "applicability": {
                                    "aggregation_period": "per_day",
                                    "unit": "money",
                                    "currency": "USD",
                                },
                                "citation_quote": (
                                    "International breakfasts are capped at $40 per day."
                                ),
                            }
                        ]
                    }
                ],
            },
        )
    engine.dispose()

    document_bytes = _make_pdf_bytes(
        [
            ("Travel Policy", 18),
            ("Meals are capped at $75 per day.", 12),
            ("Lodging is capped at $250 per night.", 12),
            ("Ground transportation is capped at $50 per day.", 12),
            ("Client dinners are capped at $150 per event.", 12),
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
                "extraction_run_id": "extract-expense-policy-v3",
                "prompt_template_id": "rule-extraction",
                "prompt_template_version": "v1",
                "model_configuration_id": "fake-openai",
                "model_configuration_version": "v1",
            },
        )

    assert upload_response.status_code == 201
    assert extraction_response.status_code == 201
    response_body = extraction_response.json()
    assert response_body["attempt_count"] == 1
    assert [candidate_rule["rule_id"] for candidate_rule in response_body["candidate_rules"]] == [
        "extract-expense-policy-v3:1",
        "extract-expense-policy-v3:2",
        "extract-expense-policy-v3:3",
        "extract-expense-policy-v3:4",
        "extract-expense-policy-v3:5",
    ]
    assert response_body["candidate_rules"][0]["lifecycle_state"] == "extracted"
    assert response_body["candidate_rules"][0]["citation"]["quote"] == (
        "Meals are capped at $75 per day."
    )
    assert response_body["candidate_rules"][0]["condition"] is None
    assert response_body["candidate_rules"][0]["qa_flags"] == [
        {
            "code": "missing_threshold",
            "detail": "Quantitative Candidate Rule is missing a threshold value.",
        }
    ]
    assert response_body["candidate_rules"][1]["applicability"] is None
    assert response_body["candidate_rules"][1]["qa_flags"] == [
        {
            "code": "invalid_enum",
            "detail": (
                "Candidate Rule contains an invalid enum value for "
                "applicability.aggregation_period: 'per_quarter'."
            ),
        }
    ]
    assert response_body["candidate_rules"][2]["applicability"] is None
    assert response_body["candidate_rules"][2]["qa_flags"] == [
        {
            "code": "missing_applicability",
            "detail": "Quantitative Candidate Rule is missing Applicability.",
        }
    ]
    assert response_body["candidate_rules"][3]["qa_flags"] == [
        {
            "code": "low_extraction_confidence",
            "detail": "Candidate Rule extraction confidence 0.41 is below 0.75.",
        }
    ]
    assert response_body["candidate_rules"][4]["citation"] is None
    assert response_body["candidate_rules"][4]["qa_flags"] == [
        {
            "code": "unresolvable_citation",
            "detail": (
                "Candidate Rule Citation quote could not be resolved: "
                "'International breakfasts are capped at $40 per day.'."
            ),
        }
    ]

    engine = create_engine(database_url)
    with Session(engine) as session:
        extraction_run = session.get(ExtractionRunRecord, "extract-expense-policy-v3")
        stored_rules = session.scalars(select(RuleRecord).order_by(RuleRecord.rule_id)).all()
    engine.dispose()

    assert extraction_run is not None
    assert extraction_run.document_version_id == document_version_id
    assert [record.rule_id for record in stored_rules] == [
        "extract-expense-policy-v3:1",
        "extract-expense-policy-v3:2",
        "extract-expense-policy-v3:3",
        "extract-expense-policy-v3:4",
        "extract-expense-policy-v3:5",
    ]
    assert stored_rules[0].payload["qa_flags"] == [
        {
            "code": "missing_threshold",
            "detail": "Quantitative Candidate Rule is missing a threshold value.",
        }
    ]
    assert stored_rules[4].payload["citation"] is None
    assert stored_rules[4].payload["qa_flags"] == [
        {
            "code": "unresolvable_citation",
            "detail": (
                "Candidate Rule Citation quote could not be resolved: "
                "'International breakfasts are capped at $40 per day.'."
            ),
        }
    ]


@pytest.mark.anyio
async def test_extraction_run_rejects_hosted_llm_endpoints_when_outbound_network_is_disabled(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    object_storage_root = tmp_path / "object-storage"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url, str(object_storage_root))
    monkeypatch.setenv("POLICY_PIPELINE_LLM_HOSTED_ENDPOINTS_ENABLED", "false")

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
            model_configuration_id="openai-primary",
            version="v1",
            model="gpt-5-mini",
            endpoint="https://api.openai.com/v1/chat/completions",
            settings={"temperature": 0},
        )
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
                "extraction_run_id": "extract-expense-policy-v4",
                "prompt_template_id": "rule-extraction",
                "prompt_template_version": "v1",
                "model_configuration_id": "openai-primary",
                "model_configuration_version": "v1",
            },
        )

    assert upload_response.status_code == 201
    assert extraction_response.status_code == 422
    assert extraction_response.json() == {
        "detail": "Hosted OpenAI-compatible endpoints are disabled by runtime configuration."
    }

    engine = create_engine(database_url)
    with Session(engine) as session:
        extraction_run = session.get(ExtractionRunRecord, "extract-expense-policy-v4")
        stored_rules = session.scalars(select(RuleRecord).order_by(RuleRecord.rule_id)).all()
    engine.dispose()

    assert extraction_run is None
    assert stored_rules == []


@pytest.mark.anyio
async def test_extraction_run_rejects_deleted_document_versions(
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
            settings={"fake_structured_outputs": []},
        )
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
        delete_response = await client.request(
            "DELETE",
            f"/policy-documents/expense-policy/versions/{document_version_id}",
            headers={"Authorization": "Bearer admin-token"},
            json={"reason": "Retention policy satisfied."},
        )
        extraction_response = await client.post(
            f"/policy-documents/expense-policy/versions/{document_version_id}/extraction-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={
                "extraction_run_id": "extract-expense-policy-v5",
                "prompt_template_id": "rule-extraction",
                "prompt_template_version": "v1",
                "model_configuration_id": "fake-openai",
                "model_configuration_version": "v1",
            },
        )

    assert upload_response.status_code == 201
    assert delete_response.status_code == 200
    assert extraction_response.status_code == 410
    assert extraction_response.json() == {"detail": "Document Version has been deleted."}

    engine = create_engine(database_url)
    with Session(engine) as session:
        extraction_run = session.get(ExtractionRunRecord, "extract-expense-policy-v5")
    engine.dispose()

    assert extraction_run is None
