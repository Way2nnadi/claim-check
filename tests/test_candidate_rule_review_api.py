import json

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from policy_pipeline.main import create_app
from policy_pipeline.rules.models import (
    Applicability,
    CandidateRule,
    Citation,
    EnforceabilityClass,
    LifecycleState,
    QAFlag,
    QAFlagCode,
    ReingestionDiffCategory,
    RuleCondition,
    RuleOrigin,
    RuleOriginType,
    Scope,
)
from policy_pipeline.rules.store import create_rule
from policy_pipeline.shared.database import Base, RuleRecord


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


def _build_candidate_rule() -> CandidateRule:
    return CandidateRule(
        rule_id="rule-123",
        statement="Meals are capped at $75 per day.",
        enforceability_class=EnforceabilityClass.ENFORCEABLE,
        lifecycle_state=LifecycleState.EXTRACTED,
        origin=RuleOrigin(
            source_type=RuleOriginType.EXTRACTED,
            extraction_run_id="extract-2026-06-21",
        ),
        scope=Scope(
            expense_category="meals",
            employee_group="employees",
        ),
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
        qa_flags=[
            QAFlag(
                code=QAFlagCode.LOW_EXTRACTION_CONFIDENCE,
                detail="Candidate Rule extraction confidence 0.62 is below 0.75.",
            )
        ],
    )


def _build_second_candidate_rule() -> CandidateRule:
    return CandidateRule(
        rule_id="rule-456",
        statement="Lodging is capped at $250 per night.",
        enforceability_class=EnforceabilityClass.ENFORCEABLE,
        lifecycle_state=LifecycleState.EXTRACTED,
        origin=RuleOrigin(
            source_type=RuleOriginType.EXTRACTED,
            extraction_run_id="extract-2026-06-21",
        ),
        scope=Scope(
            expense_category="lodging",
            employee_group="employees",
        ),
        citation=Citation(
            document_id="expense-policy",
            document_version_id="expense-policy-v1",
            section_id="lodging#def456",
            quote="Lodging is capped at $250 per night.",
            start_char=43,
            end_char=79,
        ),
        condition=RuleCondition(
            field="lodging.amount",
            operator="<=",
            value="250",
        ),
        applicability=Applicability(
            aggregation_period="per_night",
            unit="money",
            currency="USD",
            limit_basis="per room",
        ),
        qa_flags=[],
    )


def _seed_candidate_rule(database_url: str) -> None:
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        create_rule(session, rule=_build_candidate_rule())
    engine.dispose()


def _seed_multiple_candidate_rules(database_url: str) -> None:
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        create_rule(session, rule=_build_candidate_rule(), commit=False)
        create_rule(session, rule=_build_second_candidate_rule())
    engine.dispose()


