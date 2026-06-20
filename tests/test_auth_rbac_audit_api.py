import json

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from policy_pipeline.database import Base, RuleRecord
from policy_pipeline.main import create_app


def _configure_local_auth(monkeypatch: pytest.MonkeyPatch, database_url: str) -> None:
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


def _seed_manual_rule(
    database_url: str,
    *,
    rule_id: str,
    lifecycle_state: str = "in_review",
) -> None:
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
async def test_approver_records_candidate_rule_approval_and_viewer_reads_audit_event(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)
    _seed_manual_rule(database_url, rule_id="rule-123")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        approval_response = await client.post(
            "/candidate-rules/rule-123/approvals",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "Citation verified by finance."},
        )

        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={"entity_type": "candidate_rule", "entity_id": "rule-123"},
        )

    assert approval_response.status_code == 201
    assert approval_response.json() == {
        "candidate_rule_id": "rule-123",
        "status": "approved",
        "recorded_by": "approver-user",
    }

    assert audit_response.status_code == 200
    assert audit_response.json() == {
        "items": [
            {
                "action": "candidate_rule.approved",
                "actor_subject": "approver-user",
                "actor_roles": ["approver"],
                "entity_id": "rule-123",
                "entity_type": "candidate_rule",
                "payload": {"rationale": "Citation verified by finance."},
            }
        ]
    }

    engine = create_engine(database_url)
    with Session(engine) as session:
        stored_rule = session.get(RuleRecord, "rule-123")
        assert stored_rule is not None
        assert stored_rule.lifecycle_state == "approved"
        assert stored_rule.payload["lifecycle_state"] == "approved"
    engine.dispose()


@pytest.mark.anyio
async def test_protected_approval_requires_authenticated_identity(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)
    _seed_manual_rule(database_url, rule_id="rule-123")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/candidate-rules/rule-123/approvals",
            json={"rationale": "Citation verified by finance."},
        )

    assert response.status_code == 401
    assert response.json() == {
        "detail": "Authentication credentials were not provided.",
    }


@pytest.mark.anyio
async def test_viewer_cannot_approve_candidate_rule(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/candidate-rules/rule-123/approvals",
            headers={"Authorization": "Bearer viewer-token"},
            json={"rationale": "Citation verified by finance."},
        )

    assert response.status_code == 403
    assert response.json() == {
        "detail": "You do not have access to this resource.",
    }


@pytest.mark.anyio
async def test_local_auth_is_rejected_outside_local_and_test_by_default(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)
    monkeypatch.setenv("POLICY_PIPELINE_ENVIRONMENT", "production")
    _seed_manual_rule(database_url, rule_id="rule-123")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/candidate-rules/rule-123/approvals",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "Citation verified by finance."},
        )

    assert response.status_code == 401
    assert response.json() == {
        "detail": "Authentication credentials are invalid.",
    }
