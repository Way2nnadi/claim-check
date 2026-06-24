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


async def _create_violation_review(client: httpx.AsyncClient) -> tuple[str, str]:
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
    return run_id, f"{run_id}:0"


@pytest.mark.parametrize(
    "resolution_type",
    ["upheld", "overridden_pass", "escalated"],
)
@pytest.mark.anyio
async def test_approver_resolves_compliance_review_with_each_resolution_type(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
    resolution_type: str,
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
        _, review_id = await _create_violation_review(client)

        resolve_response = await client.post(
            f"/compliance-reviews/{review_id}/decisions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "resolution_type": resolution_type,
                "rationale": f"Recorded as {resolution_type}.",
            },
        )
        queue_response = await client.get(
            "/compliance-reviews",
            headers={"Authorization": "Bearer viewer-token"},
        )
        detail_response = await client.get(
            f"/compliance-reviews/{review_id}",
            headers={"Authorization": "Bearer viewer-token"},
        )
        duplicate_response = await client.post(
            f"/compliance-reviews/{review_id}/decisions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "resolution_type": resolution_type,
                "rationale": "Second attempt.",
            },
        )

    assert resolve_response.status_code == 201
    decision = resolve_response.json()["decision"]
    assert decision["evaluation_outcome_id"] == review_id
    assert decision["resolution_type"] == resolution_type
    assert decision["rationale"] == f"Recorded as {resolution_type}."
    assert decision["recorded_by"] == "approver-user"
    assert decision["row_index"] == 0

    assert queue_response.status_code == 200
    assert queue_response.json()["items"] == []

    assert detail_response.status_code == 200
    assert detail_response.json()["decision"]["compliance_review_decision_id"] == (
        decision["compliance_review_decision_id"]
    )

    assert duplicate_response.status_code == 409


@pytest.mark.anyio
async def test_compliance_review_resolution_rejects_empty_rationale(
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
        _, review_id = await _create_violation_review(client)

        resolve_response = await client.post(
            f"/compliance-reviews/{review_id}/decisions",
            headers={"Authorization": "Bearer approver-token"},
            json={"resolution_type": "upheld", "rationale": "   "},
        )

    assert resolve_response.status_code == 422


@pytest.mark.anyio
async def test_admin_and_viewer_cannot_resolve_compliance_review(
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
        _, review_id = await _create_violation_review(client)

        admin_response = await client.post(
            f"/compliance-reviews/{review_id}/decisions",
            headers={"Authorization": "Bearer admin-token"},
            json={"resolution_type": "upheld", "rationale": "Admin attempt."},
        )
        viewer_response = await client.post(
            f"/compliance-reviews/{review_id}/decisions",
            headers={"Authorization": "Bearer viewer-token"},
            json={"resolution_type": "upheld", "rationale": "Viewer attempt."},
        )
        queue_response = await client.get(
            "/compliance-reviews",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert admin_response.status_code == 403
    assert viewer_response.status_code == 403
    assert len(queue_response.json()["items"]) == 1
