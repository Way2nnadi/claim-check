from __future__ import annotations

import json

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from policy_pipeline.compiled_rule_sets.models import CompileStatus
from policy_pipeline.main import create_app
from policy_pipeline.shared.database import Base, CompiledRuleSetRecord
from tests.test_policy_versions_api import build_manual_rule_payload


def _configure_local_auth_with_admin(
    monkeypatch: pytest.MonkeyPatch,
    database_url: str,
) -> None:
    monkeypatch.setenv("POLICY_PIPELINE_DATABASE_URL", database_url)
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
                    "token": "approver-token",
                    "subject": "approver-user",
                    "roles": ["approver"],
                },
                {
                    "token": "viewer-token",
                    "subject": "viewer-user",
                    "roles": ["viewer"],
                },
            ]
        ),
    )


def build_guidance_rule_payload(*, rule_id: str) -> dict[str, object]:
    return {
        "rule_id": rule_id,
        "statement": "Employees should prefer negotiated hotel blocks when available.",
        "enforceability_class": "guidance",
        "rationale": "Captured as preserved guidance in the published snapshot.",
        "scope": {
            "expense_category": "lodging",
        },
    }


def build_enforceable_rule_missing_applicability_payload(*, rule_id: str) -> dict[str, object]:
    return {
        "rule_id": rule_id,
        "statement": "Domestic meals are capped at $75 per day.",
        "enforceability_class": "enforceable",
        "rationale": "Manual cap without applicability metadata.",
        "scope": {
            "expense_category": "meals",
        },
        "condition": {
            "field": "meal.amount",
            "operator": "<=",
            "value": "75",
        },
    }


async def _publish_policy_version(client: httpx.AsyncClient, policy_version_id: str) -> None:
    publish_response = await client.post(
        "/policy-versions",
        headers={"Authorization": "Bearer approver-token"},
        json={
            "policy_version_id": policy_version_id,
            "change_summary": "Published snapshot for compile tests.",
        },
    )
    assert publish_response.status_code == 201


@pytest.mark.anyio
async def test_admin_compiles_policy_version_with_mixed_rules(
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
        enforceable_response = await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=build_manual_rule_payload(),
        )
        guidance_response = await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=build_guidance_rule_payload(rule_id="rule-lodging-guidance"),
        )
        await _publish_policy_version(client, "policy-v1")
        compile_response = await client.post(
            "/policy-versions/policy-v1/compiled-rule-sets",
            headers={"Authorization": "Bearer admin-token"},
        )
        inspect_response = await client.get(
            f"/compiled-rule-sets/{compile_response.json()['compiled_rule_set_id']}",
            headers={"Authorization": "Bearer viewer-token"},
        )
        list_response = await client.get(
            "/compiled-rule-sets",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert enforceable_response.status_code == 201
    assert guidance_response.status_code == 201
    assert compile_response.status_code == 201
    payload = compile_response.json()
    assert payload["policy_version_id"] == "policy-v1"
    assert payload["compiled_by"] == "admin-user"
    assert payload["summary"] == {
        "compiled": 1,
        "skipped_non_enforceable": 1,
        "compile_error": 0,
    }
    assert len(payload["entries"]) == 2

    compiled_entry = next(
        entry for entry in payload["entries"] if entry["rule_id"] == build_manual_rule_payload()["rule_id"]
    )
    skipped_entry = next(
        entry for entry in payload["entries"] if entry["rule_id"] == "rule-lodging-guidance"
    )
    assert compiled_entry["status"] == CompileStatus.COMPILED.value
    assert compiled_entry["compiled_rule"] is not None
    assert skipped_entry["status"] == CompileStatus.SKIPPED_NON_ENFORCEABLE.value
    assert skipped_entry["skip_reason"] == "Guidance Rules are not machine-checkable."

    assert inspect_response.status_code == 200
    assert inspect_response.json() == payload
    assert list_response.status_code == 200
    assert len(list_response.json()["items"]) == 1


@pytest.mark.anyio
async def test_duplicate_compile_returns_existing_compiled_rule_set(
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
        create_response = await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=build_manual_rule_payload(),
        )
        await _publish_policy_version(client, "policy-v1")
        first_compile = await client.post(
            "/policy-versions/policy-v1/compiled-rule-sets",
            headers={"Authorization": "Bearer admin-token"},
        )
        second_compile = await client.post(
            "/policy-versions/policy-v1/compiled-rule-sets",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert create_response.status_code == 201
    assert first_compile.status_code == 201
    assert second_compile.status_code == 200
    assert first_compile.json()["compiled_rule_set_id"] == second_compile.json()["compiled_rule_set_id"]

    engine = create_engine(database_url)
    with Session(engine) as session:
        stored_sets = session.scalars(select(CompiledRuleSetRecord)).all()
    engine.dispose()
    assert len(stored_sets) == 1


@pytest.mark.anyio
async def test_viewer_cannot_compile_but_can_inspect(
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
            json=build_manual_rule_payload(),
        )
        await _publish_policy_version(client, "policy-v1")
        admin_compile = await client.post(
            "/policy-versions/policy-v1/compiled-rule-sets",
            headers={"Authorization": "Bearer admin-token"},
        )
        viewer_compile = await client.post(
            "/policy-versions/policy-v1/compiled-rule-sets",
            headers={"Authorization": "Bearer viewer-token"},
        )
        viewer_inspect = await client.get(
            f"/compiled-rule-sets/{admin_compile.json()['compiled_rule_set_id']}",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert admin_compile.status_code == 201
    assert viewer_compile.status_code == 403
    assert viewer_inspect.status_code == 200


@pytest.mark.anyio
async def test_approver_cannot_compile(
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
            json=build_manual_rule_payload(),
        )
        await _publish_policy_version(client, "policy-v1")
        compile_response = await client.post(
            "/policy-versions/policy-v1/compiled-rule-sets",
            headers={"Authorization": "Bearer approver-token"},
        )

    assert compile_response.status_code == 403


@pytest.mark.anyio
async def test_compile_records_enforceable_rule_missing_applicability_as_error(
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
            json=build_enforceable_rule_missing_applicability_payload(
                rule_id="rule-meals-no-applicability",
            ),
        )
        await _publish_policy_version(client, "policy-v1")
        compile_response = await client.post(
            "/policy-versions/policy-v1/compiled-rule-sets",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert compile_response.status_code == 201
    payload = compile_response.json()
    assert payload["summary"] == {
        "compiled": 0,
        "skipped_non_enforceable": 0,
        "compile_error": 1,
    }
    entry = payload["entries"][0]
    assert entry["status"] == CompileStatus.COMPILE_ERROR.value
    assert "applicability" in entry["error_reason"]


@pytest.mark.anyio
async def test_compile_unknown_policy_version_returns_404(
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
        compile_response = await client.post(
            "/policy-versions/missing-version/compiled-rule-sets",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert compile_response.status_code == 404
    assert compile_response.json() == {"detail": "Policy Version was not found."}
