from __future__ import annotations

from io import BytesIO

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from policy_pipeline.main import create_app
from policy_pipeline.shared.database import Base, ComplianceEvaluationRunRecord, RuleTestCaseRecord
from tests.test_compiled_rule_sets_api import (
    _configure_local_auth_with_admin,
    build_guidance_rule_payload,
)
from tests.test_rule_test_cases_api import (
    _compile_policy_version,
    _publish_policy_version,
    build_meal_cap_rule_payload,
    build_meal_cap_rule_with_exception_payload,
)


def _csv_upload(filename: str, contents: str) -> dict[str, tuple[str, BytesIO, str]]:
    return {
        "file": (
            filename,
            BytesIO(contents.encode("utf-8")),
            "text/csv",
        )
    }


def _meal_cap_citation() -> dict[str, object]:
    return {
        "document_id": "doc-expense-policy",
        "document_version_id": "docv-2026-06-01",
        "section_id": "meals#domestic-cap",
        "quote": "Domestic meal expenses are limited to $75 per person per day.",
        "start_char": 42,
        "end_char": 98,
    }


def _meal_cap_rule_with_citation() -> dict[str, object]:
    payload = build_meal_cap_rule_payload()
    payload["citation"] = _meal_cap_citation()
    return payload


def _meal_cap_csv_rows(*rows: tuple[str, str]) -> str:
    header = (
        "employee_id,expense_date,expense_category,amount,currency,country,"
        "travel_type,business_purpose,attendee_list,manager_approval,"
        "receipt_attached,trip_id\n"
    )
    body = "".join(
        f'{employee_id},2026-06-21,meals,{amount},usd,domestic,domestic,Team dinner,'
        f'"Alice; Bob",yes,true,trip-{index}\n'
        for index, (employee_id, amount) in enumerate(rows, start=1)
    )
    return header + body


def _meal_cap_csv(*, amount: str, employee_id: str = "emp-001") -> str:
    return _meal_cap_csv_rows((employee_id, amount))


async def _import_expense_report(
    client: httpx.AsyncClient,
    *,
    amount: str,
    employee_id: str = "emp-001",
) -> str:
    response = await client.post(
        "/expense-reports",
        headers={"Authorization": "Bearer admin-token"},
        files=_csv_upload("expenses.csv", _meal_cap_csv(amount=amount, employee_id=employee_id)),
    )
    assert response.status_code == 201
    return response.json()["expense_report_id"]


def _lodging_csv(*, employee_id: str = "emp-001") -> str:
    header = (
        "employee_id,expense_date,expense_category,amount,currency,country,"
        "travel_type,business_purpose,attendee_list,manager_approval,"
        "receipt_attached,trip_id\n"
    )
    body = (
        f"{employee_id},2026-06-21,lodging,250.00,usd,domestic,domestic,"
        f'Conference hotel,"",yes,true,trip-1\n'
    )
    return header + body


def _entertainment_csv(*, employee_id: str = "emp-001") -> str:
    header = (
        "employee_id,expense_date,expense_category,amount,currency,country,"
        "travel_type,business_purpose,attendee_list,manager_approval,"
        "receipt_attached,trip_id\n"
    )
    body = (
        f"{employee_id},2026-06-21,entertainment,120.00,usd,domestic,domestic,"
        f'Client dinner,"Alice; Bob",yes,true,trip-1\n'
    )
    return header + body


def _lodging_guidance_citation() -> dict[str, object]:
    return {
        "document_id": "doc-expense-policy",
        "document_version_id": "docv-2026-06-01",
        "section_id": "lodging#preferred-blocks",
        "quote": "Employees should prefer negotiated hotel blocks when available.",
        "start_char": 10,
        "end_char": 72,
    }


def _build_lodging_guidance_rule_with_citation() -> dict[str, object]:
    payload = build_guidance_rule_payload(rule_id="rule-lodging-guidance")
    payload["citation"] = _lodging_guidance_citation()
    return payload


