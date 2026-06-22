from __future__ import annotations

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from policy_pipeline.main import create_app
from policy_pipeline.rule_test_cases.models import RuleTestCaseStatus
from policy_pipeline.shared.database import Base, RuleTestCaseRecord
from tests.test_compiled_rule_sets_api import _configure_local_auth_with_admin
from tests.test_rule_test_cases_api import (
    _compile_policy_version,
    _publish_policy_version,
    build_meal_cap_rule_payload,
)
from tests.test_rule_test_cases_run_api import _generate_rule_test_cases


async def _prepare_compiled_rule_set_with_cases(
    client: httpx.AsyncClient,
) -> tuple[str, list[str]]:
    await client.post(
        "/rules/manual",
        headers={"Authorization": "Bearer approver-token"},
        json=build_meal_cap_rule_payload(),
    )
    await _publish_policy_version(client, "policy-v1")
    compiled = await _compile_policy_version(client, "policy-v1")
    compiled_rule_set_id = compiled["compiled_rule_set_id"]
    await _generate_rule_test_cases(client, compiled_rule_set_id)

    list_response = await client.get(
        f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-cases",
        headers={"Authorization": "Bearer viewer-token"},
    )
    assert list_response.status_code == 200
    case_ids = [
        case["rule_test_case_id"]
        for group in list_response.json()["groups"]
        for case in group["cases"]
    ]
    return compiled_rule_set_id, case_ids


@pytest.mark.anyio
async def test_approver_disables_rule_test_case_with_rationale_and_audits_it(
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
        target_case_id = case_ids[0]

        disable_response = await client.post(
            f"/rule-test-cases/{target_case_id}/disable",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "Fixture no longer reflects policy intent."},
        )
        list_response = await client.get(
            f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-cases",
            headers={"Authorization": "Bearer viewer-token"},
        )
        active_list_response = await client.get(
            f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-cases",
            headers={"Authorization": "Bearer viewer-token"},
            params={"status": RuleTestCaseStatus.ACTIVE.value},
        )
        disabled_list_response = await client.get(
            f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-cases",
            headers={"Authorization": "Bearer viewer-token"},
            params={"status": RuleTestCaseStatus.DISABLED.value},
        )
        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={"entity_type": "rule_test_case", "entity_id": target_case_id},
        )

    assert disable_response.status_code == 200
    disabled_case = disable_response.json()
    assert disabled_case["status"] == RuleTestCaseStatus.DISABLED.value
    assert disabled_case["disable_rationale"] == "Fixture no longer reflects policy intent."
    assert disabled_case["disabled_by"] == "approver-user"
    assert disabled_case["disabled_at"] is not None

    list_payload = list_response.json()
    assert list_payload["total_count"] == 3
    assert list_payload["active_count"] == 2
    assert list_payload["disabled_count"] == 1

    active_case_ids = [
        case["rule_test_case_id"]
        for group in active_list_response.json()["groups"]
        for case in group["cases"]
    ]
    disabled_case_ids = [
        case["rule_test_case_id"]
        for group in disabled_list_response.json()["groups"]
        for case in group["cases"]
    ]
    assert target_case_id not in active_case_ids
    assert disabled_case_ids == [target_case_id]

    assert audit_response.status_code == 200
    audit_items = audit_response.json()["items"]
    assert len(audit_items) == 1
    assert audit_items[0] == {
        "action": "rule_test_case.disabled",
        "actor_subject": "approver-user",
        "actor_roles": ["approver"],
        "entity_type": "rule_test_case",
        "entity_id": target_case_id,
        "payload": {
            "rule_test_case_id": target_case_id,
            "rationale": "Fixture no longer reflects policy intent.",
            "compiled_rule_set_id": compiled_rule_set_id,
            "rule_id": "rule-meal-cap-domestic",
        },
        "occurred_at": audit_items[0]["occurred_at"],
    }


