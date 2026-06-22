import json
from datetime import datetime

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from policy_pipeline.main import create_app
from policy_pipeline.rules.models import (
    Applicability,
    CandidateRule,
    Citation,
    EnforceabilityClass,
    LifecycleState,
    RuleCondition,
    RuleOrigin,
    RuleOriginType,
    Scope,
)
from policy_pipeline.rules.store import create_rule
from policy_pipeline.shared.database import Base


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
    monkeypatch.setenv(
        "POLICY_PIPELINE_CORS_ALLOWED_ORIGINS",
        json.dumps(["http://127.0.0.1:5173"]),
    )


def _seed_candidate_rule(database_url: str) -> None:
    engine = create_engine(database_url)
    with Session(engine) as session:
        create_rule(
            session,
            rule=CandidateRule(
                rule_id="rule-123",
                statement="Meals are capped at $75 per day.",
                enforceability_class=EnforceabilityClass.ENFORCEABLE,
                lifecycle_state=LifecycleState.EXTRACTED,
                origin=RuleOrigin(
                    source_type=RuleOriginType.EXTRACTED,
                    extraction_run_id="extract-2026-06-21",
                ),
                scope=Scope(expense_category="meals"),
                citation=Citation(
                    document_id="expense-policy",
                    document_version_id="expense-policy-v1",
                    section_id="meals#abc123",
                    quote="Meals are capped at $75 per day.",
                    start_char=10,
                    end_char=42,
                ),
                condition=RuleCondition(
                    field="meal.amount",
                    operator="<=",
                    value="75",
                ),
                applicability=Applicability(
                    aggregation_period="per_day",
                    unit="money",
                    currency="USD",
                    limit_basis="per employee",
                ),
            ),
        )
    engine.dispose()


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("token", "expected_subject", "expected_roles"),
    [
        ("admin-token", "admin-user", ["admin"]),
        ("approver-token", "approver-user", ["approver"]),
        ("viewer-token", "viewer-user", ["viewer"]),
    ],
)
async def test_me_returns_authenticated_principal(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
    token: str,
    expected_subject: str,
    expected_roles: list[str],
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
        response = await client.get(
            "/me",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "subject": expected_subject,
        "roles": expected_roles,
        "auth_backend": "local",
    }


@pytest.mark.anyio
async def test_me_requires_authenticated_identity(
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
        response = await client.get("/me")

    assert response.status_code == 401
    assert response.json() == {
        "detail": "Authentication credentials were not provided.",
    }


@pytest.mark.anyio
async def test_cors_preflight_allows_vite_dev_origin(
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
        response = await client.options(
            "/me",
            headers={
                "Origin": "http://127.0.0.1:5173",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "Authorization",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    assert "Authorization" in response.headers["access-control-allow-headers"]
    assert "GET" in response.headers["access-control-allow-methods"]


@pytest.mark.anyio
@pytest.mark.parametrize(
    "browse_token",
    ["admin-token", "approver-token", "viewer-token"],
)
async def test_admin_approver_and_viewer_can_browse_audit_events_with_timestamps(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
    browse_token: str,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()
    _seed_candidate_rule(database_url)

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
            headers={"Authorization": f"Bearer {browse_token}"},
            params={"entity_type": "candidate_rule", "entity_id": "rule-123"},
        )

    assert approval_response.status_code == 201
    assert approval_response.json() == {
        "candidate_rule_id": "rule-123",
        "status": "approved",
        "recorded_by": "approver-user",
    }

    assert audit_response.status_code == 200
    payload = audit_response.json()
    assert len(payload["items"]) == 1
    assert payload["items"][0] == {
        "action": "candidate_rule.approved",
        "actor_subject": "approver-user",
        "actor_roles": ["approver"],
        "entity_id": "rule-123",
        "entity_type": "candidate_rule",
        "payload": {"rationale": "Citation verified by finance."},
        "occurred_at": payload["items"][0]["occurred_at"],
    }
    assert datetime.fromisoformat(
        payload["items"][0]["occurred_at"].replace("Z", "+00:00")
    )


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


@pytest.mark.anyio
async def test_local_auth_is_rejected_outside_local_and_test_by_default(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)
    monkeypatch.setenv("POLICY_PIPELINE_ENVIRONMENT", "production")

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

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