def _build_subjective_rule_with_citation() -> dict[str, object]:
    return {
        "rule_id": "rule-entertainment-taste",
        "statement": "Entertainment expenses must be in good taste.",
        "enforceability_class": "subjective",
        "rationale": "Requires human judgment on appropriateness.",
        "scope": {
            "expense_category": "entertainment",
        },
        "citation": {
            "document_id": "doc-expense-policy",
            "document_version_id": "docv-2026-06-01",
            "section_id": "entertainment#good-taste",
            "quote": "All entertainment spending must reflect good taste and business purpose.",
            "start_char": 0,
            "end_char": 68,
        },
    }


def _build_executive_meal_cap_rule_with_citation() -> dict[str, object]:
    payload = build_meal_cap_rule_payload(rule_id="rule-exec-meal-cap")
    payload["statement"] = "Executive meal expenses are capped at $150 per day."
    payload["scope"] = {
        "expense_category": "meals",
        "country": "domestic",
        "employee_group": "executives",
    }
    payload["condition"] = {
        "field": "meal.amount",
        "operator": "<=",
        "value": "150",
    }
    payload["citation"] = {
        "document_id": "doc-expense-policy",
        "document_version_id": "docv-2026-06-01",
        "section_id": "meals#executive-cap",
        "quote": "Executive meal expenses are capped at $150 per person per day.",
        "start_char": 0,
        "end_char": 58,
    }
    return payload


async def _import_expense_report_from_csv(
    client: httpx.AsyncClient,
    *,
    csv_contents: str,
    filename: str = "expenses.csv",
) -> str:
    response = await client.post(
        "/expense-reports",
        headers={"Authorization": "Bearer admin-token"},
        files=_csv_upload(filename, csv_contents),
    )
    assert response.status_code == 201
    return response.json()["expense_report_id"]


async def _generate_rule_test_cases(
    client: httpx.AsyncClient,
    compiled_rule_set_id: str,
) -> None:
    response = await client.post(
        f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-cases/generate",
        headers={"Authorization": "Bearer admin-token"},
    )
    assert response.status_code == 201


