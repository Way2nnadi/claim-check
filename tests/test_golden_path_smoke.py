"""Golden path smoke: Policy Document ingestion through audit evidence.

This module exercises the demoable workflow end to end via HTTP API calls:

1. Upload a Policy Document version
2. Run Extraction to produce Candidate Rules
3. Approve the extracted meal-cap Candidate Rule
4. Publish a Policy Version snapshot
5. Compile a Compiled Rule Set
6. Generate Rule Test Cases
7. Prove Compliance Evaluation Runs are blocked until a green Rule Test Run
8. Execute a passing Rule Test Run
9. Import an Expense Report
10. Execute a Compliance Evaluation Run
11. Resolve the Compliance Review with human rationale
12. Inspect audit evidence for the run and review decision

Each step uses the public API surface rather than seeding intermediate workflow
state directly in the database.
"""

from __future__ import annotations

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from policy_pipeline.extraction.registry import save_model_configuration, save_prompt_template
from policy_pipeline.main import create_app
from policy_pipeline.shared.database import Base
from tests.test_compiled_rule_sets_api import _configure_local_auth_with_admin
from tests.test_compliance_evaluation_runs_api import (
    _generate_rule_test_cases,
    _import_expense_report,
)
from tests.test_extraction_runs_api import _make_pdf_bytes
from tests.test_rule_test_cases_api import _compile_policy_version, _publish_policy_version

GOLDEN_DOCUMENT_ID = "expense-policy"
GOLDEN_EXTRACTION_RUN_ID = "extract-golden-path-v1"
GOLDEN_POLICY_VERSION_ID = "policy-golden-v1"
MEAL_CAP_STATEMENT = "Domestic meals are capped at $75 per day."
MEAL_CAP_CITATION_QUOTE = MEAL_CAP_STATEMENT
REVIEW_RATIONALE = (
    "Golden path review upheld the extracted domestic meal cap after citation check."
)


def _configure_golden_path_environment(
    monkeypatch: pytest.MonkeyPatch,
    database_url: str,
    object_storage_root: str,
) -> None:
    monkeypatch.setenv("POLICY_PIPELINE_OBJECT_STORAGE_ROOT", object_storage_root)
    _configure_local_auth_with_admin(monkeypatch, database_url)


def _seed_extraction_registry(database_url: str) -> None:
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
                                "statement": MEAL_CAP_STATEMENT,
                                "enforceability_class": "enforceable",
                                "scope": {
                                    "expense_category": "meals",
                                    "country": "domestic",
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
                                "citation_quote": MEAL_CAP_CITATION_QUOTE,
                            }
                        ]
                    }
                ]
            },
        )
    engine.dispose()