@pytest.mark.anyio
async def test_admin_and_viewer_cannot_disable_rule_test_case(
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

        admin_response = await client.post(
            f"/rule-test-cases/{target_case_id}/disable",
            headers={"Authorization": "Bearer admin-token"},
            json={"rationale": "Should not be allowed."},
        )
        viewer_response = await client.post(
            f"/rule-test-cases/{target_case_id}/disable",
            headers={"Authorization": "Bearer viewer-token"},
            json={"rationale": "Should not be allowed."},
        )

    assert admin_response.status_code == 403
    assert viewer_response.status_code == 403


@pytest.mark.anyio
async def test_disabled_rule_test_cases_are_excluded_from_runs(
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

        disable_response = await client.post(
            f"/rule-test-cases/{case_ids[0]}/disable",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "Exclude from automated runs."},
        )
        run_response = await client.post(
            f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-runs",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert disable_response.status_code == 200
    assert run_response.status_code == 201
    payload = run_response.json()
    assert payload["summary"]["total_count"] == 2
    assert len(payload["case_results"]) == 2
    assert case_ids[0] not in {
        result["rule_test_case_id"] for result in payload["case_results"]
    }


@pytest.mark.anyio
async def test_execute_rule_test_run_when_all_cases_disabled_returns_422(
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

        for case_id in case_ids:
            disable_response = await client.post(
                f"/rule-test-cases/{case_id}/disable",
                headers={"Authorization": "Bearer approver-token"},
                json={"rationale": f"Disable {case_id}."},
            )
            assert disable_response.status_code == 200

        run_response = await client.post(
            f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-runs",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert run_response.status_code == 422
    assert run_response.json() == {
        "detail": "No active Rule Test Cases exist for this Compiled Rule Set.",
    }


@pytest.mark.anyio
async def test_disable_rule_test_case_validates_rationale_and_idempotency(
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

        empty_rationale_response = await client.post(
            f"/rule-test-cases/{target_case_id}/disable",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": ""},
        )
        first_disable_response = await client.post(
            f"/rule-test-cases/{target_case_id}/disable",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "First disable."},
        )
        second_disable_response = await client.post(
            f"/rule-test-cases/{target_case_id}/disable",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "Second disable."},
        )
        missing_response = await client.post(
            "/rule-test-cases/missing-case/disable",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "Missing case."},
        )

    assert empty_rationale_response.status_code == 422
    assert first_disable_response.status_code == 200
    assert second_disable_response.status_code == 409
    assert second_disable_response.json() == {"detail": "Rule Test Case is already disabled."}
    assert missing_response.status_code == 404
    assert missing_response.json() == {"detail": "Rule Test Case was not found."}

    engine = create_engine(database_url)
    with Session(engine) as session:
        record = session.get(RuleTestCaseRecord, target_case_id)
        assert record is not None
        assert record.payload["status"] == RuleTestCaseStatus.DISABLED.value
        assert record.payload["disable_rationale"] == "First disable."
    engine.dispose()


@pytest.mark.anyio
async def test_approver_enables_disabled_rule_test_case_with_rationale_and_audits_it(
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

        await client.post(
            f"/rule-test-cases/{target_case_id}/disable",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "Temporary exclusion."},
        )
        enable_response = await client.post(
            f"/rule-test-cases/{target_case_id}/enable",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "Ready to include again."},
        )
        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={"entity_type": "rule_test_case", "entity_id": target_case_id},
        )

    assert enable_response.status_code == 200
    enabled_case = enable_response.json()
    assert enabled_case["status"] == RuleTestCaseStatus.ACTIVE.value
    assert enabled_case["disable_rationale"] is None

    assert audit_response.status_code == 200
    audit_items = audit_response.json()["items"]
    assert len(audit_items) == 2
    actions = {item["action"]: item for item in audit_items}
    assert actions["rule_test_case.enabled"]["payload"]["rationale"] == "Ready to include again."
    assert actions["rule_test_case.disabled"]["payload"]["rationale"] == "Temporary exclusion."


@pytest.mark.anyio
async def test_admin_and_viewer_cannot_enable_rule_test_case(
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
        await client.post(
            f"/rule-test-cases/{target_case_id}/disable",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "Disable for RBAC test."},
        )

        admin_response = await client.post(
            f"/rule-test-cases/{target_case_id}/enable",
            headers={"Authorization": "Bearer admin-token"},
            json={"rationale": "Should not be allowed."},
        )
        viewer_response = await client.post(
            f"/rule-test-cases/{target_case_id}/enable",
            headers={"Authorization": "Bearer viewer-token"},
            json={"rationale": "Should not be allowed."},
        )

    assert admin_response.status_code == 403
    assert viewer_response.status_code == 403


@pytest.mark.anyio
async def test_reenabled_rule_test_case_is_included_in_runs(
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

        await client.post(
            f"/rule-test-cases/{case_ids[0]}/disable",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "Temporary."},
        )
        await client.post(
            f"/rule-test-cases/{case_ids[0]}/enable",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "Back in rotation."},
        )
        run_response = await client.post(
            f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-runs",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert run_response.status_code == 201
    assert run_response.json()["summary"]["total_count"] == 3
