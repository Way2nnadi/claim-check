from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from policy_pipeline.compiled_rule_sets.compiler import compile_policy_version_snapshot
from policy_pipeline.compiled_rule_sets.records import CompiledRuleSetRecord
from policy_pipeline.compliance_evaluation_runs.golden_corpus import (
    COMPARISON_CORPUS_CASE_IDS,
    EXPENSE_GOLDEN_CORPUS_CASES,
    ExpenseGoldenCorpusCase,
)
from policy_pipeline.main import create_app
from policy_pipeline.shared.database import Base
from tests.test_compiled_rule_sets_api import _configure_local_auth_with_admin

_GOLDEN_CORPUS_TIMESTAMP = datetime(2026, 6, 22, 12, 0, tzinfo=UTC)


def _persist_compiled_rule_set(
    session: Session,
    case: ExpenseGoldenCorpusCase,
    *,
    compiled_rule_set_id: str,
) -> None:
    compiled_rule_set = compile_policy_version_snapshot(
        case.snapshot,
        compiled_rule_set_id=compiled_rule_set_id,
        compiled_by="golden-corpus",
        compiled_at=_GOLDEN_CORPUS_TIMESTAMP,
    )
    session.add(
        CompiledRuleSetRecord(
            compiled_rule_set_id=compiled_rule_set.compiled_rule_set_id,
            policy_version_id=compiled_rule_set.policy_version_id,
            compiled_by=compiled_rule_set.compiled_by,
            payload=compiled_rule_set.model_dump(mode="json"),
            compiled_at=_GOLDEN_CORPUS_TIMESTAMP,
        )
    )
    session.flush()


@pytest.mark.anyio
async def test_admin_gets_fixture_compliance_evaluation_quality_report(
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
        response = await client.get(
            "/compliance-evaluation-quality-report/golden-corpus",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["compiled_rule_set_id"] == "golden-corpus-fixture"
    assert payload["outcome_accuracy"]["accuracy"] == 1.0
    assert len(payload["cases"]) == len(EXPENSE_GOLDEN_CORPUS_CASES) - len(
        COMPARISON_CORPUS_CASE_IDS
    )


@pytest.mark.anyio
async def test_admin_gets_production_compile_quality_report(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth_with_admin(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    corpus_case = next(
        case
        for case in EXPENSE_GOLDEN_CORPUS_CASES
        if case.case_id == "meal-cap-pass-violation"
    )
    with Session(engine) as session:
        _persist_compiled_rule_set(
            session,
            corpus_case,
            compiled_rule_set_id="compiled-meal-cap-pass-violation",
        )
        session.commit()
    engine.dispose()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.get(
            (
                "/policy-versions/policy-meal-cap-pass-violation/compiled-rule-sets/"
                "compiled-meal-cap-pass-violation/compliance-evaluation-quality-report"
            ),
            headers={"Authorization": "Bearer admin-token"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["compiled_rule_set_id"] == "compiled-meal-cap-pass-violation"
    assert payload["cases"][0]["case_id"] == "meal-cap-pass-violation"
    assert payload["outcome_accuracy"]["accuracy"] == 1.0


@pytest.mark.anyio
async def test_admin_compares_compiled_rule_set_quality_reports(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    _configure_local_auth_with_admin(monkeypatch, database_url)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    baseline_case = next(
        case
        for case in EXPENSE_GOLDEN_CORPUS_CASES
        if case.case_id == "meal-cap-comparison-baseline"
    )
    candidate_case = next(
        case
        for case in EXPENSE_GOLDEN_CORPUS_CASES
        if case.case_id == "meal-cap-comparison-candidate"
    )
    with Session(engine) as session:
        _persist_compiled_rule_set(
            session,
            baseline_case,
            compiled_rule_set_id="compiled-baseline",
        )
        _persist_compiled_rule_set(
            session,
            candidate_case,
            compiled_rule_set_id="compiled-candidate",
        )
        session.commit()
    engine.dispose()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.get(
            "/compliance-evaluation-quality-report/compare",
            headers={"Authorization": "Bearer admin-token"},
            params={
                "baseline_compiled_rule_set_id": "compiled-baseline",
                "candidate_compiled_rule_set_id": "compiled-candidate",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["baseline_compiled_rule_set_id"] == "compiled-baseline"
    assert payload["candidate_compiled_rule_set_id"] == "compiled-candidate"
    assert payload["baseline"]["violation_detection"]["true_positive"] == 1
    assert payload["candidate"]["violation_detection"]["true_positive"] == 0


@pytest.mark.anyio
async def test_admin_downloads_fixture_quality_report_json(
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
        response = await client.get(
            "/compliance-evaluation-quality-report/golden-corpus/report",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert response.status_code == 200
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="compliance-evaluation-quality-report.json"'
    )
    assert response.json()["outcome_accuracy"]["accuracy"] == 1.0