async def _execute_green_rule_test_run(
    client: httpx.AsyncClient,
    compiled_rule_set_id: str,
) -> dict[str, object]:
    await _generate_rule_test_cases(client, compiled_rule_set_id)
    response = await client.post(
        f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-runs",
        headers={"Authorization": "Bearer admin-token"},
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["summary"]["overall_passed"] is True
    return payload


async def _prepare_rule_test_run_gate(
    client: httpx.AsyncClient,
    compiled_rule_set_id: str,
) -> None:
    await _execute_green_rule_test_run(client, compiled_rule_set_id)


@pytest.mark.anyio
async def test_admin_executes_compliance_evaluation_run_with_pass_and_violation_rows(
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
        compiled_rule_set_id = compiled["compiled_rule_set_id"]
        await _prepare_rule_test_run_gate(client, compiled_rule_set_id)

        import_response = await client.post(
            "/expense-reports",
            headers={"Authorization": "Bearer admin-token"},
            files=_csv_upload(
                "expenses.csv",
                _meal_cap_csv_rows(("emp-001", "42.50"), ("emp-002", "100.00")),
            ),
        )
        assert import_response.status_code == 201
        expense_report_id = import_response.json()["expense_report_id"]

        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled_rule_set_id},
        )
        list_response = await client.get(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer viewer-token"},
        )
        run_id = run_response.json()["compliance_evaluation_run_id"]
        detail_response = await client.get(
            f"/compliance-evaluation-runs/{run_id}",
            headers={"Authorization": "Bearer viewer-token"},
        )
        report_response = await client.get(
            f"/compliance-evaluation-runs/{run_id}/report",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert run_response.status_code == 201
    payload = run_response.json()
    assert payload["expense_report_id"] == expense_report_id
    assert payload["compiled_rule_set_id"] == compiled_rule_set_id
    assert payload["policy_version_id"] == "policy-v1"
    assert payload["expense_input_fingerprint"] == {
        "source_filename": "expenses.csv",
        "row_count": 2,
        "content_hash": payload["expense_input_fingerprint"]["content_hash"],
    }
    assert len(payload["expense_input_fingerprint"]["content_hash"]) == 64
    assert payload["executed_by"] == "admin-user"
    assert payload["summary"] == {
        "total_count": 2,
        "pass_count": 1,
        "violation_count": 1,
        "needs_review_count": 0,
        "missing_evidence_count": 0,
    }
    assert len(payload["row_outcomes"]) == 2
    assert payload["row_outcomes"][0]["outcome"] == "pass"
    assert payload["row_outcomes"][0]["rule_id"] is None
    assert payload["row_outcomes"][0]["reason"] is None
    assert payload["row_outcomes"][0]["policy_limit"] is None
    assert payload["row_outcomes"][0]["actual_value"] is None
    assert payload["row_outcomes"][0]["evidence"] == []
    assert payload["row_outcomes"][0]["missing_evidence_fields"] == []
    assert payload["row_outcomes"][0]["matching_rule_ids"] == []
    assert payload["row_outcomes"][1]["outcome"] == "violation"
    assert payload["row_outcomes"][1]["rule_id"] == "rule-meal-cap-domestic"
    assert payload["row_outcomes"][1]["reason"] == (
        "Domestic meals are capped at $75 per day."
    )
    assert payload["row_outcomes"][1]["policy_limit"] == "75"
    assert payload["row_outcomes"][1]["actual_value"] == "100.00"
    assert len(payload["row_outcomes"][1]["evidence"]) == 1
    assert payload["row_outcomes"][1]["evidence"][0]["quote"] == (
        "Domestic meal expenses are limited to $75 per person per day."
    )
    assert payload["row_outcomes"][1]["evidence"][0]["document_id"] == "doc-expense-policy"
    assert payload["row_outcomes"][1]["evidence"][0]["section_id"] == "meals#domestic-cap"

    assert list_response.status_code == 200
    assert len(list_response.json()["items"]) == 1

    assert detail_response.status_code == 200
    assert detail_response.json() == payload

    assert report_response.status_code == 200
    assert report_response.headers["content-disposition"].startswith("attachment;")
    assert report_response.json() == payload

    engine = create_engine(database_url)
    with Session(engine) as session:
        stored_runs = session.scalars(select(ComplianceEvaluationRunRecord)).all()
    engine.dispose()
    assert len(stored_runs) == 1
    assert stored_runs[0].policy_version_id == "policy-v1"


@pytest.mark.anyio
async def test_compliance_evaluation_run_is_deterministic_for_same_inputs(
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
        compiled_rule_set_id = compiled["compiled_rule_set_id"]
        await _prepare_rule_test_run_gate(client, compiled_rule_set_id)
        expense_report_id = await _import_expense_report(client, amount="42.50")

        first_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled_rule_set_id},
        )
        second_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled_rule_set_id},
        )

    assert first_response.status_code == 201
    assert second_response.status_code == 201
    first_payload = first_response.json()
    second_payload = second_response.json()
    assert first_payload["row_outcomes"] == second_payload["row_outcomes"]
    assert first_payload["expense_input_fingerprint"] == second_payload[
        "expense_input_fingerprint"
    ]


@pytest.mark.anyio
async def test_viewer_cannot_execute_compliance_evaluation_run(
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
        expense_report_id = await _import_expense_report(client, amount="42.50")

        viewer_run = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer viewer-token"},
            json={"compiled_rule_set_id": compiled["compiled_rule_set_id"]},
        )

    assert viewer_run.status_code == 403


@pytest.mark.anyio
async def test_execute_compliance_evaluation_run_for_unknown_compiled_rule_set_returns_404(
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
        expense_report_id = await _import_expense_report(client, amount="42.50")
        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": "missing-set"},
        )

    assert run_response.status_code == 404
    assert run_response.json() == {"detail": "Compiled Rule Set was not found."}


@pytest.mark.anyio
async def test_execute_compliance_evaluation_run_for_unknown_expense_report_returns_404(
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
        run_response = await client.post(
            "/expense-reports/missing-report/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": "missing-set"},
        )

    assert run_response.status_code == 404
    assert run_response.json() == {"detail": "Expense Report was not found."}


