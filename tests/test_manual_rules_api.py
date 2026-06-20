import json

import httpx
import pytest
from sqlalchemy import create_engine, select
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


def build_manual_rule_payload() -> dict[str, object]:
    return {
        "rule_id": "rule-manual-meal-cap",
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
@pytest.mark.parametrize(
    ("token", "subject"),
    [
        ("admin-token", "admin-user"),
        ("approver-token", "approver-user"),
    ],
)
async def test_admin_and_approver_can_create_manual_rule_without_citation_and_audit_it(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
    token: str,
    subject: str,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    payload = build_manual_rule_payload()
    payload["rule_id"] = f"{payload['rule_id']}-{subject}"

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        create_response = await client.post(
            "/rules/manual",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )
        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={"entity_type": "rule", "entity_id": payload["rule_id"]},
        )

    assert create_response.status_code == 201
    assert create_response.json() == {
        "rule_id": payload["rule_id"],
        "statement": payload["statement"],
        "enforceability_class": "enforceable",
        "lifecycle_state": "approved",
        "origin": {
            "source_type": "manual",
            "rationale": payload["rationale"],
            "extraction_run_id": None,
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
    assert audit_response.status_code == 200
    assert audit_response.json() == {
        "items": [
            {
                "action": "rule.created",
                "actor_subject": subject,
                "actor_roles": ["admin" if token == "admin-token" else "approver"],
                "entity_type": "rule",
                "entity_id": payload["rule_id"],
                "payload": {
                    "origin": "manual",
                    "rationale": payload["rationale"],
                    "has_citation": False,
                },
            }
        ]
    }

    engine = create_engine(database_url)
    with Session(engine) as session:
        stored_rule = session.scalar(
            select(RuleRecord).where(RuleRecord.rule_id == payload["rule_id"])
        )
    engine.dispose()

    assert stored_rule is not None
    assert stored_rule.origin_source_type == "manual"
    assert stored_rule.payload["origin"]["source_type"] == "manual"
    assert stored_rule.payload["citation"] is None


@pytest.mark.anyio
async def test_approver_can_create_manual_rule_with_citation(
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
    payload["rule_id"] = "rule-manual-meal-cap-with-citation"
    payload["citation"] = {
        "document_id": "doc-expense-policy",
        "document_version_id": "docv-2026-06-01",
        "section_id": "offsites#abc123",
        "quote": "Team offsites may reimburse dinner up to $120 with director approval.",
        "start_char": 120,
        "end_char": 191,
    }

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        create_response = await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=payload,
        )
        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={"entity_type": "rule", "entity_id": payload["rule_id"]},
        )

    assert create_response.status_code == 201
    assert create_response.json()["citation"] == payload["citation"]
    assert audit_response.status_code == 200
    assert audit_response.json()["items"] == [
        {
            "action": "rule.created",
            "actor_subject": "approver-user",
            "actor_roles": ["approver"],
            "entity_type": "rule",
            "entity_id": payload["rule_id"],
            "payload": {
                "origin": "manual",
                "rationale": payload["rationale"],
                "has_citation": True,
            },
        }
    ]

    engine = create_engine(database_url)
    with Session(engine) as session:
        stored_rule = session.scalar(
            select(RuleRecord).where(RuleRecord.rule_id == payload["rule_id"])
        )
    engine.dispose()

    assert stored_rule is not None
    assert stored_rule.payload["citation"] == payload["citation"]


@pytest.mark.anyio
async def test_manual_rule_creation_fails_without_rationale(
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
    payload.pop("rationale")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=payload,
        )

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "rationale"]


@pytest.mark.anyio
async def test_viewer_cannot_create_manual_rule(
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
            "/rules/manual",
            headers={"Authorization": "Bearer viewer-token"},
            json=build_manual_rule_payload(),
        )

    assert response.status_code == 403
    assert response.json() == {
        "detail": "You do not have access to this resource.",
    }
