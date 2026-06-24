from __future__ import annotations

import httpx
import pytest
from sqlalchemy import create_engine

from policy_pipeline.main import create_app
from policy_pipeline.shared.database import Base
from tests.test_compiled_rule_sets_api import _configure_local_auth_with_admin
from tests.test_compliance_evaluation_runs_api import (
    _import_expense_report,
    _meal_cap_rule_with_citation,
    _prepare_rule_test_run_gate,
)
from tests.test_rule_test_cases_api import (
    _compile_policy_version,
    _publish_policy_version,
)


async def _execute_compliance_evaluation_run(
    client: httpx.AsyncClient,
) -> tuple[str, str, str]:
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
    return expense_report_id, run_id, f"{run_id}:0"


@pytest.mark.anyio
async def test_compliance_evaluation_run_execution_writes_audit_event_with_reproducibility_pin(
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
        expense_report_id, run_id, _ = await _execute_compliance_evaluation_run(client)
        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={
                "entity_type": "compliance_evaluation_run",
                "entity_id": run_id,
            },
        )

    assert audit_response.status_code == 200
    audit_items = audit_response.json()["items"]
    assert len(audit_items) == 1
    audit_event = audit_items[0]
    assert audit_event == {
        "action": "compliance_evaluation_run.executed",
        "actor_subject": "admin-user",
        "actor_roles": ["admin"],
        "entity_type": "compliance_evaluation_run",
        "entity_id": run_id,
        "payload": {
            "compliance_evaluation_run_id": run_id,
            "expense_report_id": expense_report_id,
            "expense_input_fingerprint": audit_event["payload"]["expense_input_fingerprint"],
            "compiled_rule_set_id": audit_event["payload"]["compiled_rule_set_id"],
            "policy_version_id": "policy-v1",
            "executed_by": "admin-user",
            "executed_at": audit_event["payload"]["executed_at"],
            "pass_count": 0,
            "violation_count": 1,
            "needs_review_count": 0,
            "missing_evidence_count": 0,
        },
        "occurred_at": audit_event["occurred_at"],
    }
    assert audit_event["payload"]["compiled_rule_set_id"]
    fingerprint = audit_event["payload"]["expense_input_fingerprint"]
    assert fingerprint == {
        "source_filename": "expenses.csv",
        "row_count": 1,
        "content_hash": fingerprint["content_hash"],
    }
    assert len(fingerprint["content_hash"]) == 64


@pytest.mark.anyio
async def test_compliance_review_resolution_writes_audit_event_with_outcome_context(
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
        expense_report_id, run_id, review_id = await _execute_compliance_evaluation_run(
            client
        )
        resolve_response = await client.post(
            f"/compliance-reviews/{review_id}/decisions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "resolution_type": "upheld",
                "rationale": "Violation confirmed against the approved meal cap.",
            },
        )
        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={"entity_type": "compliance_review", "entity_id": review_id},
        )

    assert resolve_response.status_code == 201
    decision = resolve_response.json()["decision"]

    assert audit_response.status_code == 200
    audit_items = audit_response.json()["items"]
    assert len(audit_items) == 1
    assert audit_items[0] == {
        "action": "compliance_review.resolved",
        "actor_subject": "approver-user",
        "actor_roles": ["approver"],
        "entity_type": "compliance_review",
        "entity_id": review_id,
        "payload": {
            "compliance_review_decision_id": decision["compliance_review_decision_id"],
            "evaluation_outcome_id": review_id,
            "compliance_evaluation_run_id": run_id,
            "expense_report_id": expense_report_id,
            "row_index": 0,
            "employee_id": "emp-001",
            "expense_date": "2026-06-21",
            "policy_version_id": "policy-v1",
            "compiled_rule_set_id": audit_items[0]["payload"]["compiled_rule_set_id"],
            "currency_context": {
                "rule_currency": "USD",
                "expense_currency": "USD",
                "status": "match",
                "conversion_supported": False,
            },
            "effective_date_context": None,
            "resolution_type": "upheld",
            "rationale": "Violation confirmed against the approved meal cap.",
        },
        "occurred_at": audit_items[0]["occurred_at"],
    }


@pytest.mark.anyio
async def test_audit_events_filter_by_compliance_evaluation_run_includes_review_decisions(
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
        _, run_id, review_id = await _execute_compliance_evaluation_run(client)
        await client.post(
            f"/compliance-reviews/{review_id}/decisions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "resolution_type": "overridden_pass",
                "rationale": "Receipt shows a valid business exception.",
            },
        )
        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={
                "entity_type": "compliance_evaluation_run",
                "entity_id": run_id,
            },
        )

    assert audit_response.status_code == 200
    audit_items = audit_response.json()["items"]
    assert len(audit_items) == 2
    actions = {item["action"]: item for item in audit_items}
    assert actions["compliance_evaluation_run.executed"]["entity_id"] == run_id
    assert actions["compliance_review.resolved"]["entity_id"] == review_id
    assert actions["compliance_review.resolved"]["payload"][
        "compliance_evaluation_run_id"
    ] == run_id


@pytest.mark.anyio
async def test_audit_events_filter_by_expense_report_includes_compliance_run_events(
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
        expense_report_id, run_id, review_id = await _execute_compliance_evaluation_run(
            client
        )
        await client.post(
            f"/compliance-reviews/{review_id}/decisions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "resolution_type": "escalated",
                "rationale": "Needs finance director review.",
            },
        )
        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={"entity_type": "expense_report", "entity_id": expense_report_id},
        )

    assert audit_response.status_code == 200
    audit_items = audit_response.json()["items"]
    assert len(audit_items) == 2
    actions = {item["action"]: item for item in audit_items}
    assert actions["compliance_evaluation_run.executed"]["payload"][
        "expense_report_id"
    ] == expense_report_id
    assert actions["compliance_review.resolved"]["payload"]["expense_report_id"] == (
        expense_report_id
    )
    assert actions["compliance_evaluation_run.executed"]["payload"][
        "compliance_evaluation_run_id"
    ] == run_id


@pytest.mark.anyio
async def test_audit_events_filter_compliance_review_by_expense_row_identity(
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
        _, run_id, review_id = await _execute_compliance_evaluation_run(client)
        await client.post(
            f"/compliance-reviews/{review_id}/decisions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "resolution_type": "overridden_pass",
                "rationale": "Receipt shows a valid business exception.",
            },
        )
        by_row_index = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={
                "compliance_evaluation_run_id": run_id,
                "row_index": 0,
            },
        )
        by_employee = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={
                "compliance_evaluation_run_id": run_id,
                "employee_id": "emp-001",
                "expense_date": "2026-06-21",
            },
        )
        by_mismatch = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={
                "compliance_evaluation_run_id": run_id,
                "employee_id": "emp-404",
            },
        )

    assert by_row_index.status_code == 200
    row_index_items = by_row_index.json()["items"]
    assert len(row_index_items) == 1
    assert row_index_items[0]["entity_id"] == review_id
    assert row_index_items[0]["payload"]["row_index"] == 0

    assert by_employee.status_code == 200
    employee_items = by_employee.json()["items"]
    assert len(employee_items) == 1
    assert employee_items[0]["payload"]["employee_id"] == "emp-001"
    assert employee_items[0]["payload"]["expense_date"] == "2026-06-21"

    assert by_mismatch.status_code == 200
    assert by_mismatch.json()["items"] == []