@pytest.mark.anyio
async def test_compliance_evaluation_run_routes_guidance_rule_scope_to_needs_review(
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
    payload = run_response.json()
    assert payload["summary"] == {
        "total_count": 1,
        "pass_count": 0,
        "violation_count": 0,
        "needs_review_count": 1,
        "missing_evidence_count": 0,
    }
    outcome = payload["row_outcomes"][0]
    assert outcome["outcome"] == "needs_review"
    assert outcome["rule_id"] == "rule-lodging-guidance"
    assert outcome["reason"] == (
        "Employees should prefer negotiated hotel blocks when available. "
        "Automated enforcement does not apply to guidance rules."
    )
    assert len(outcome["evidence"]) == 1
    assert outcome["evidence"][0]["quote"] == (
        "Employees should prefer negotiated hotel blocks when available."
    )
    assert outcome["policy_limit"] is None
    assert outcome["actual_value"] is None


@pytest.mark.anyio
async def test_compliance_evaluation_run_routes_subjective_rule_scope_to_needs_review(
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
            json=_build_subjective_rule_with_citation(),
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        expense_report_id = await _import_expense_report_from_csv(
            client,
            csv_contents=_entertainment_csv(),
        )
        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled["compiled_rule_set_id"]},
        )

    assert run_response.status_code == 201
    payload = run_response.json()
    assert payload["summary"]["needs_review_count"] == 1
    outcome = payload["row_outcomes"][0]
    assert outcome["outcome"] == "needs_review"
    assert outcome["rule_id"] == "rule-entertainment-taste"
    assert "Automated enforcement does not apply to subjective rules." in outcome["reason"]
    assert len(outcome["evidence"]) == 1


@pytest.mark.anyio
async def test_compliance_evaluation_run_routes_employee_group_rule_scope_to_needs_review(
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
            json=_build_executive_meal_cap_rule_with_citation(),
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        assert compiled["summary"]["skipped_non_enforceable"] == 1
        assert compiled["entries"][0]["skip_reason"] == (
            "Rule scope includes employee_group, which Expense Report rows do not carry in v1."
        )
        expense_report_id = await _import_expense_report(
            client,
            amount="200.00",
        )
        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled["compiled_rule_set_id"]},
        )

    assert run_response.status_code == 201
    payload = run_response.json()
    assert payload["summary"] == {
        "total_count": 1,
        "pass_count": 0,
        "violation_count": 0,
        "needs_review_count": 1,
        "missing_evidence_count": 0,
    }
    outcome = payload["row_outcomes"][0]
    assert outcome["outcome"] == "needs_review"
    assert outcome["rule_id"] == "rule-exec-meal-cap"
    assert outcome["reason"] == (
        "Executive meal expenses are capped at $150 per day. "
        "Rule scope includes employee_group, which Expense Report rows do not carry in v1."
    )
    assert len(outcome["evidence"]) == 1
    assert outcome["evidence"][0]["quote"] == (
        "Executive meal expenses are capped at $150 per person per day."
    )
    assert outcome["policy_limit"] is None
    assert outcome["actual_value"] is None
    assert outcome["scope_context"] == {
        "matched_dimensions": {
            "expense_category": "meals",
            "country": "domestic",
        },
        "unavailable_dimensions": {
            "employee_group": "executives",
        },
    }


