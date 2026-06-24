from datetime import UTC, datetime

from policy_pipeline.compiled_rule_sets.compiler import compile_policy_version_snapshot
from policy_pipeline.compiled_rule_sets.models import CompileStatus
from policy_pipeline.rule_test_cases.generator import generate_rule_test_cases
from policy_pipeline.rule_test_cases.models import EvaluationOutcome, RuleTestCaseVariant
from policy_pipeline.rules.models import (
    Applicability,
    AggregationPeriod,
    EnforceabilityClass,
    LifecycleState,
    PolicyVersionSnapshot,
    Rule,
    RuleCondition,
    RuleException,
    RuleOrigin,
    RuleOriginType,
    Scope,
)
from tests.test_compiled_rule_sets_compiler import _build_enforceable_rule, _build_guidance_rule


def _build_business_purpose_rule(*, rule_id: str) -> Rule:
    return Rule(
        rule_id=rule_id,
        statement="Expenses must have a legitimate business purpose.",
        enforceability_class=EnforceabilityClass.ENFORCEABLE,
        lifecycle_state=LifecycleState.PUBLISHED,
        origin=RuleOrigin(
            source_type=RuleOriginType.MANUAL,
            rationale="Business purpose enforcement.",
        ),
        scope=Scope(expense_category="meals"),
        condition=RuleCondition(
            field="expense.business_purpose",
            operator="==",
            value="legitimate",
        ),
        applicability=Applicability(
            aggregation_period=AggregationPeriod.PER_TRANSACTION,
            unit="text",
        ),
    )


def _build_submission_days_rule(*, rule_id: str) -> Rule:
    return Rule(
        rule_id=rule_id,
        statement="Expense reports should be submitted within 30 calendar days.",
        enforceability_class=EnforceabilityClass.ENFORCEABLE,
        lifecycle_state=LifecycleState.PUBLISHED,
        origin=RuleOrigin(
            source_type=RuleOriginType.MANUAL,
            rationale="Timeliness enforcement.",
        ),
        scope=Scope(expense_category="meals"),
        condition=RuleCondition(
            field="expense_report.submission_days",
            operator="<=",
            value="30",
        ),
        applicability=Applicability(
            aggregation_period=AggregationPeriod.PER_TRIP,
            unit="days",
        ),
    )


def test_generate_rule_test_cases_emits_positive_and_negative_for_enforceable_rule() -> None:
    snapshot = PolicyVersionSnapshot(
        policy_version_id="policy-v1",
        change_summary="Meal cap golden fixture.",
        published_by="admin-user",
        rules=[
            _build_enforceable_rule(rule_id="rule-meal-cap-domestic"),
            _build_guidance_rule(rule_id="rule-lodging-guidance"),
        ],
    )
    compiled_rule_set = compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id="compiled-test",
        compiled_by="admin-user",
        compiled_at=datetime(2026, 6, 22, tzinfo=UTC),
    )

    cases = generate_rule_test_cases(
        compiled_rule_set,
        generated_by="admin-user",
        generated_at=datetime(2026, 6, 22, 12, 0, tzinfo=UTC),
    )

    assert len(cases) == 3
    positive = next(case for case in cases if case.variant is RuleTestCaseVariant.POSITIVE)
    negative = next(case for case in cases if case.variant is RuleTestCaseVariant.NEGATIVE)
    boundary = next(case for case in cases if case.variant is RuleTestCaseVariant.BOUNDARY)

    assert positive.rule_id == "rule-meal-cap-domestic"
    assert positive.expected_outcome is EvaluationOutcome.PASS
    assert positive.expense_fixture.expense_category == "meals"
    assert positive.expense_fixture.amount == "74"
    assert positive.expense_fixture.currency == "USD"

    assert negative.rule_id == "rule-meal-cap-domestic"
    assert negative.expected_outcome is EvaluationOutcome.VIOLATION
    assert negative.expense_fixture.amount == "76"

    assert boundary.expected_outcome is EvaluationOutcome.PASS
    assert boundary.expense_fixture.amount == "75"


def test_generate_rule_test_cases_for_string_equality_condition() -> None:
    snapshot = PolicyVersionSnapshot(
        policy_version_id="policy-v1",
        change_summary="Business purpose snapshot.",
        published_by="admin-user",
        rules=[_build_business_purpose_rule(rule_id="rule-business-purpose")],
    )
    compiled_rule_set = compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id="compiled-test",
        compiled_by="admin-user",
        compiled_at=datetime(2026, 6, 22, tzinfo=UTC),
    )

    cases = generate_rule_test_cases(
        compiled_rule_set,
        generated_by="admin-user",
        generated_at=datetime(2026, 6, 22, 12, 0, tzinfo=UTC),
    )

    positive = next(case for case in cases if case.variant is RuleTestCaseVariant.POSITIVE)
    negative = next(case for case in cases if case.variant is RuleTestCaseVariant.NEGATIVE)

    assert positive.expense_fixture.business_purpose == "legitimate"
    assert positive.expected_outcome is EvaluationOutcome.PASS
    assert negative.expense_fixture.business_purpose == "invalid-for-test"
    assert negative.expected_outcome is EvaluationOutcome.VIOLATION


