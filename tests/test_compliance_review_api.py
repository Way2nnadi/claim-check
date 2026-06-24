from __future__ import annotations

import httpx
import pytest
from sqlalchemy import create_engine

from policy_pipeline.main import create_app
from policy_pipeline.shared.database import Base
from tests.test_compiled_rule_sets_api import _configure_local_auth_with_admin
from tests.test_compliance_evaluation_runs_api import (
    _build_lodging_guidance_rule_with_citation,
    _import_expense_report,
    _import_expense_report_from_csv,
    _lodging_csv,
    _meal_cap_rule_with_citation,
    _prepare_rule_test_run_gate,
)
from tests.test_rule_test_cases_api import (
    _compile_policy_version,
    _publish_policy_version,
)


@pytest.mark.anyio
async def test_compliance_review_queue_lists_actionable_outcomes_only(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth_with_admin(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=_meal_cap_rule_with_citation(),
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        await _prepare_rule_test_run_gate(client, compiled["compiled_rule_set_id"])
        expense_report_id = await _import_expense_report(client, amount="100.00")

        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled["compiled_rule_set_id"]},
        )
        assert run_response.status_code == 201
        run_id = run_response.json()["compliance_evaluation_run_id"]

        queue_response = await client.get(
            "/compliance-reviews",
            headers={"Authorization": "Bearer viewer-token"},
        )
        filtered_response = await client.get(
            "/compliance-reviews",
            headers={"Authorization": "Bearer viewer-token"},
            params={"compliance_evaluation_run_id": run_id},
        )
        violations_excluded_response = await client.get(
            "/compliance-reviews",
            headers={"Authorization": "Bearer viewer-token"},
            params={"include_violations": "false"},
        )

    assert queue_response.status_code == 200
    queue_payload = queue_response.json()
    assert len(queue_payload["items"]) == 1
    item = queue_payload["items"][0]
    assert item["compliance_evaluation_run_id"] == run_id
    assert item["expense_report_id"] == expense_report_id
    assert item["row_index"] == 0
    assert item["outcome"] == "violation"
    assert item["rule_id"] == "rule-meal-cap-domestic"
    assert item["employee_id"] == "emp-001"
    assert item["reason"] == "Domestic meals are capped at $75 per day."
    assert item["compliance_review_id"] == f"{run_id}:0"

    assert filtered_response.status_code == 200
    assert len(filtered_response.json()["items"]) == 1
    assert filtered_response.json()["compliance_evaluation_run_id"] == run_id

    assert violations_excluded_response.status_code == 200
    assert violations_excluded_response.json()["items"] == []


@pytest.mark.anyio
async def test_compliance_review_queue_filters_by_outcome_type(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth_with_admin(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=_build_lodging_guidance_rule_with_citation(),
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        expense_report_id = await _import_expense_report_from_csv(
            client,
            csv_contents=_lodging_csv(),
        )

        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled["compiled_rule_set_id"]},
        )
        assert run_response.status_code == 201
        run_id = run_response.json()["compliance_evaluation_run_id"]

        queue_response = await client.get(
            "/compliance-reviews",
            headers={"Authorization": "Bearer approver-token"},
            params={"compliance_evaluation_run_id": run_id},
        )
        needs_review_only_response = await client.get(
            "/compliance-reviews",
            headers={"Authorization": "Bearer approver-token"},
            params={
                "compliance_evaluation_run_id": run_id,
                "outcome": "needs_review",
            },
        )
        violation_only_response = await client.get(
            "/compliance-reviews",
            headers={"Authorization": "Bearer approver-token"},
            params={
                "compliance_evaluation_run_id": run_id,
                "outcome": "violation",
            },
        )

    assert queue_response.status_code == 200
    assert len(queue_response.json()["items"]) == 1
    assert queue_response.json()["items"][0]["outcome"] == "needs_review"

    assert needs_review_only_response.status_code == 200
    assert len(needs_review_only_response.json()["items"]) == 1

    assert violation_only_response.status_code == 200
    assert violation_only_response.json()["items"] == []


@pytest.mark.anyio
async def test_compliance_review_queue_includes_missing_evidence_outcomes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    from tests.test_compliance_evaluation_runs_api import (
        _meal_cap_exception_csv,
        _meal_cap_exception_rule_with_citation,
    )

    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth_with_admin(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=_meal_cap_exception_rule_with_citation(),
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        await _prepare_rule_test_run_gate(client, compiled["compiled_rule_set_id"])
        expense_report_id = await _import_expense_report_from_csv(
            client,
            csv_contents=_meal_cap_exception_csv(amount="100.00", manager_approval="no"),
        )

        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled["compiled_rule_set_id"]},
        )
        assert run_response.status_code == 201
        run_id = run_response.json()["compliance_evaluation_run_id"]

        queue_response = await client.get(
            "/compliance-reviews",
            headers={"Authorization": "Bearer viewer-token"},
            params={
                "compliance_evaluation_run_id": run_id,
                "outcome": "missing_evidence",
            },
        )

    assert queue_response.status_code == 200
    assert len(queue_response.json()["items"]) == 1
    assert queue_response.json()["items"][0]["outcome"] == "missing_evidence"


@pytest.mark.anyio
async def test_compliance_review_detail_includes_expense_row_rule_and_citation(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth_with_admin(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=_meal_cap_rule_with_citation(),
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        await _prepare_rule_test_run_gate(client, compiled["compiled_rule_set_id"])
        expense_report_id = await _import_expense_report(client, amount="100.00")

        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled["compiled_rule_set_id"]},
        )
        assert run_response.status_code == 201
        run_payload = run_response.json()
        run_id = run_payload["compliance_evaluation_run_id"]
        review_id = f"{run_id}:0"

        detail_response = await client.get(
            f"/compliance-reviews/{review_id}",
            headers={"Authorization": "Bearer viewer-token"},
        )
        missing_response = await client.get(
            "/compliance-reviews/cer-missing:0",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["compliance_review_id"] == review_id
    assert detail["compliance_evaluation_run_id"] == run_id
    assert detail["expense_report_id"] == expense_report_id
    assert detail["policy_version_id"] == "policy-v1"
    assert detail["compiled_rule_set_id"] == compiled["compiled_rule_set_id"]
    assert detail["expense_row"] == {
        "employee_id": "emp-001",
        "expense_date": "2026-06-21",
        "expense_category": "meals",
        "amount": "100.00",
        "currency": "USD",
        "country": "domestic",
        "travel_type": "domestic",
        "business_purpose": "Team dinner",
        "attendee_list": "Alice; Bob",
        "manager_approval": True,
        "receipt_attached": True,
        "trip_id": "trip-1",
        "submission_days": None,
    }
    assert detail["row_outcome"]["outcome"] == "violation"
    assert detail["row_outcome"]["rule_id"] == "rule-meal-cap-domestic"
    assert detail["rule_statement"] == "Domestic meals are capped at $75 per day."
    assert detail["citation"]["quote"] == (
        "Domestic meal expenses are limited to $75 per person per day."
    )
    assert detail["citation"]["document_id"] == "doc-expense-policy"
    assert detail["row_outcome"]["reason"] == detail["rule_statement"]
    assert detail["decision"] is None

    assert missing_response.status_code == 404
