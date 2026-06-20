import json

import httpx
import pytest
from sqlalchemy import create_engine
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


def _seed_rule(database_url: str, *, rule_id: str, lifecycle_state: str) -> None:
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(
            RuleRecord(
                rule_id=rule_id,
                origin_source_type="manual",
                lifecycle_state=lifecycle_state,
                payload={
                    "rule_id": rule_id,
                    "statement": "Entertainment spending should remain modest and in good taste.",
                    "enforceability_class": "guidance",
                    "lifecycle_state": lifecycle_state,
                    "origin": {
                        "source_type": "manual",
                        "rationale": "Approver captured policy guidance from the document.",
                    },
                    "scope": {
                        "expense_category": "entertainment",
                        "employee_group": "all",
                    },
                    "citation": {
                        "document_id": "doc-expense-policy",
                        "document_version_id": "docv-2026-06-01",
                        "section_id": "meals-and-entertainment#def456",
                        "quote": "Entertainment spending should remain modest and in good taste.",
                        "start_char": 901,
                        "end_char": 962,
                    },
                    "exceptions": [],
                },
            )
        )
        session.commit()
    engine.dispose()


@pytest.mark.anyio
async def test_publishes_first_policy_version_and_reads_versioned_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)
    _seed_rule(database_url, rule_id="rule-123", lifecycle_state="approved")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        publish_response = await client.post(
            "/policy-versions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "policy_version_id": "policy-v1",
                "change_summary": "Initial immutable snapshot of approved manual Rules.",
            },
        )
        read_response = await client.get(
            "/policy-versions/policy-v1",
            headers={"Authorization": "Bearer viewer-token"},
        )
        export_response = await client.get(
            "/policy-versions/policy-v1/snapshot",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert publish_response.status_code == 201
    assert publish_response.json() == {
        "policy_version_id": "policy-v1",
        "rule_count": 1,
        "status": "published",
        "published_by": "approver-user",
    }

    expected_snapshot = {
        "policy_version_id": "policy-v1",
        "change_summary": "Initial immutable snapshot of approved manual Rules.",
        "published_by": "approver-user",
        "rules": [
            {
                "rule_id": "rule-123",
                "statement": "Entertainment spending should remain modest and in good taste.",
                "enforceability_class": "guidance",
                "lifecycle_state": "published",
                "origin": {
                    "source_type": "manual",
                    "extraction_run_id": None,
                    "rationale": "Approver captured policy guidance from the document.",
                },
                "scope": {
                    "country": None,
                    "expense_category": "entertainment",
                    "travel_type": None,
                    "employee_group": "all",
                    "effective_start_date": None,
                    "effective_end_date": None,
                },
                "citation": {
                    "document_id": "doc-expense-policy",
                    "document_version_id": "docv-2026-06-01",
                    "section_id": "meals-and-entertainment#def456",
                    "quote": "Entertainment spending should remain modest and in good taste.",
                    "start_char": 901,
                    "end_char": 962,
                },
                "exceptions": [],
                "condition": None,
                "applicability": None,
            }
        ],
    }

    assert read_response.status_code == 200
    assert read_response.json() == expected_snapshot

    assert export_response.status_code == 200
    assert export_response.headers["content-type"].startswith("application/json")
    assert export_response.headers["content-disposition"] == (
        'attachment; filename="policy-v1.json"'
    )
    assert export_response.json() == expected_snapshot

    engine = create_engine(database_url)
    with Session(engine) as session:
        stored_version = session.get(PolicyVersionRecord, "policy-v1")
        assert stored_version is not None
        assert stored_version.snapshot == expected_snapshot

        stored_rule = session.get(RuleRecord, "rule-123")
        assert stored_rule is not None
        assert stored_rule.lifecycle_state == "published"
        assert stored_rule.payload["lifecycle_state"] == "published"
    engine.dispose()


@pytest.mark.anyio
async def test_rejects_attempt_to_overwrite_published_policy_version(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)
    _seed_rule(database_url, rule_id="rule-123", lifecycle_state="approved")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        first_publish = await client.post(
            "/policy-versions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "policy_version_id": "policy-v1",
                "change_summary": "Initial immutable snapshot of approved manual Rules.",
            },
        )
        second_publish = await client.post(
            "/policy-versions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "policy_version_id": "policy-v1",
                "change_summary": "Attempted overwrite should be rejected.",
            },
        )

    assert first_publish.status_code == 201
    assert second_publish.status_code == 409
    assert second_publish.json() == {
        "detail": "Published Policy Versions are immutable and cannot be overwritten.",
    }
