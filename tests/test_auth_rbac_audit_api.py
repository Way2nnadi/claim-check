import json

import httpx
import pytest
from sqlalchemy import create_engine

from policy_pipeline.database import Base
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


@pytest.mark.anyio
async def test_approver_records_candidate_rule_approval_and_viewer_reads_audit_event(
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


@pytest.mark.anyio
async def test_protected_approval_requires_authenticated_identity(
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