@pytest.mark.anyio
async def test_golden_path_from_policy_document_to_audit_evidence(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    object_storage_root = tmp_path / "object-storage"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_golden_path_environment(monkeypatch, database_url, str(object_storage_root))
    _seed_extraction_registry(database_url)

    document_bytes = _make_pdf_bytes(
        [
            ("Travel Policy", 18),
            (MEAL_CAP_CITATION_QUOTE, 12),
        ]
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        upload_response = await client.post(
            f"/policy-documents/{GOLDEN_DOCUMENT_ID}/versions",
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
        document_version_id = upload_response.json()["document_version_id"]

        extraction_response = await client.post(
            (
                f"/policy-documents/{GOLDEN_DOCUMENT_ID}/versions/"
                f"{document_version_id}/extraction-runs"
            ),
            headers={"Authorization": "Bearer admin-token"},
            json={
                "extraction_run_id": GOLDEN_EXTRACTION_RUN_ID,
                "prompt_template_id": "rule-extraction",
                "prompt_template_version": "v1",
                "model_configuration_id": "fake-openai",
                "model_configuration_version": "v1",
            },
        )
        assert extraction_response.status_code == 201
        extracted_rules = extraction_response.json()["candidate_rules"]
        assert len(extracted_rules) == 1
        candidate_rule_id = extracted_rules[0]["rule_id"]
        assert extracted_rules[0]["statement"] == MEAL_CAP_STATEMENT

        approval_response = await client.post(
            f"/candidate-rules/{candidate_rule_id}/approvals",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "rationale": "Citation verified against uploaded Policy Document section.",
            },
        )
        assert approval_response.status_code == 201

        await _publish_policy_version(client, GOLDEN_POLICY_VERSION_ID)
        compiled = await _compile_policy_version(client, GOLDEN_POLICY_VERSION_ID)
        compiled_rule_set_id = compiled["compiled_rule_set_id"]

        await _generate_rule_test_cases(client, compiled_rule_set_id)
        expense_report_id = await _import_expense_report(client, amount="100.00")

        blocked_run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled_rule_set_id},
        )
        assert blocked_run_response.status_code == 422
        assert blocked_run_response.json() == {
            "detail": (
                "Compliance Evaluation Run requires a passing Rule Test Run for this "
                "Compiled Rule Set. Generate Rule Test Cases and execute a green "
                "Rule Test Run first."
            ),
        }

        rule_test_run_response = await client.post(
            f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-runs",
            headers={"Authorization": "Bearer admin-token"},
        )
        assert rule_test_run_response.status_code == 201
        rule_test_run = rule_test_run_response.json()
        assert rule_test_run["summary"]["overall_passed"] is True

        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled_rule_set_id},
        )
        assert run_response.status_code == 201
        run_payload = run_response.json()
        run_id = run_payload["compliance_evaluation_run_id"]
        review_id = f"{run_id}:0"

        detail_response = await client.get(
            f"/compliance-reviews/{review_id}",
            headers={"Authorization": "Bearer viewer-token"},
        )
        assert detail_response.status_code == 200
        review_detail = detail_response.json()

        resolve_response = await client.post(
            f"/compliance-reviews/{review_id}/decisions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "resolution_type": "upheld",
                "rationale": REVIEW_RATIONALE,
            },
        )
        assert resolve_response.status_code == 201
        decision = resolve_response.json()["decision"]

        run_audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={"entity_type": "compliance_evaluation_run", "entity_id": run_id},
        )
        review_audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={"entity_type": "compliance_review", "entity_id": review_id},
        )

    assert run_payload["policy_version_id"] == GOLDEN_POLICY_VERSION_ID
    assert run_payload["compiled_rule_set_id"] == compiled_rule_set_id
    assert run_payload["expense_report_id"] == expense_report_id
    assert run_payload["summary"]["violation_count"] == 1

    violation = run_payload["row_outcomes"][0]
    assert violation["outcome"] == "violation"
    assert violation["rule_id"] == candidate_rule_id
    assert violation["reason"] == MEAL_CAP_STATEMENT
    assert len(violation["evidence"]) == 1
    assert violation["evidence"][0]["document_id"] == GOLDEN_DOCUMENT_ID
    assert violation["evidence"][0]["document_version_id"] == document_version_id
    assert violation["evidence"][0]["quote"] == MEAL_CAP_CITATION_QUOTE

    assert review_detail["policy_version_id"] == GOLDEN_POLICY_VERSION_ID
    assert review_detail["compiled_rule_set_id"] == compiled_rule_set_id
    assert review_detail["expense_report_id"] == expense_report_id
    assert review_detail["row_outcome"]["rule_id"] == candidate_rule_id
    assert review_detail["rule_statement"] == MEAL_CAP_STATEMENT
    assert review_detail["citation"]["document_id"] == GOLDEN_DOCUMENT_ID
    assert review_detail["citation"]["document_version_id"] == document_version_id
    assert review_detail["citation"]["quote"] == MEAL_CAP_CITATION_QUOTE

    assert decision["evaluation_outcome_id"] == review_id
    assert decision["rationale"] == REVIEW_RATIONALE
    assert decision["resolution_type"] == "upheld"

    assert run_audit_response.status_code == 200
    run_audit_items = run_audit_response.json()["items"]
    run_audit = next(
        item
        for item in run_audit_items
        if item["action"] == "compliance_evaluation_run.executed"
    )
    assert run_audit["action"] == "compliance_evaluation_run.executed"
    assert run_audit["payload"]["policy_version_id"] == GOLDEN_POLICY_VERSION_ID
    assert run_audit["payload"]["compiled_rule_set_id"] == compiled_rule_set_id
    assert run_audit["payload"]["expense_report_id"] == expense_report_id
    assert run_audit["payload"]["violation_count"] == 1

    assert review_audit_response.status_code == 200
    review_audit_items = review_audit_response.json()["items"]
    assert len(review_audit_items) == 1
    review_audit = review_audit_items[0]
    assert review_audit["action"] == "compliance_review.resolved"
    assert review_audit["payload"]["rationale"] == REVIEW_RATIONALE
    assert review_audit["payload"]["compliance_evaluation_run_id"] == run_id
    assert review_audit["payload"]["expense_report_id"] == expense_report_id
