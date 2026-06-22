from __future__ import annotations

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from policy_pipeline.main import create_app
from policy_pipeline.shared.database import Base, RuleTestCaseRecord, RuleTestRunRecord
from tests.test_rule_test_cases_api import (
    _compile_policy_version,
    _publish_policy_version,
    build_meal_cap_rule_payload,
)
from tests.test_compiled_rule_sets_api import _configure_local_auth_with_admin


async def _generate_rule_test_cases(
    client: httpx.AsyncClient,
    compiled_rule_set_id: str,
) -> None:
    response = await client.post(
        f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-cases/generate",
        headers={"Authorization": "Bearer admin-token"},
    )
    assert response.status_code == 201


@pytest.mark.anyio
async def test_admin_executes_green_rule_test_run(
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
        await _generate_rule_test_cases(client, compiled_rule_set_id)

        run_response = await client.post(
            f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-runs",
            headers={"Authorization": "Bearer admin-token"},
        )
        list_response = await client.get(
            f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-runs",
            headers={"Authorization": "Bearer viewer-token"},
        )
        run_id = run_response.json()["rule_test_run_id"]
        detail_response = await client.get(
            f"/rule-test-runs/{run_id}",
            headers={"Authorization": "Bearer viewer-token"},
        )
        report_response = await client.get(
            f"/rule-test-runs/{run_id}/report",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert run_response.status_code == 201
    payload = run_response.json()
    assert payload["summary"]["overall_passed"] is True
    assert payload["summary"]["total_count"] == 3
    assert payload["summary"]["passed_count"] == 3
    assert payload["summary"]["failed_count"] == 0
    assert all(case["passed"] for case in payload["case_results"])

    assert list_response.status_code == 200
    assert len(list_response.json()["items"]) == 1

    assert detail_response.status_code == 200
    assert detail_response.json() == payload

    assert report_response.status_code == 200
    assert report_response.headers["content-disposition"].startswith("attachment;")
    assert report_response.json() == payload

    engine = create_engine(database_url)
    with Session(engine) as session:
        stored_runs = session.scalars(select(RuleTestRunRecord)).all()
    engine.dispose()
    assert len(stored_runs) == 1


@pytest.mark.anyio
async def test_rule_test_run_reports_failure_when_expected_outcome_is_wrong(
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
        run_response = await client.post(
            f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-runs",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert run_response.status_code == 201
    payload = run_response.json()
    assert payload["summary"]["overall_passed"] is False
    assert payload["summary"]["failed_count"] >= 1
    assert any(not case["passed"] for case in payload["case_results"])


@pytest.mark.anyio
async def test_viewer_cannot_execute_rule_test_run(
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
        await _generate_rule_test_cases(client, compiled_rule_set_id)

        viewer_run = await client.post(
            f"/compiled-rule-sets/{compiled_rule_set_id}/rule-test-runs",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert viewer_run.status_code == 403


@pytest.mark.anyio
async def test_execute_rule_test_run_without_cases_returns_422(
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
        run_response = await client.post(
            f"/compiled-rule-sets/{compiled['compiled_rule_set_id']}/rule-test-runs",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert run_response.status_code == 422
    assert run_response.json() == {
        "detail": "No active Rule Test Cases exist for this Compiled Rule Set.",
    }


@pytest.mark.anyio
async def test_execute_rule_test_run_for_unknown_compiled_rule_set_returns_404(
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
            "/compiled-rule-sets/missing-set/rule-test-runs",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert run_response.status_code == 404
    assert run_response.json() == {"detail": "Compiled Rule Set was not found."}
