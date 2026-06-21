import json

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from policy_pipeline.database import Base, PolicyVersionRecord, RuleRecord
from policy_pipeline.main import create_app


def _configure_local_auth(monkeypatch: pytest.MonkeyPatch, database_url: str) -> None:
    monkeypatch.setenv("POLICY_PIPELINE_DATABASE_URL", database_url)
    monkeypatch.setenv(
        "POLICY_PIPELINE_LOCAL_AUTH_IDENTITIES",
        json.dumps(
            [
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


def build_manual_rule_payload() -> dict[str, object]:
    return {
        "rule_id": "rule-manual-offsite-dinner-cap",
        "statement": "Team offsites may reimburse dinner up to $120 with director approval.",
        "enforceability_class": "enforceable",
        "rationale": (
            "Finance approved a temporary offsite exception not yet reflected in the "
            "Policy Document."
        ),
        "scope": {
            "expense_category": "meals",
            "employee_group": "employees",
        },
        "condition": {
            "field": "meal.amount",
            "operator": "<=",
            "value": "120",
        },
        "applicability": {
            "aggregation_period": "per_transaction",
            "unit": "money",
            "currency": "USD",
            "limit_basis": "per employee",
        },
        "exceptions": [
            {
                "description": "Director approval is required.",
                "required_evidence": ["director_approval"],
            }
        ],
    }


@pytest.mark.anyio
async def test_approver_publishes_first_policy_version_and_reads_it(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    payload = build_manual_rule_payload()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        create_response = await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=payload,
        )
        publish_response = await client.post(
            "/policy-versions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "policy_version_id": "policy-v1",
                "change_summary": "Initial immutable snapshot of approved Manual Rules.",
            },
        )
        read_response = await client.get(
            "/policy-versions/policy-v1",
            headers={"Authorization": "Bearer viewer-token"},
        )

    expected_snapshot = {
        "policy_version_id": "policy-v1",
        "change_summary": "Initial immutable snapshot of approved Manual Rules.",
        "published_by": "approver-user",
        "rules": [
            {
                "rule_id": payload["rule_id"],
                "statement": payload["statement"],
                "enforceability_class": "enforceable",
                "lifecycle_state": "published",
                "origin": {
                    "source_type": "manual",
                    "extraction_run_id": None,
                    "rationale": payload["rationale"],
                },
                "scope": {
                    "country": None,
                    "expense_category": "meals",
                    "travel_type": None,
                    "employee_group": "employees",
                    "effective_start_date": None,
                    "effective_end_date": None,
                },
                "citation": None,
                "condition": payload["condition"],
                "applicability": payload["applicability"],
                "exceptions": payload["exceptions"],
            }
        ],
    }

    assert create_response.status_code == 201
    assert create_response.json()["lifecycle_state"] == "approved"
    assert publish_response.status_code == 201
    assert publish_response.json() == {
        "policy_version_id": "policy-v1",
        "rule_count": 1,
        "status": "published",
        "published_by": "approver-user",
    }
    assert read_response.status_code == 200
    assert read_response.json() == expected_snapshot

    engine = create_engine(database_url)
    with Session(engine) as session:
        stored_version = session.scalar(
            select(PolicyVersionRecord).where(
                PolicyVersionRecord.policy_version_id == "policy-v1"
            )
        )
    engine.dispose()

    assert stored_version is not None
    assert stored_version.snapshot == expected_snapshot


@pytest.mark.anyio
async def test_policy_version_snapshot_exports_as_json_and_rejects_mutation(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    payload = build_manual_rule_payload()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        create_response = await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=payload,
        )
        publish_response = await client.post(
            "/policy-versions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "policy_version_id": "policy-v1",
                "change_summary": "Initial immutable snapshot of approved Manual Rules.",
            },
        )
        export_response = await client.get(
            "/policy-versions/policy-v1/snapshot",
            headers={"Authorization": "Bearer viewer-token"},
        )
        duplicate_publish_response = await client.post(
            "/policy-versions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "policy_version_id": "policy-v1",
                "change_summary": "Attempted overwrite of published snapshot.",
            },
        )

    assert create_response.status_code == 201
    assert publish_response.status_code == 201
    assert export_response.status_code == 200
    assert export_response.headers["content-type"].startswith("application/json")
    assert export_response.headers["content-disposition"] == (
        'attachment; filename="policy-v1.json"'
    )
    assert export_response.json()["policy_version_id"] == "policy-v1"
    assert export_response.json()["rules"][0]["lifecycle_state"] == "published"
    assert duplicate_publish_response.status_code == 409
    assert duplicate_publish_response.json() == {
        "detail": "Published Policy Versions are immutable and cannot be overwritten.",
    }

    engine = create_engine(database_url)
    with Session(engine) as session:
        stored_rule = session.scalar(
            select(RuleRecord).where(RuleRecord.rule_id == payload["rule_id"])
        )
    engine.dispose()

    assert stored_rule is not None
    assert stored_rule.payload["lifecycle_state"] == "approved"


@pytest.mark.anyio
async def test_policy_version_snapshot_export_sanitizes_attachment_filename(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    payload = build_manual_rule_payload()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        create_response = await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=payload,
        )
        publish_response = await client.post(
            "/policy-versions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "policy_version_id": 'policy-v1"quarterly',
                "change_summary": "Initial immutable snapshot of approved Manual Rules.",
            },
        )
        export_response = await client.get(
            "/policy-versions/policy-v1%22quarterly/snapshot",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert create_response.status_code == 201
    assert publish_response.status_code == 201
    assert export_response.status_code == 200
    assert export_response.headers["content-disposition"] == (
        'attachment; filename="policy-v1_quarterly.json"'
    )
    assert export_response.json()["policy_version_id"] == 'policy-v1"quarterly'
