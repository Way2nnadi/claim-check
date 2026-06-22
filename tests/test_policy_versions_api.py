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
    RuleCondition,
    RuleOrigin,
    RuleOriginType,
    Scope,
)
from policy_pipeline.rules.store import create_rule
from policy_pipeline.shared.database import Base, PolicyVersionRecord, RuleRecord


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


def _build_candidate_rule(
    *,
    rule_id: str,
    statement: str,
    section_id: str,
    start_char: int,
    end_char: int,
    value: str,
) -> CandidateRule:
    return CandidateRule(
        rule_id=rule_id,
        statement=statement,
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
            section_id=section_id,
            quote=statement,
            start_char=start_char,
            end_char=end_char,
        ),
        condition=RuleCondition(
            field="meal.amount",
            operator="<=",
            value=value,
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


def _seed_candidate_rules(database_url: str) -> None:
    engine = create_engine(database_url)
    with Session(engine) as session:
        create_rule(
            session,
            rule=_build_candidate_rule(
                rule_id="rule-extracted-domestic-meals",
                statement="Domestic meals are capped at $75 per day.",
                section_id="meals#domestic",
                start_char=10,
                end_char=50,
                value="75",
            ),
            commit=False,
        )
        create_rule(
            session,
            rule=_build_candidate_rule(
                rule_id="rule-extracted-international-meals",
                statement="International meals are capped at $100 per day.",
                section_id="meals#international",
                start_char=75,
                end_char=122,
                value="100",
            ),
            commit=False,
        )
        session.commit()
    engine.dispose()


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
    assert stored_rule.payload["lifecycle_state"] == "published"


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


@pytest.mark.anyio
async def test_bulk_approve_extracted_candidate_rules_and_publish_policy_version(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()
    _seed_candidate_rules(database_url)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        bulk_approval_response = await client.post(
            "/candidate-rules/approvals/bulk",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "candidate_rule_ids": [
                    "rule-extracted-domestic-meals",
                    "rule-extracted-international-meals",
                ],
                "rationale": "Bulk-approved after citation and QA review.",
            },
        )
        publish_response = await client.post(
            "/policy-versions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "policy_version_id": "policy-v1",
                "change_summary": "Published extracted meal caps after bulk approval.",
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

    assert bulk_approval_response.status_code == 200
    assert bulk_approval_response.json() == {
        "approved_candidate_rule_ids": [
            "rule-extracted-domestic-meals",
            "rule-extracted-international-meals",
        ],
        "failed_candidate_rules": [],
        "status": "approved",
        "recorded_by": "approver-user",
    }
    assert publish_response.status_code == 201
    assert publish_response.json() == {
        "policy_version_id": "policy-v1",
        "rule_count": 2,
        "status": "published",
        "published_by": "approver-user",
    }
    assert read_response.status_code == 200
    assert read_response.json()["policy_version_id"] == "policy-v1"
    assert [rule["rule_id"] for rule in read_response.json()["rules"]] == [
        "rule-extracted-domestic-meals",
        "rule-extracted-international-meals",
    ]
    assert read_response.json()["rules"][0]["lifecycle_state"] == "published"
    assert read_response.json()["rules"][0]["citation"] == {
        "document_id": "expense-policy",
        "document_version_id": "expense-policy-v1",
        "section_id": "meals#domestic",
        "quote": "Domestic meals are capped at $75 per day.",
        "start_char": 10,
        "end_char": 50,
    }
    assert export_response.status_code == 200
    assert export_response.json() == read_response.json()


@pytest.mark.anyio
async def test_post_publish_candidate_rule_mutation_attempts_are_rejected(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()
    _seed_candidate_rules(database_url)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        bulk_approval_response = await client.post(
            "/candidate-rules/approvals/bulk",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "candidate_rule_ids": ["rule-extracted-domestic-meals"],
                "rationale": "Bulk-approved after citation and QA review.",
            },
        )
        publish_response = await client.post(
            "/policy-versions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "policy_version_id": "policy-v1",
                "change_summary": "Published extracted meal caps after bulk approval.",
            },
        )
        edit_response = await client.patch(
            "/candidate-rules/rule-extracted-domestic-meals",
            headers={"Authorization": "Bearer approver-token"},
            json={"statement": "Domestic meals are capped at $80 per day."},
        )
        rejection_response = await client.post(
            "/candidate-rules/rule-extracted-domestic-meals/rejections",
            headers={"Authorization": "Bearer approver-token"},
            json={"reason": "Attempted mutation after publication."},
        )

    assert bulk_approval_response.status_code == 200
    assert publish_response.status_code == 201
    assert edit_response.status_code == 409
    assert edit_response.json() == {
        "detail": "Candidate Rule cannot transition from published to in_review.",
    }
    assert rejection_response.status_code == 409
    assert rejection_response.json() == {
        "detail": "Candidate Rule cannot transition from published to rejected.",
    }

    engine = create_engine(database_url)
    with Session(engine) as session:
        stored_rule = session.scalar(
            select(RuleRecord).where(RuleRecord.rule_id == "rule-extracted-domestic-meals")
        )
    engine.dispose()

    assert stored_rule is not None
    assert stored_rule.payload["lifecycle_state"] == "published"


@pytest.mark.anyio
async def test_publish_policy_version_without_approved_rules_returns_422(
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
        publish_response = await client.post(
            "/policy-versions",
            headers={"Authorization": "Bearer approver-token"},
            json={
                "policy_version_id": "policy-empty",
                "change_summary": "Attempt to publish with no approved Rules.",
            },
        )

    assert publish_response.status_code == 422
    assert publish_response.json() == {
        "detail": "Policy Version requires at least one approved Rule.",
    }