@pytest.mark.anyio
async def test_approver_reads_candidate_rule_details_with_qa_flags_and_separate_values(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)
    _seed_candidate_rule(database_url)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.get(
            "/candidate-rules/rule-123",
            headers={"Authorization": "Bearer approver-token"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "candidate_rule_id": "rule-123",
        "lifecycle_state": "extracted",
        "reingestion_diff_category": None,
        "qa_flags": [
            {
                "code": "low_extraction_confidence",
                "detail": "Candidate Rule extraction confidence 0.62 is below 0.75.",
            }
        ],
        "current_rule": {
            "rule_id": "rule-123",
            "statement": "Meals are capped at $75 per day.",
            "enforceability_class": "enforceable",
            "lifecycle_state": "extracted",
            "origin": {
                "source_type": "extracted",
                "extraction_run_id": "extract-2026-06-21",
                "rationale": None,
            },
            "scope": {
                "country": None,
                "expense_category": "meals",
                "travel_type": None,
                "employee_group": "employees",
                "effective_start_date": None,
                "effective_end_date": None,
            },
            "citation": {
                "document_id": "expense-policy",
                "document_version_id": "expense-policy-v1",
                "section_id": "meals#abc123",
                "quote": "Meals are capped at $75 per day.",
                "start_char": 10,
                "end_char": 42,
            },
            "condition": {
                "field": "meal.amount",
                "operator": "<=",
                "value": "75",
            },
            "applicability": {
                "aggregation_period": "per_day",
                "unit": "money",
                "currency": "USD",
                "limit_basis": "per employee",
            },
            "exceptions": [],
        },
        "extracted_rule": {
            "rule_id": "rule-123",
            "statement": "Meals are capped at $75 per day.",
            "enforceability_class": "enforceable",
            "lifecycle_state": "extracted",
            "origin": {
                "source_type": "extracted",
                "extraction_run_id": "extract-2026-06-21",
                "rationale": None,
            },
            "scope": {
                "country": None,
                "expense_category": "meals",
                "travel_type": None,
                "employee_group": "employees",
                "effective_start_date": None,
                "effective_end_date": None,
            },
            "citation": {
                "document_id": "expense-policy",
                "document_version_id": "expense-policy-v1",
                "section_id": "meals#abc123",
                "quote": "Meals are capped at $75 per day.",
                "start_char": 10,
                "end_char": 42,
            },
            "condition": {
                "field": "meal.amount",
                "operator": "<=",
                "value": "75",
            },
            "applicability": {
                "aggregation_period": "per_day",
                "unit": "money",
                "currency": "USD",
                "limit_basis": "per employee",
            },
            "exceptions": [],
        },
        "committed_rule": None,
    }


@pytest.mark.anyio
async def test_approver_edits_candidate_rule_without_overwriting_extracted_values(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)
    _seed_candidate_rule(database_url)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        update_response = await client.patch(
            "/candidate-rules/rule-123",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "statement": "Meals are capped at $80 per day.",
                "condition": {
                    "field": "meal.amount",
                    "operator": "<=",
                    "value": "80",
                },
                "applicability": {
                    "aggregation_period": "per_day",
                    "unit": "money",
                    "currency": "USD",
                    "limit_basis": "per traveler",
                },
            },
        )
        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={"entity_type": "candidate_rule", "entity_id": "rule-123"},
        )

    assert update_response.status_code == 200
    assert update_response.json()["lifecycle_state"] == "in_review"
    assert update_response.json()["extracted_rule"]["statement"] == (
        "Meals are capped at $75 per day."
    )
    assert update_response.json()["committed_rule"]["statement"] == (
        "Meals are capped at $80 per day."
    )
    assert update_response.json()["current_rule"]["condition"]["value"] == "80"
    assert update_response.json()["committed_rule"]["applicability"]["limit_basis"] == (
        "per traveler"
    )
    assert audit_response.status_code == 200
    audit_payload = audit_response.json()
    assert audit_payload == {
        "items": [
            {
                "action": "candidate_rule.edited",
                "actor_subject": "approver-user",
                "actor_roles": ["approver"],
                "entity_type": "candidate_rule",
                "entity_id": "rule-123",
                "payload": {
                    "fields": ["applicability", "condition", "statement"],
                    "to_lifecycle_state": "in_review",
                },
                "occurred_at": audit_payload["items"][0]["occurred_at"],
            }
        ]
    }


@pytest.mark.anyio
async def test_invalid_candidate_rule_review_edit_returns_422_and_does_not_audit(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)
    _seed_candidate_rule(database_url)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        update_response = await client.patch(
            "/candidate-rules/rule-123",
            headers={"Authorization": "Bearer approver-token"},
            json={"enforceability_class": "guidance"},
        )
        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={"entity_type": "candidate_rule", "entity_id": "rule-123"},
        )

    assert update_response.status_code == 422
    assert update_response.json() == {
        "detail": (
            "Value error, Guidance and subjective Candidate Rules must not include "
            "a machine-checkable condition."
        ),
    }
    assert audit_response.status_code == 200
    assert audit_response.json() == {"items": []}


@pytest.mark.anyio
async def test_approver_rejects_candidate_rule_and_invalid_transition_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)
    _seed_candidate_rule(database_url)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        rejection_response = await client.post(
            "/candidate-rules/rule-123/rejections",
            headers={"Authorization": "Bearer approver-token"},
            json={"reason": "This sentence is duplicated elsewhere in the Policy Document."},
        )
        invalid_approval_response = await client.post(
            "/candidate-rules/rule-123/approvals",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "Attempted after rejection."},
        )

    assert rejection_response.status_code == 200
    assert rejection_response.json() == {
        "candidate_rule_id": "rule-123",
        "status": "rejected",
        "recorded_by": "approver-user",
    }
    assert invalid_approval_response.status_code == 409
    assert invalid_approval_response.json() == {
        "detail": "Candidate Rule cannot transition from rejected to approved.",
    }


@pytest.mark.anyio
async def test_candidate_rule_approval_requires_rationale(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)
    _seed_candidate_rule(database_url)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        approval_response = await client.post(
            "/candidate-rules/rule-123/approvals",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": ""},
        )

    assert approval_response.status_code == 422
    detail = approval_response.json()["detail"][0]
    assert detail["loc"] == ["body", "rationale"]


