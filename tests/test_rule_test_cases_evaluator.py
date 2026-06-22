from datetime import UTC, datetime

from policy_pipeline.compiled_rule_sets.compiler import compile_policy_version_snapshot
from policy_pipeline.expense_reports import ExpenseReportRow
from policy_pipeline.rule_test_cases.evaluator import evaluate_expense_for_rule
from policy_pipeline.rule_test_cases.generator import generate_rule_test_cases
from policy_pipeline.rule_test_cases.models import EvaluationOutcome
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
from tests.test_compiled_rule_sets_compiler import _build_enforceable_rule


def _build_exception_rule(*, rule_id: str = "rule-meal-cap-exception") -> Rule:
    return Rule(
        rule_id=rule_id,
        statement="Domestic meals are capped at $75 per day.",
        enforceability_class=EnforceabilityClass.ENFORCEABLE,
        lifecycle_state=LifecycleState.PUBLISHED,
        origin=RuleOrigin(
            source_type=RuleOriginType.MANUAL,
            rationale="Meal cap with exception.",
        ),
        scope=Scope(expense_category="meals", country="domestic"),
        condition=RuleCondition(
            field="meal.amount",
            operator="<=",
            value="75",
        ),
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


def _compiled_rule_for(rule: Rule):
    snapshot = PolicyVersionSnapshot(
        policy_version_id="policy-v1",
        change_summary="Evaluator fixture.",
        published_by="admin-user",
        rules=[rule],
    )
    compiled_rule_set = compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id="compiled-test",
        compiled_by="admin-user",
        compiled_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    entry = compiled_rule_set.entries[0]
    assert entry.compiled_rule is not None
    return entry.compiled_rule


def test_evaluator_matches_generated_positive_and_negative_cases() -> None:
    rule = _build_enforceable_rule(rule_id="rule-meal-cap-domestic")
    compiled_rule = _compiled_rule_for(rule)
    generated_at = datetime(2026, 6, 1, tzinfo=UTC)
    cases = generate_rule_test_cases(
        compile_policy_version_snapshot(
            PolicyVersionSnapshot(
                policy_version_id="policy-v1",
                change_summary="Meal cap.",
                published_by="admin-user",
                rules=[rule],
            ),
            compiled_rule_set_id="compiled-test",
            compiled_by="admin-user",
            compiled_at=generated_at,
        ),
        generated_by="admin-user",
        generated_at=generated_at,
    )

    for case in cases:
        actual = evaluate_expense_for_rule(compiled_rule, case.expense_fixture)
        assert actual == case.expected_outcome


def test_evaluator_matches_generated_exception_cases() -> None:
    rule = _build_exception_rule()
    compiled_rule = _compiled_rule_for(rule)
    generated_at = datetime(2026, 6, 1, tzinfo=UTC)
    cases = generate_rule_test_cases(
        compile_policy_version_snapshot(
            PolicyVersionSnapshot(
                policy_version_id="policy-v1",
                change_summary="Meal cap exception.",
                published_by="admin-user",
                rules=[rule],
            ),
            compiled_rule_set_id="compiled-test",
            compiled_by="admin-user",
            compiled_at=generated_at,
        ),
        generated_by="admin-user",
        generated_at=generated_at,
    )

    for case in cases:
        actual = evaluate_expense_for_rule(compiled_rule, case.expense_fixture)
        assert actual == case.expected_outcome


def test_evaluator_returns_pass_when_scope_does_not_match() -> None:
    compiled_rule = _compiled_rule_for(_build_enforceable_rule(rule_id="rule-meal-cap-domestic"))
    expense = ExpenseReportRow(
        employee_id="test-employee-001",
        expense_date=datetime(2026, 6, 1).date(),
        expense_category="lodging",
        amount="500",
        currency="USD",
        country="domestic",
    )
    assert evaluate_expense_for_rule(compiled_rule, expense) == EvaluationOutcome.PASS