@pytest.mark.anyio
async def test_compliance_evaluation_run_passes_when_employee_group_rule_scope_mismatch(
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
            json=_build_executive_meal_cap_rule_with_citation(),
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
    payload = run_response.json()
    assert payload["summary"]["pass_count"] == 1
    assert payload["summary"]["needs_review_count"] == 0
    assert payload["row_outcomes"][0]["outcome"] == "pass"


@pytest.mark.anyio
async def test_compliance_evaluation_run_prefers_violation_over_guidance_match(
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
        guidance_payload = build_guidance_rule_payload(rule_id="rule-meals-guidance")
        guidance_payload["scope"] = {"expense_category": "meals"}
        guidance_payload["statement"] = "Meals should include itemized receipts when possible."
        await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=guidance_payload,
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
    outcome = run_response.json()["row_outcomes"][0]
    assert outcome["outcome"] == "violation"
    assert outcome["rule_id"] == "rule-meal-cap-domestic"
    assert outcome["matching_rule_ids"] == [
        "rule-meal-cap-domestic",
        "rule-meals-guidance",
    ]


@pytest.mark.anyio
async def test_compliance_evaluation_run_routes_enforceable_pass_with_guidance_to_needs_review(
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
        guidance_payload = build_guidance_rule_payload(rule_id="rule-meals-guidance")
        guidance_payload["scope"] = {"expense_category": "meals"}
        guidance_payload["statement"] = "Meals should include itemized receipts when possible."
        await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=guidance_payload,
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        await _prepare_rule_test_run_gate(client, compiled["compiled_rule_set_id"])
        expense_report_id = await _import_expense_report(client, amount="42.50")
        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled["compiled_rule_set_id"]},
        )

    assert run_response.status_code == 201
    outcome = run_response.json()["row_outcomes"][0]
    assert outcome["outcome"] == "needs_review"
    assert outcome["rule_id"] == "rule-meals-guidance"
    assert outcome["matching_rule_ids"] == ["rule-meals-guidance"]


def _meal_cap_exception_rule_with_citation() -> dict[str, object]:
    payload = build_meal_cap_rule_with_exception_payload()
    payload["citation"] = _meal_cap_citation()
    return payload


def _meal_cap_exception_csv(
    *,
    amount: str,
    manager_approval: str,
    employee_id: str = "emp-001",
) -> str:
    header = (
        "employee_id,expense_date,expense_category,amount,currency,country,"
        "travel_type,business_purpose,attendee_list,manager_approval,"
        "receipt_attached,trip_id\n"
    )
    body = (
        f'{employee_id},2026-06-21,meals,{amount},usd,domestic,domestic,'
        f'Client dinner,"Alice; Bob",{manager_approval},true,trip-1\n'
    )
    return header + body


@pytest.mark.parametrize(
    (
        "amount",
        "manager_approval",
        "expected_outcome",
        "expected_missing_fields",
    ),
    [
        ("42.50", "no", "pass", []),
        ("100.00", "yes", "pass", []),
        ("100.00", "no", "missing_evidence", ["manager_approval"]),
    ],
)
@pytest.mark.anyio
async def test_compliance_evaluation_run_applies_exception_evidence_gating(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
    amount: str,
    manager_approval: str,
    expected_outcome: str,
    expected_missing_fields: list[str],
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
            json=_meal_cap_exception_rule_with_citation(),
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        await _prepare_rule_test_run_gate(client, compiled["compiled_rule_set_id"])
        expense_report_id = await _import_expense_report_from_csv(
            client,
            csv_contents=_meal_cap_exception_csv(
                amount=amount,
                manager_approval=manager_approval,
            ),
        )
        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled["compiled_rule_set_id"]},
        )

    assert run_response.status_code == 201
    outcome = run_response.json()["row_outcomes"][0]
    assert outcome["outcome"] == expected_outcome
    assert outcome["missing_evidence_fields"] == expected_missing_fields
    if expected_outcome == "missing_evidence":
        assert outcome["rule_id"] == "rule-meal-cap-exception"
        assert outcome["policy_limit"] == "75"
        assert outcome["actual_value"] == "100.00"
        assert len(outcome["evidence"]) == 1


@pytest.mark.anyio
async def test_compliance_evaluation_run_prefers_missing_evidence_over_guidance_match(
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
            json=_meal_cap_exception_rule_with_citation(),
        )
        guidance_payload = build_guidance_rule_payload(rule_id="rule-meals-guidance")
        guidance_payload["scope"] = {"expense_category": "meals"}
        guidance_payload["statement"] = "Meals should include itemized receipts when possible."
        await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=guidance_payload,
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
    outcome = run_response.json()["row_outcomes"][0]
    assert outcome["outcome"] == "missing_evidence"
    assert outcome["rule_id"] == "rule-meal-cap-exception"
    assert outcome["missing_evidence_fields"] == ["manager_approval"]
    assert outcome["matching_rule_ids"] == [
        "rule-meal-cap-exception",
        "rule-meals-guidance",
    ]


