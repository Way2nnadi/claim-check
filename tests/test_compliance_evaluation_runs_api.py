from __future__ import annotations

from io import BytesIO

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from policy_pipeline.main import create_app
from policy_pipeline.shared.database import Base, ComplianceEvaluationRunRecord
from tests.test_compiled_rule_sets_api import _configure_local_auth_with_admin
from tests.test_rule_test_cases_api import (
    _compile_policy_version,
    _publish_policy_version,
    build_meal_cap_rule_payload,
)


def _csv_upload(filename: str, contents: str) -> dict[str, tuple[str, BytesIO, str]]:
    return {
        "file": (
            filename,
            BytesIO(contents.encode("utf-8")),
            "text/csv",
        )
    }


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
            json=build_meal_cap_rule_payload(),
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        compiled_rule_set_id = compiled["compiled_rule_set_id"]

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
    assert payload["executed_by"] == "admin-user"
    assert payload["summary"] == {
        "total_count": 2,
        "pass_count": 1,
        "violation_count": 1,
    }
    assert len(payload["row_outcomes"]) == 2
    assert payload["row_outcomes"][0]["outcome"] == "pass"
    assert payload["row_outcomes"][0]["rule_id"] is None
    assert payload["row_outcomes"][0]["reason"] is None
    assert payload["row_outcomes"][1]["outcome"] == "violation"
    assert payload["row_outcomes"][1]["rule_id"] == "rule-meal-cap-domestic"
    assert payload["row_outcomes"][1]["reason"] == (
        "Domestic meals are capped at $75 per day."
    )

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
            json=build_meal_cap_rule_payload(),
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        compiled_rule_set_id = compiled["compiled_rule_set_id"]
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
    first_outcomes = first_response.json()["row_outcomes"]
    second_outcomes = second_response.json()["row_outcomes"]
    assert first_outcomes == second_outcomes


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
            json=build_meal_cap_rule_payload(),
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