def test_generate_rule_test_cases_for_submission_days_condition() -> None:
    snapshot = PolicyVersionSnapshot(
        policy_version_id="policy-v1",
        change_summary="Timeliness snapshot.",
        published_by="admin-user",
        rules=[_build_submission_days_rule(rule_id="rule-timeliness-30-days")],
    )
    compiled_rule_set = compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id="compiled-test",
        compiled_by="admin-user",
        compiled_at=datetime(2026, 6, 22, tzinfo=UTC),
    )

    cases = generate_rule_test_cases(
        compiled_rule_set,
        generated_by="admin-user",
        generated_at=datetime(2026, 6, 22, 12, 0, tzinfo=UTC),
    )

    positive = next(case for case in cases if case.variant is RuleTestCaseVariant.POSITIVE)
    negative = next(case for case in cases if case.variant is RuleTestCaseVariant.NEGATIVE)
    boundary = next(case for case in cases if case.variant is RuleTestCaseVariant.BOUNDARY)

    assert positive.expense_fixture.submission_days == 29
    assert negative.expense_fixture.submission_days == 31
    assert boundary.expense_fixture.submission_days == 30
    assert boundary.expected_outcome is EvaluationOutcome.PASS


def _build_meal_cap_rule_with_exception(*, rule_id: str) -> Rule:
    return Rule(
        rule_id=rule_id,
        statement="Domestic meals are capped at $75 per day.",
        enforceability_class=EnforceabilityClass.ENFORCEABLE,
        lifecycle_state=LifecycleState.PUBLISHED,
        origin=RuleOrigin(
            source_type=RuleOriginType.MANUAL,
            rationale="Meal cap with manager approval exception.",
        ),
        scope=Scope(expense_category="meals"),
        condition=RuleCondition(field="meal.amount", operator="<=", value="75"),
        applicability=Applicability(
            aggregation_period=AggregationPeriod.PER_DAY,
            unit="money",
            currency="USD",
        ),
        exceptions=[
            RuleException(
                description="Client entertainment requires manager approval.",
                required_evidence=["manager_approval"],
            )
        ],
    )


def test_generate_rule_test_cases_emits_exception_variants_when_required_evidence_exists() -> None:
    snapshot = PolicyVersionSnapshot(
        policy_version_id="policy-v1",
        change_summary="Meal cap with exception.",
        published_by="admin-user",
        rules=[_build_meal_cap_rule_with_exception(rule_id="rule-meal-cap-exception")],
    )
    compiled_rule_set = compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id="compiled-test",
        compiled_by="admin-user",
        compiled_at=datetime(2026, 6, 22, tzinfo=UTC),
    )

    cases = generate_rule_test_cases(
        compiled_rule_set,
        generated_by="admin-user",
        generated_at=datetime(2026, 6, 22, 12, 0, tzinfo=UTC),
    )

    assert len(cases) == 5
    exception_cases = [
        case for case in cases if case.variant is RuleTestCaseVariant.EXCEPTION
    ]
    assert len(exception_cases) == 2
    assert all(case.expense_fixture.amount == "76" for case in exception_cases)

    evidence_present = next(
        case
        for case in exception_cases
        if case.expected_outcome is EvaluationOutcome.PASS
    )
    evidence_absent = next(
        case
        for case in exception_cases
        if case.expected_outcome is EvaluationOutcome.MISSING_EVIDENCE
    )
    assert evidence_present.expense_fixture.manager_approval is True
    assert evidence_absent.expense_fixture.manager_approval is False


def test_compile_rejects_unmapped_exception_evidence() -> None:
    rule = _build_meal_cap_rule_with_exception(rule_id="rule-meal-cap-unmapped")
    rule = rule.model_copy(
        update={
            "exceptions": [
                RuleException(
                    description="Director approval required.",
                    required_evidence=["director_approval"],
                )
            ]
        }
    )
    snapshot = PolicyVersionSnapshot(
        policy_version_id="policy-v1",
        change_summary="Unmapped exception evidence.",
        published_by="admin-user",
        rules=[rule],
    )
    compiled_rule_set = compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id="compiled-test",
        compiled_by="admin-user",
        compiled_at=datetime(2026, 6, 22, tzinfo=UTC),
    )

    assert compiled_rule_set.summary.compile_error == 1
    assert compiled_rule_set.entries[0].status is CompileStatus.COMPILE_ERROR
    assert "director_approval" in (compiled_rule_set.entries[0].error_reason or "")


def test_generate_rule_test_cases_skips_non_enforceable_rules() -> None:
    snapshot = PolicyVersionSnapshot(
        policy_version_id="policy-v1",
        change_summary="Guidance-only snapshot.",
        published_by="admin-user",
        rules=[_build_guidance_rule(rule_id="rule-lodging-guidance")],
    )
    compiled_rule_set = compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id="compiled-test",
        compiled_by="admin-user",
        compiled_at=datetime(2026, 6, 22, tzinfo=UTC),
    )

    cases = generate_rule_test_cases(
        compiled_rule_set,
        generated_by="admin-user",
        generated_at=datetime(2026, 6, 22, 12, 0, tzinfo=UTC),
    )

    assert cases == []