@pytest.mark.anyio
async def test_compliance_evaluation_run_prefers_violation_over_missing_evidence(
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
            json=_meal_cap_exception_rule_with_citation(),
        )
        plain_cap_payload = _meal_cap_rule_with_citation()
        plain_cap_payload["rule_id"] = "rule-meal-cap-domestic"
        await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=plain_cap_payload,
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
    outcome = run_response.json()["row_outcomes"][0]
    assert outcome["outcome"] == "violation"
    assert outcome["rule_id"] == "rule-meal-cap-domestic"
    assert outcome["matching_rule_ids"] == [
        "rule-meal-cap-domestic",
        "rule-meal-cap-exception",
    ]


@pytest.mark.anyio
async def test_compliance_evaluation_run_tie_breaks_violations_by_lowest_rule_id(
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
        alpha_payload = _meal_cap_rule_with_citation()
        alpha_payload["rule_id"] = "rule-meal-cap-alpha"
        omega_payload = _meal_cap_rule_with_citation()
        omega_payload["rule_id"] = "rule-meal-cap-omega"
        await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=alpha_payload,
        )
        await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=omega_payload,
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
    outcome = run_response.json()["row_outcomes"][0]
    assert outcome["outcome"] == "violation"
    assert outcome["rule_id"] == "rule-meal-cap-alpha"
    assert outcome["matching_rule_ids"] == [
        "rule-meal-cap-alpha",
        "rule-meal-cap-omega",
    ]


@pytest.mark.anyio
async def test_compliance_evaluation_run_tie_breaks_needs_review_by_lowest_rule_id(
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
        guidance_a = build_guidance_rule_payload(rule_id="rule-meals-guidance-a")
        guidance_a["scope"] = {"expense_category": "meals"}
        guidance_a["statement"] = "Meals should include itemized receipts when possible."
        guidance_z = build_guidance_rule_payload(rule_id="rule-meals-guidance-z")
        guidance_z["scope"] = {"expense_category": "meals"}
        guidance_z["statement"] = "Meals should avoid excessive tipping."
        await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=guidance_a,
        )
        await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=guidance_z,
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        expense_report_id = await _import_expense_report(client, amount="42.50")
        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled["compiled_rule_set_id"]},
        )

    assert run_response.status_code == 201
    outcome = run_response.json()["row_outcomes"][0]
    assert outcome["outcome"] == "needs_review"
    assert outcome["rule_id"] == "rule-meals-guidance-a"
    assert outcome["matching_rule_ids"] == [
        "rule-meals-guidance-a",
        "rule-meals-guidance-z",
    ]


@pytest.mark.anyio
async def test_execute_compliance_evaluation_run_blocked_without_rule_test_run(
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
        await _generate_rule_test_cases(client, compiled["compiled_rule_set_id"])
        expense_report_id = await _import_expense_report(client, amount="42.50")

        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled["compiled_rule_set_id"]},
        )
        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={"entity_type": "compliance_evaluation_run"},
        )

    assert run_response.status_code == 422
    assert run_response.json() == {
        "detail": (
            "Compliance Evaluation Run requires a passing Rule Test Run for this "
            "Compiled Rule Set. Generate Rule Test Cases and execute a green "
            "Rule Test Run first."
        ),
    }
    assert audit_response.status_code == 200
    assert audit_response.json()["items"] == []


@pytest.mark.anyio
async def test_execute_compliance_evaluation_run_blocked_when_latest_rule_test_run_failed(
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
        compiled_rule_set_id = compiled["compiled_rule_set_id"]
        await _generate_rule_test_cases(client, compiled_rule_set_id)

    engine = create_engine(database_url)
    with Session(engine) as session:
        record = session.scalars(select(RuleTestCaseRecord)).first()
        assert record is not None
        payload = dict(record.payload)
        payload["expected_outcome"] = "violation"
        record.payload = payload
        session.commit()
    engine.dispose()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        failed_run_response = await client.post(
            f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-runs",
            headers={"Authorization": "Bearer admin-token"},
        )
        expense_report_id = await _import_expense_report(client, amount="42.50")
        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled_rule_set_id},
        )

    assert failed_run_response.status_code == 201
    assert failed_run_response.json()["summary"]["overall_passed"] is False
    assert run_response.status_code == 422
    assert run_response.json() == {
        "detail": (
            "The most recent Rule Test Run for this Compiled Rule Set did not pass. "
            "Fix failing Rule Test Cases and re-run tests before evaluating "
            "Expense Reports."
        ),
    }


