from __future__ import annotations

import json

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from policy_pipeline.main import create_app
from policy_pipeline.rule_test_cases.models import EvaluationOutcome, RuleTestCaseVariant
from policy_pipeline.shared.database import Base, RuleTestCaseRecord
from tests.test_compiled_rule_sets_api import _configure_local_auth_with_admin


def build_meal_cap_rule_payload(*, rule_id: str = "rule-meal-cap-domestic") -> dict[str, object]:
    return {
        "rule_id": rule_id,
        "statement": "Domestic meals are capped at $75 per day.",
        "enforceability_class": "enforceable",
        "rationale": "Golden meal cap fixture for Rule Test Case generation.",
        "scope": {
            "expense_category": "meals",
            "country": "domestic",
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
        },
    }


def build_business_purpose_rule_payload(
    *,
    rule_id: str = "rule-business-purpose",
) -> dict[str, object]:
    return {
        "rule_id": rule_id,
        "statement": "Expenses must have a legitimate business purpose.",
        "enforceability_class": "enforceable",
        "rationale": "Business purpose enforcement.",
        "scope": {"expense_category": "meals"},
        "condition": {
            "field": "expense.business_purpose",
            "operator": "==",
            "value": "legitimate",
        },
        "applicability": {
            "aggregation_period": "per_transaction",
            "unit": "text",
        },
    }


def build_submission_days_rule_payload(
    *,
    rule_id: str = "rule-manual-timeliness-30-days",
) -> dict[str, object]:
    return {
        "rule_id": rule_id,
        "statement": "Expense reports should be submitted within 30 calendar days.",
        "enforceability_class": "enforceable",
        "rationale": "Timeliness enforcement.",
        "scope": {"expense_category": "meals"},
        "condition": {
            "field": "expense_report.submission_days",
            "operator": "<=",
            "value": "30",
        },
        "applicability": {
            "aggregation_period": "per_trip",
            "unit": "days",
        },
    }


def build_meal_cap_rule_with_exception_payload(
    *,
    rule_id: str = "rule-meal-cap-exception",
) -> dict[str, object]:
    return {
        **build_meal_cap_rule_payload(rule_id=rule_id),
        "exceptions": [
            {
                "description": "Client entertainment requires manager approval.",
                "required_evidence": ["manager_approval"],
            }
        ],
    }


async def _publish_policy_version(client: httpx.AsyncClient, policy_version_id: str) -> None:
    publish_response = await client.post(
        "/policy-versions",
        headers={"Authorization": "Bearer approver-token"},
        json={
            "policy_version_id": policy_version_id,
            "change_summary": "Published snapshot for Rule Test Case tests.",
        },
    )
    assert publish_response.status_code == 201


async def _compile_policy_version(client: httpx.AsyncClient, policy_version_id: str) -> dict:
    compile_response = await client.post(
        f"/policy-versions/{policy_version_id}/compiled-rule-sets",
        headers={"Authorization": "Bearer admin-token"},
    )
    assert compile_response.status_code == 201
    return compile_response.json()