@pytest.mark.anyio
async def test_bulk_candidate_rule_approval_returns_partial_failures(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)
    _seed_multiple_candidate_rules(database_url)

    engine = create_engine(database_url)
    with Session(engine) as session:
        stored_rule = session.scalar(select(RuleRecord).where(RuleRecord.rule_id == "rule-456"))
        assert stored_rule is not None
        payload = dict(stored_rule.payload)
        payload["lifecycle_state"] = "approved"
        payload["committed_rule"] = {
            **payload["extracted_rule"],
            "lifecycle_state": "approved",
        }
        stored_rule.payload = payload
        session.commit()
    engine.dispose()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        approval_response = await client.post(
            "/candidate-rules/approvals/bulk",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "candidate_rule_ids": ["rule-123", "rule-456"],
                "rationale": "Bulk approval after re-ingestion diff review.",
            },
        )
        audit_response = await client.get(
            "/audit-events",
            headers={"Authorization": "Bearer viewer-token"},
            params={"entity_type": "candidate_rule"},
        )

    assert approval_response.status_code == 200
    assert approval_response.json() == {
        "approved_candidate_rule_ids": ["rule-123"],
        "failed_candidate_rules": [
            {
                "candidate_rule_id": "rule-456",
                "detail": "Candidate Rule cannot transition from approved to approved.",
            }
        ],
        "status": "partial",
        "recorded_by": "approver-user",
    }
    assert audit_response.status_code == 200
    audit_items = audit_response.json()["items"]
    assert len(audit_items) == 1
    assert audit_items[0] == {
        "action": "candidate_rule.approved",
        "actor_subject": "approver-user",
        "actor_roles": ["approver"],
        "entity_type": "candidate_rule",
        "entity_id": "rule-123",
        "occurred_at": audit_items[0]["occurred_at"],
        "payload": {"rationale": "Bulk approval after re-ingestion diff review."},
    }


@pytest.mark.anyio
async def test_candidate_rule_reads_reingestion_diff_category_metadata(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)
    _seed_candidate_rule(database_url)

    engine = create_engine(database_url)
    with Session(engine) as session:
        stored_rule = session.scalar(select(RuleRecord).where(RuleRecord.rule_id == "rule-123"))
        assert stored_rule is not None
        payload = dict(stored_rule.payload)
        payload["reingestion_diff_category"] = ReingestionDiffCategory.UNCHANGED.value
        stored_rule.payload = payload
        session.commit()
    engine.dispose()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.get(
            "/candidate-rules/rule-123",
            headers={"Authorization": "Bearer approver-token"},
        )

    assert response.status_code == 200
    assert response.json()["reingestion_diff_category"] == "unchanged"


@pytest.mark.anyio
async def test_approval_persists_current_committed_values_for_candidate_rule(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)
    _seed_candidate_rule(database_url)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await client.patch(
            "/candidate-rules/rule-123",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "statement": "Meals are capped at $80 per day.",
                "condition": {
                    "field": "meal.amount",
                    "operator": "<=",
                    "value": "80",
                },
            },
        )
        approval_response = await client.post(
            "/candidate-rules/rule-123/approvals",
            headers={"Authorization": "Bearer approver-token"},
            json={"rationale": "Citation verified and threshold corrected."},
        )

    assert approval_response.status_code == 201
    assert approval_response.json() == {
        "candidate_rule_id": "rule-123",
        "status": "approved",
        "recorded_by": "approver-user",
    }

    engine = create_engine(database_url)
    with Session(engine) as session:
        stored_rule = session.scalar(select(RuleRecord).where(RuleRecord.rule_id == "rule-123"))
    engine.dispose()

    assert stored_rule is not None
    assert stored_rule.payload["lifecycle_state"] == "approved"
    assert stored_rule.payload["statement"] == "Meals are capped at $80 per day."
    assert stored_rule.payload["extracted_rule"]["statement"] == "Meals are capped at $75 per day."
    assert stored_rule.payload["committed_rule"]["statement"] == "Meals are capped at $80 per day."


@pytest.mark.anyio
async def test_viewer_cannot_edit_or_reject_candidate_rule(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)
    _seed_candidate_rule(database_url)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        edit_response = await client.patch(
            "/candidate-rules/rule-123",
            headers={"Authorization": "Bearer viewer-token"},
            json={"statement": "Viewer edit should be blocked."},
        )
        rejection_response = await client.post(
            "/candidate-rules/rule-123/rejections",
            headers={"Authorization": "Bearer viewer-token"},
            json={"reason": "Viewer rejection should be blocked."},
        )

    assert edit_response.status_code == 403
    assert rejection_response.status_code == 403
    assert edit_response.json() == {"detail": "You do not have access to this resource."}
    assert rejection_response.json() == {"detail": "You do not have access to this resource."}