@pytest.mark.anyio
async def test_execute_compliance_evaluation_run_allowed_after_green_rule_test_run(
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
        compiled_rule_set_id = compiled["compiled_rule_set_id"]
        await _prepare_rule_test_run_gate(client, compiled_rule_set_id)
        expense_report_id = await _import_expense_report(client, amount="42.50")

        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled_rule_set_id},
        )

    assert run_response.status_code == 201
    assert run_response.json()["summary"]["pass_count"] == 1


@pytest.mark.anyio
async def test_execute_compliance_evaluation_run_compiles_policy_version_on_first_run(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    from tests.test_compiled_rule_sets_api import build_guidance_rule_payload

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
            json=build_guidance_rule_payload(rule_id="rule-lodging-guidance"),
        )
        await _publish_policy_version(client, "policy-v1")
        expense_report_id = await _import_expense_report_from_csv(
            client,
            csv_contents=_lodging_csv(),
        )

        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"policy_version_id": "policy-v1"},
        )
        compile_list_response = await client.get(
            "/policy-versions/policy-v1/compiled-rule-sets",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert run_response.status_code == 201
    payload = run_response.json()
    assert payload["policy_version_id"] == "policy-v1"
    assert payload["expense_report_id"] == expense_report_id
    assert payload["compiled_rule_set_id"].startswith("compiled-")
    assert payload["summary"]["needs_review_count"] == 1

    assert compile_list_response.status_code == 200
    compiled_items = compile_list_response.json()["items"]
    assert len(compiled_items) == 1
    assert compiled_items[0]["compiled_rule_set_id"] == payload["compiled_rule_set_id"]


@pytest.mark.anyio
async def test_execute_compliance_evaluation_run_reuses_existing_compiled_rule_set(
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
        compiled_rule_set_id = compiled["compiled_rule_set_id"]
        await _prepare_rule_test_run_gate(client, compiled_rule_set_id)
        expense_report_id = await _import_expense_report(client, amount="42.50")

        first_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"policy_version_id": "policy-v1"},
        )
        second_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"policy_version_id": "policy-v1"},
        )
        compile_list_response = await client.get(
            "/policy-versions/policy-v1/compiled-rule-sets",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert first_response.status_code == 201
    assert second_response.status_code == 201
    assert first_response.json()["compiled_rule_set_id"] == compiled_rule_set_id
    assert second_response.json()["compiled_rule_set_id"] == compiled_rule_set_id
    assert len(compile_list_response.json()["items"]) == 1


@pytest.mark.anyio
async def test_execute_compliance_evaluation_run_surfaces_compile_errors_before_evaluation(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    from tests.test_compiled_rule_sets_api import (
        build_enforceable_rule_missing_applicability_payload,
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
            json=build_enforceable_rule_missing_applicability_payload(
                rule_id="rule-meals-no-applicability",
            ),
        )
        await _publish_policy_version(client, "policy-v1")
        expense_report_id = await _import_expense_report(client, amount="42.50")

        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"policy_version_id": "policy-v1"},
        )

    assert run_response.status_code == 422
    detail = run_response.json()["detail"]
    assert "policy-v1" in detail
    assert "rule-meals-no-applicability" in detail
    assert "applicability" in detail


def _lodging_receipt_rule_payload() -> dict[str, object]:
    return {
        "rule_id": "rule-lodging-receipt",
        "statement": "Hotel stays require itemized receipts.",
        "enforceability_class": "enforceable",
        "rationale": "Receipt requirement for lodging.",
        "scope": {"expense_category": "lodging"},
        "condition": {
            "field": "receipt_attached",
            "operator": "==",
            "value": "true",
        },
        "applicability": {
            "aggregation_period": "per_transaction",
            "unit": "count",
        },
        "citation": {
            "document_id": "doc-expense-policy",
            "document_version_id": "docv-2026-06-01",
            "section_id": "lodging#receipt-required",
            "quote": "Hotel stays require itemized receipts.",
            "start_char": 0,
            "end_char": 38,
        },
    }