@pytest.mark.anyio
async def test_admin_generates_rule_test_cases_for_meal_cap_rule(
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
            json=build_meal_cap_rule_payload(),
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        generate_response = await client.post(
            f"/compiled-rule-sets/{compiled['compiled_rule_set_id']}/rule-test-cases/generate",
            headers={"Authorization": "Bearer admin-token"},
        )
        list_response = await client.get(
            f"/compiled-rule-sets/{compiled['compiled_rule_set_id']}/rule-test-cases",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert create_response.status_code == 201
    assert generate_response.status_code == 201
    payload = generate_response.json()
    assert payload["created"] is True
    assert payload["generated_count"] == 3
    assert len(payload["groups"]) == 1

    group = payload["groups"][0]
    assert group["rule_id"] == "rule-meal-cap-domestic"
    assert group["positive_count"] == 1
    assert group["negative_count"] == 1
    assert group["boundary_count"] == 1
    assert group["exception_count"] == 0
    assert len(group["cases"]) == 3

    positive = next(
        case for case in group["cases"] if case["variant"] == RuleTestCaseVariant.POSITIVE.value
    )
    negative = next(
        case for case in group["cases"] if case["variant"] == RuleTestCaseVariant.NEGATIVE.value
    )
    boundary = next(
        case for case in group["cases"] if case["variant"] == RuleTestCaseVariant.BOUNDARY.value
    )
    assert positive["expected_outcome"] == EvaluationOutcome.PASS.value
    assert positive["expense_fixture"]["expense_category"] == "meals"
    assert positive["expense_fixture"]["amount"] == "74"
    assert negative["expected_outcome"] == EvaluationOutcome.VIOLATION.value
    assert negative["expense_fixture"]["amount"] == "76"
    assert boundary["expected_outcome"] == EvaluationOutcome.PASS.value
    assert boundary["expense_fixture"]["amount"] == "75"

    assert list_response.status_code == 200
    assert list_response.json()["total_count"] == 3


@pytest.mark.anyio
async def test_admin_generates_rule_test_cases_for_mixed_condition_fields(
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
            json=build_business_purpose_rule_payload(),
        )
        await client.post(
            "/rules/manual",
            headers={"Authorization": "Bearer approver-token"},
            json=build_submission_days_rule_payload(),
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        generate_response = await client.post(
            f"/compiled-rule-sets/{compiled['compiled_rule_set_id']}/rule-test-cases/generate",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert generate_response.status_code == 201
    payload = generate_response.json()
    assert payload["generated_count"] == 5
    assert len(payload["groups"]) == 2

    business_group = next(
        group for group in payload["groups"] if group["rule_id"] == "rule-business-purpose"
    )
    timeliness_group = next(
        group
        for group in payload["groups"]
        if group["rule_id"] == "rule-manual-timeliness-30-days"
    )

    business_positive = next(
        case
        for case in business_group["cases"]
        if case["variant"] == RuleTestCaseVariant.POSITIVE.value
    )
    timeliness_negative = next(
        case
        for case in timeliness_group["cases"]
        if case["variant"] == RuleTestCaseVariant.NEGATIVE.value
    )

    assert business_positive["expense_fixture"]["business_purpose"] == "legitimate"
    assert timeliness_negative["expense_fixture"]["submission_days"] == 31


@pytest.mark.anyio
async def test_duplicate_generation_returns_existing_rule_test_cases(
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
            json=build_meal_cap_rule_payload(),
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        first_generate = await client.post(
            f"/compiled-rule-sets/{compiled['compiled_rule_set_id']}/rule-test-cases/generate",
            headers={"Authorization": "Bearer admin-token"},
        )
        second_generate = await client.post(
            f"/compiled-rule-sets/{compiled['compiled_rule_set_id']}/rule-test-cases/generate",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert first_generate.status_code == 201
    assert second_generate.status_code == 200
    assert second_generate.json()["created"] is False
    assert (
        first_generate.json()["groups"][0]["cases"][0]["rule_test_case_id"]
        == second_generate.json()["groups"][0]["cases"][0]["rule_test_case_id"]
    )

    engine = create_engine(database_url)
    with Session(engine) as session:
        stored_cases = session.scalars(select(RuleTestCaseRecord)).all()
    engine.dispose()
    assert len(stored_cases) == 3


@pytest.mark.anyio
async def test_viewer_cannot_generate_but_can_list_rule_test_cases(
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
            json=build_meal_cap_rule_payload(),
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        admin_generate = await client.post(
            f"/compiled-rule-sets/{compiled['compiled_rule_set_id']}/rule-test-cases/generate",
            headers={"Authorization": "Bearer admin-token"},
        )
        viewer_generate = await client.post(
            f"/compiled-rule-sets/{compiled['compiled_rule_set_id']}/rule-test-cases/generate",
            headers={"Authorization": "Bearer viewer-token"},
        )
        viewer_list = await client.get(
            f"/compiled-rule-sets/{compiled['compiled_rule_set_id']}/rule-test-cases",
            headers={"Authorization": "Bearer viewer-token"},
        )

    assert admin_generate.status_code == 201
    assert viewer_generate.status_code == 403
    assert viewer_list.status_code == 200
    assert viewer_list.json()["total_count"] == 3


@pytest.mark.anyio
async def test_generate_rule_test_cases_without_enforceable_rules_returns_422(
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
            json={
                "rule_id": "rule-lodging-guidance",
                "statement": "Prefer negotiated hotel blocks when available.",
                "enforceability_class": "guidance",
                "rationale": "Guidance-only snapshot.",
                "scope": {"expense_category": "lodging"},
            },
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        generate_response = await client.post(
            f"/compiled-rule-sets/{compiled['compiled_rule_set_id']}/rule-test-cases/generate",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert generate_response.status_code == 422
    assert generate_response.json() == {
        "detail": "Compiled Rule Set has no enforceable Rules to generate test cases for.",
    }


@pytest.mark.anyio
async def test_generate_rule_test_cases_for_unknown_compiled_rule_set_returns_404(
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
        generate_response = await client.post(
            "/compiled-rule-sets/missing-set/rule-test-cases/generate",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert generate_response.status_code == 404
    assert generate_response.json() == {"detail": "Compiled Rule Set was not found."}


@pytest.mark.anyio
async def test_admin_generates_rule_test_cases_with_exception_variants(
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
            json=build_meal_cap_rule_with_exception_payload(),
        )
        await _publish_policy_version(client, "policy-v1")
        compiled = await _compile_policy_version(client, "policy-v1")
        generate_response = await client.post(
            f"/compiled-rule-sets/{compiled['compiled_rule_set_id']}/rule-test-cases/generate",
            headers={"Authorization": "Bearer admin-token"},
        )

    assert generate_response.status_code == 201
    group = generate_response.json()["groups"][0]
    assert group["exception_count"] == 2
    assert group["boundary_count"] == 1
    assert len(group["cases"]) == 5

    exception_cases = [
        case
        for case in group["cases"]
        if case["variant"] == RuleTestCaseVariant.EXCEPTION.value
    ]
    assert len(exception_cases) == 2
    assert any(
        case["expected_outcome"] == EvaluationOutcome.PASS.value
        and case["expense_fixture"]["manager_approval"] is True
        for case in exception_cases
    )
    assert any(
        case["expected_outcome"] == EvaluationOutcome.MISSING_EVIDENCE.value
        and case["expense_fixture"]["manager_approval"] is False
        for case in exception_cases
    )
