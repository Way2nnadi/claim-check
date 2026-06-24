from __future__ import annotations

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from policy_pipeline.main import create_app
from policy_pipeline.rule_test_cases.models import EvaluationOutcome, RuleTestCaseVariant
from policy_pipeline.shared.database import Base, RuleTestCaseRecord
from tests.test_compiled_rule_sets_api import _configure_local_auth_with_admin
from tests.test_rule_test_cases_api import (
    _compile_policy_version,
    _publish_policy_version,
    build_meal_cap_rule_payload,
)
from tests.test_rule_test_cases_disable_api import _prepare_compiled_rule_set_with_cases


@pytest.mark.anyio
async def test_approver_edits_rule_test_case_with_rationale_and_audits_it(
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
        compiled_rule_set_id, case_ids = await _prepare_compiled_rule_set_with_cases(client)
        list_response = await client.get(
            f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-cases",
            headers={"Authorization": "Bearer viewer-token"},
        )
        positive_case = next(
            case
            for group in list_response.json()["groups"]
            for case in group["cases"]
            if case["variant"] == RuleTestCaseVariant.POSITIVE.value
        )
        target_case_id = positive_case["rule_test_case_id"]
        updated_fixture = {
            **positive_case["expense_fixture"],
            "amount": "50",
        }

        edit_response = await client.patch(
            f"/rule-test-cases/{target_case_id}",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "rationale": "Fixture amount was incorrect for the positive case.",
                "expense_fixture": updated_fixture,
                "expected_outcome": EvaluationOutcome.PASS.value,
            },
        )
        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={"entity_type": "rule_test_case", "entity_id": target_case_id},
        )

    assert edit_response.status_code == 200
    edited_case = edit_response.json()
    assert edited_case["expense_fixture"]["amount"] == "50"
    assert edited_case["expected_outcome"] == EvaluationOutcome.PASS.value
    assert edited_case["edit_rationale"] == "Fixture amount was incorrect for the positive case."
    assert edited_case["edited_by"] == "approver-user"
    assert edited_case["edited_at"] is not None

    assert audit_response.status_code == 200
    audit_items = audit_response.json()["items"]
    assert len(audit_items) == 1
    assert audit_items[0] == {
        "action": "rule_test_case.edited",
        "actor_subject": "approver-user",
        "actor_roles": ["approver"],
        "entity_type": "rule_test_case",
        "entity_id": target_case_id,
        "payload": {
            "rule_test_case_id": target_case_id,
            "rationale": "Fixture amount was incorrect for the positive case.",
            "fields": ["expense_fixture"],
            "compiled_rule_set_id": compiled_rule_set_id,
            "rule_id": "rule-meal-cap-domestic",
        },
        "occurred_at": audit_items[0]["occurred_at"],
    }


@pytest.mark.anyio
async def test_admin_and_viewer_cannot_edit_rule_test_case(
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
        _, case_ids = await _prepare_compiled_rule_set_with_cases(client)
        target_case_id = case_ids[0]
        payload = {
            "rationale": "Should not be allowed.",
            "expected_outcome": EvaluationOutcome.VIOLATION.value,
        }

        admin_response = await client.patch(
            f"/rule-test-cases/{target_case_id}",
            headers={"Authorization": "Bearer admin-token"},
            json=payload,
        )
        viewer_response = await client.patch(
            f"/rule-test-cases/{target_case_id}",
            headers={"Authorization": "Bearer viewer-token"},
            json=payload,
        )

    assert admin_response.status_code == 403
    assert viewer_response.status_code == 403


@pytest.mark.anyio
async def test_edit_rule_test_case_validates_request_and_active_status(
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
        _, case_ids = await _prepare_compiled_rule_set_with_cases(client)
        target_case_id = case_ids[0]

        empty_rationale_response = await client.patch(
            f"/rule-test-cases/{target_case_id}",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "", "expected_outcome": EvaluationOutcome.PASS.value},
        )
        missing_fields_response = await client.patch(
            f"/rule-test-cases/{target_case_id}",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "No editable fields."},
        )
        no_changes_response = await client.patch(
            f"/rule-test-cases/{target_case_id}",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "rationale": "No actual change.",
                "expected_outcome": EvaluationOutcome.PASS.value,
            },
        )
        missing_response = await client.patch(
            "/rule-test-cases/missing-case",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "rationale": "Missing case.",
                "expected_outcome": EvaluationOutcome.VIOLATION.value,
            },
        )

        await client.post(
            f"/rule-test-cases/{target_case_id}/disable",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "Disable before edit attempt."},
        )
        disabled_edit_response = await client.patch(
            f"/rule-test-cases/{target_case_id}",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "rationale": "Should fail for disabled case.",
                "expected_outcome": EvaluationOutcome.VIOLATION.value,
            },
        )

    assert empty_rationale_response.status_code == 422
    assert missing_fields_response.status_code == 422
    assert no_changes_response.status_code == 422
    assert no_changes_response.json() == {
        "detail": "No changes were provided for the Rule Test Case.",
    }
    assert missing_response.status_code == 404
    assert missing_response.json() == {"detail": "Rule Test Case was not found."}
    assert disabled_edit_response.status_code == 409
    assert disabled_edit_response.json() == {
        "detail": "Rule Test Case must be active to edit.",
    }


@pytest.mark.anyio
async def test_edited_rule_test_case_participates_in_runs_with_updated_results(
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
        compiled_rule_set_id, _ = await _prepare_compiled_rule_set_with_cases(client)
        list_response = await client.get(
            f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-cases",
            headers={"Authorization": "Bearer viewer-token"},
        )
        positive_case = next(
            case
            for group in list_response.json()["groups"]
            for case in group["cases"]
            if case["variant"] == RuleTestCaseVariant.POSITIVE.value
        )

        edit_response = await client.patch(
            f"/rule-test-cases/{positive_case['rule_test_case_id']}",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "rationale": "Force a mismatch to verify run behavior.",
                "expected_outcome": EvaluationOutcome.VIOLATION.value,
            },
        )
        run_response = await client.post(
            f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-runs",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert edit_response.status_code == 200
    assert run_response.status_code == 201
    payload = run_response.json()
    edited_result = next(
        result
        for result in payload["case_results"]
        if result["rule_test_case_id"] == positive_case["rule_test_case_id"]
    )
    assert edited_result["expected_outcome"] == EvaluationOutcome.VIOLATION.value
    assert edited_result["actual_outcome"] == EvaluationOutcome.PASS.value
    assert edited_result["passed"] is False
    assert payload["summary"]["overall_passed"] is False
    assert payload["summary"]["failed_count"] >= 1

    engine = create_engine(database_url)
    with Session(engine) as session:
        record = session.get(RuleTestCaseRecord, positive_case["rule_test_case_id"])
        assert record is not None
        assert record.payload["expected_outcome"] == EvaluationOutcome.VIOLATION.value
        assert record.payload["edit_rationale"] == "Force a mismatch to verify run behavior."
    engine.dispose()