def _lodging_receipt_csv(*, receipt_attached: str) -> str:
    header = (
        "employee_id,expense_date,expense_category,amount,currency,country,"
        "travel_type,business_purpose,attendee_list,manager_approval,"
        "receipt_attached,trip_id\n"
    )
    body = (
        f"emp-001,2026-06-21,lodging,180.00,usd,domestic,domestic,"
        f'Conference hotel,"",yes,{receipt_attached},trip-1\n'
    )
    return header + body


def _submission_age_rule_payload() -> dict[str, object]:
    return {
        "rule_id": "rule-submission-30-days",
        "statement": "Expense reports must be submitted within 30 days.",
        "enforceability_class": "enforceable",
        "rationale": "Timeliness enforcement.",
        "scope": {"expense_category": "meals"},
        "condition": {
            "field": "expense_report.submission_days",
            "operator": "<=",
            "value": "30",
        },
        "applicability": {
            "aggregation_period": "per_transaction",
            "unit": "count",
        },
        "citation": {
            "document_id": "doc-expense-policy",
            "document_version_id": "docv-2026-06-01",
            "section_id": "expense-report#timeliness",
            "quote": "Expense reports must be submitted within 30 days.",
            "start_char": 0,
            "end_char": 48,
        },
    }


def _submission_age_csv(*, submission_days: int) -> str:
    header = (
        "employee_id,expense_date,expense_category,amount,currency,country,"
        "travel_type,business_purpose,attendee_list,manager_approval,"
        "receipt_attached,trip_id,submission_days\n"
    )
    body = (
        f"emp-001,2026-06-21,meals,42.50,usd,domestic,domestic,Team dinner,"
        f'"Alice; Bob",yes,true,trip-1,{submission_days}\n'
    )
    return header + body


@pytest.mark.anyio
async def test_compliance_evaluation_run_evaluates_lodging_receipt_requirement(
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
            json=_lodging_receipt_rule_payload(),
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        await _prepare_rule_test_run_gate(client, compiled["compiled_rule_set_id"])
        expense_report_id = await _import_expense_report_from_csv(
            client,
            csv_contents=_lodging_receipt_csv(receipt_attached="no"),
        )
        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled["compiled_rule_set_id"]},
        )

    assert run_response.status_code == 201
    outcome = run_response.json()["row_outcomes"][0]
    assert outcome["outcome"] == "violation"
    assert outcome["rule_id"] == "rule-lodging-receipt"
    assert outcome["policy_limit"] == "true"
    assert outcome["actual_value"] == "false"
    assert len(outcome["evidence"]) == 1
    assert outcome["evidence"][0]["quote"] == "Hotel stays require itemized receipts."


@pytest.mark.anyio
async def test_compliance_evaluation_run_evaluates_submission_age(
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
            json=_submission_age_rule_payload(),
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        await _prepare_rule_test_run_gate(client, compiled["compiled_rule_set_id"])
        expense_report_id = await _import_expense_report_from_csv(
            client,
            csv_contents=_submission_age_csv(submission_days=45),
        )
        run_response = await client.post(
            f"/expense-reports/{expense_report_id}/compliance-evaluation-runs",
            headers={"Authorization": "Bearer admin-token"},
            json={"compiled_rule_set_id": compiled["compiled_rule_set_id"]},
        )

    assert run_response.status_code == 201
    outcome = run_response.json()["row_outcomes"][0]
    assert outcome["outcome"] == "violation"
    assert outcome["rule_id"] == "rule-submission-30-days"
    assert outcome["policy_limit"] == "30"
    assert outcome["actual_value"] == "45"
    assert len(outcome["evidence"]) == 1


@pytest.mark.anyio
async def test_compile_rejects_unsupported_condition_field_via_api(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth_with_admin(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    bad_rule = _meal_cap_rule_with_citation()
    bad_rule["rule_id"] = "rule-bad-field"
    bad_rule["condition"] = {
        "field": "director_approval",
        "operator": "==",
        "value": "true",
    }

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=bad_rule,
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")

    entry = next(
        item for item in compiled["entries"] if item["rule_id"] == "rule-bad-field"
    )
    assert entry["status"] == "compile_error"
    assert "director_approval" in entry["error_reason"]
