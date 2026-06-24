from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from policy_pipeline.compiled_rule_sets.compiler import compile_policy_version_snapshot
from policy_pipeline.compliance_evaluation_runs.aggregation import (
    attendee_count,
    evaluate_cross_row_aggregations,
)
from policy_pipeline.compliance_evaluation_runs.evaluator import (
    evaluate_expense_row_for_compliance_v1,
    resolve_violation_comparison,
)
from policy_pipeline.compliance_evaluation_runs.models import (
    AggregationPeriod as OutcomeAggregationPeriod,
    ComplianceOutcome,
)
from policy_pipeline.compliance_evaluation_runs.runner import evaluate_compliance_for_expense_rows
from policy_pipeline.expense_reports import ExpenseReportRow
from policy_pipeline.rules.models import (
    AggregationPeriod,
    Applicability,
    Citation,
    EnforceabilityClass,
    LifecycleState,
    PolicyVersionSnapshot,
    Rule,
    RuleCondition,
    RuleOrigin,
    RuleOriginType,
    Scope,
)

_COMPILED_AT = datetime(2026, 6, 22, 12, 0, tzinfo=UTC)


def _citation(*, section_id: str, quote: str) -> Citation:
    return Citation(
        document_id="doc-expense-policy",
        document_version_id="docv-2026-06-01",
        section_id=section_id,
        quote=quote,
        start_char=0,
        end_char=len(quote),
    )


def _compile_rules(*, policy_version_id: str, rules: list[Rule]):
    snapshot = PolicyVersionSnapshot(
        policy_version_id=policy_version_id,
        change_summary="Aggregation test fixture.",
        published_by="tests",
        rules=rules,
    )
    return compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id=f"compiled-{policy_version_id}",
        compiled_by="tests",
        compiled_at=_COMPILED_AT,
    )


def _meal_row(
    *,
    amount: str,
    employee_id: str = "emp-001",
    expense_date: date = date(2026, 6, 21),
    trip_id: str | None = "trip-1",
    attendee_list: str | None = "Alice; Bob",
) -> ExpenseReportRow:
    return ExpenseReportRow(
        employee_id=employee_id,
        expense_date=expense_date,
        expense_category="meals",
        amount=amount,
        currency="USD",
        country="domestic",
        travel_type="domestic",
        business_purpose="Team dinner",
        attendee_list=attendee_list,
        manager_approval=None,
        receipt_attached=True,
        trip_id=trip_id,
    )


def _lodging_row(
    *,
    amount: str,
    employee_id: str = "emp-001",
    expense_date: date = date(2026, 6, 21),
    trip_id: str | None = "trip-lodging",
) -> ExpenseReportRow:
    return ExpenseReportRow(
        employee_id=employee_id,
        expense_date=expense_date,
        expense_category="lodging",
        amount=amount,
        currency="USD",
        country="domestic",
        travel_type="domestic",
        business_purpose="Conference hotel",
        attendee_list=None,
        manager_approval=None,
        receipt_attached=True,
        trip_id=trip_id,
    )


def _ground_transport_row(
    *,
    amount: str,
    employee_id: str = "emp-001",
    expense_date: date = date(2026, 6, 21),
    trip_id: str | None = "trip-ground",
) -> ExpenseReportRow:
    return ExpenseReportRow(
        employee_id=employee_id,
        expense_date=expense_date,
        expense_category="ground_transportation",
        amount=amount,
        currency="USD",
        country="domestic",
        travel_type="domestic",
        business_purpose="Airport taxi",
        attendee_list=None,
        manager_approval=None,
        receipt_attached=True,
        trip_id=trip_id,
    )


def _enforceable_rule(
    *,
    rule_id: str,
    expense_category: str,
    condition_field: str,
    cap: str,
    aggregation_period: AggregationPeriod,
) -> Rule:
    return Rule(
        rule_id=rule_id,
        statement=f"{expense_category} cap for aggregation tests.",
        enforceability_class=EnforceabilityClass.ENFORCEABLE,
        lifecycle_state=LifecycleState.PUBLISHED,
        origin=RuleOrigin(
            source_type=RuleOriginType.MANUAL,
            rationale="Aggregation evaluator test fixture.",
        ),
        scope=Scope(expense_category=expense_category),
        condition=RuleCondition(field=condition_field, operator="<=", value=cap),
        applicability=Applicability(
            aggregation_period=aggregation_period,
            unit="money",
            currency="USD",
        ),
        citation=_citation(section_id=f"{expense_category}#cap", quote="Cap for tests."),
    )


def test_attendee_count_defaults_to_one_when_attendee_list_missing() -> None:
    assert attendee_count(None) == 1
    assert attendee_count("") == 1
    assert attendee_count("Alice; Bob") == 2


def test_per_day_aggregates_same_employee_and_date() -> None:
    rule = _enforceable_rule(
        rule_id="rule-meal-day-cap",
        expense_category="meals",
        condition_field="meal.amount",
        cap="75",
        aggregation_period=AggregationPeriod.PER_DAY,
    )
    compiled = _compile_rules(policy_version_id="policy-per-day", rules=[rule])
    compiled_rule = compiled.entries[0].compiled_rule
    assert compiled_rule is not None

    rows = [
        _meal_row(amount="40.00", employee_id="emp-001"),
        _meal_row(amount="40.00", employee_id="emp-001"),
    ]
    evaluations = evaluate_cross_row_aggregations(compiled_rule, rows)

    assert len(evaluations) == 1
    assert evaluations[0].outcome is ComplianceOutcome.VIOLATION
    assert evaluations[0].actual_value == "80.00"
    assert evaluations[0].row_indices == (0, 1)


def test_per_day_does_not_aggregate_across_employees() -> None:
    rule = _enforceable_rule(
        rule_id="rule-meal-day-cap",
        expense_category="meals",
        condition_field="meal.amount",
        cap="75",
        aggregation_period=AggregationPeriod.PER_DAY,
    )
    compiled = _compile_rules(policy_version_id="policy-per-day", rules=[rule])
    compiled_rule = compiled.entries[0].compiled_rule
    assert compiled_rule is not None

    rows = [
        _meal_row(amount="40.00", employee_id="emp-001"),
        _meal_row(amount="40.00", employee_id="emp-002"),
    ]
    evaluations = evaluate_cross_row_aggregations(compiled_rule, rows)

    assert evaluations == []


def test_per_night_groups_lodging_by_trip_when_trip_id_present() -> None:
    rule = _enforceable_rule(
        rule_id="rule-lodging-night-cap",
        expense_category="lodging",
        condition_field="lodging.amount",
        cap="220",
        aggregation_period=AggregationPeriod.PER_NIGHT,
    )
    compiled = _compile_rules(policy_version_id="policy-per-night", rules=[rule])
    compiled_rule = compiled.entries[0].compiled_rule
    assert compiled_rule is not None

    rows = [
        _lodging_row(amount="120.00", trip_id="trip-a"),
        _lodging_row(amount="120.00", trip_id="trip-a"),
        _lodging_row(amount="120.00", trip_id="trip-b"),
    ]
    evaluations = evaluate_cross_row_aggregations(compiled_rule, rows)

    assert len(evaluations) == 1
    assert evaluations[0].actual_value == "240.00"
    assert evaluations[0].row_indices == (0, 1)


def test_per_night_falls_back_to_employee_and_date_without_trip_id() -> None:
    rule = _enforceable_rule(
        rule_id="rule-lodging-night-cap",
        expense_category="lodging",
        condition_field="lodging.amount",
        cap="220",
        aggregation_period=AggregationPeriod.PER_NIGHT,
    )
    compiled = _compile_rules(policy_version_id="policy-per-night", rules=[rule])
    compiled_rule = compiled.entries[0].compiled_rule
    assert compiled_rule is not None

    rows = [
        _lodging_row(amount="120.00", trip_id=None),
        _lodging_row(amount="120.00", trip_id=None),
    ]
    evaluations = evaluate_cross_row_aggregations(compiled_rule, rows)

    assert len(evaluations) == 1
    assert evaluations[0].actual_value == "240.00"
    assert evaluations[0].row_indices == (0, 1)


def test_per_trip_groups_by_trip_id_and_falls_back_without_it() -> None:
    rule = _enforceable_rule(
        rule_id="rule-ground-trip-cap",
        expense_category="ground_transportation",
        condition_field="ground_transportation.amount",
        cap="60",
        aggregation_period=AggregationPeriod.PER_TRIP,
    )
    compiled = _compile_rules(policy_version_id="policy-per-trip", rules=[rule])
    compiled_rule = compiled.entries[0].compiled_rule
    assert compiled_rule is not None

    rows = [
        _ground_transport_row(amount="30.00", trip_id="trip-shared"),
        _ground_transport_row(amount="35.00", trip_id="trip-shared"),
        _ground_transport_row(amount="30.00", trip_id=None, employee_id="emp-001"),
        _ground_transport_row(amount="35.00", trip_id=None, employee_id="emp-001"),
    ]
    evaluations = evaluate_cross_row_aggregations(compiled_rule, rows)

    assert len(evaluations) == 2
    assert {evaluation.actual_value for evaluation in evaluations} == {"65.00"}
    assert {evaluation.row_indices for evaluation in evaluations} == {(0, 1), (2, 3)}


def test_per_attendee_divides_amount_before_comparing_limit() -> None:
    rule = _enforceable_rule(
        rule_id="rule-meal-attendee-cap",
        expense_category="meals",
        condition_field="meal.amount",
        cap="40",
        aggregation_period=AggregationPeriod.PER_ATTENDEE,
    )
    compiled = _compile_rules(policy_version_id="policy-per-attendee", rules=[rule])
    compiled_rule = compiled.entries[0].compiled_rule
    assert compiled_rule is not None

    passing_row = _meal_row(amount="80.00", attendee_list="Alice; Bob")
    failing_row = _meal_row(amount="90.00", attendee_list="Alice; Bob")

    assert (
        evaluate_expense_row_for_compliance_v1(compiled_rule, passing_row).outcome
        is ComplianceOutcome.PASS
    )
    failing = evaluate_expense_row_for_compliance_v1(compiled_rule, failing_row)
    assert failing.outcome is ComplianceOutcome.VIOLATION
    policy_limit, actual_value = resolve_violation_comparison(compiled_rule, failing_row)
    assert policy_limit == "40"
    assert actual_value == "45.00"


@pytest.mark.parametrize(
    ("aggregation_period", "rows", "expected_violation_indices"),
    [
        (
            AggregationPeriod.PER_DAY,
            [
                _meal_row(amount="40.00"),
                _meal_row(amount="40.00"),
            ],
            [0, 1],
        ),
        (
            AggregationPeriod.PER_NIGHT,
            [
                _lodging_row(amount="120.00", trip_id=None),
                _lodging_row(amount="120.00", trip_id=None),
            ],
            [0, 1],
        ),
        (
            AggregationPeriod.PER_TRIP,
            [
                _ground_transport_row(amount="30.00", trip_id="trip-shared"),
                _ground_transport_row(amount="35.00", trip_id="trip-shared"),
            ],
            [0, 1],
        ),
    ],
)
def test_runner_emits_violation_on_each_row_in_aggregated_window(
    aggregation_period: AggregationPeriod,
    rows: list[ExpenseReportRow],
    expected_violation_indices: list[int],
) -> None:
    category = rows[0].expense_category
    condition_field = {
        "meals": "meal.amount",
        "lodging": "lodging.amount",
        "ground_transportation": "ground_transportation.amount",
    }[category]
    rule = _enforceable_rule(
        rule_id=f"rule-{aggregation_period.value}",
        expense_category=category,
        condition_field=condition_field,
        cap="75" if category == "meals" else ("220" if category == "lodging" else "60"),
        aggregation_period=aggregation_period,
    )
    compiled = _compile_rules(
        policy_version_id=f"policy-{aggregation_period.value}",
        rules=[rule],
    )
    outcomes = evaluate_compliance_for_expense_rows(compiled, rows)

    for index in expected_violation_indices:
        assert outcomes[index].outcome is ComplianceOutcome.VIOLATION
        assert outcomes[index].policy_limit is not None
        assert outcomes[index].actual_value is not None
        assert outcomes[index].reason == rule.statement
        assert outcomes[index].aggregation_context is not None
        context = outcomes[index].aggregation_context
        assert context is not None
        assert context.aggregation_period.value == aggregation_period.value
        assert context.aggregate_value == outcomes[index].actual_value
        assert context.policy_limit == outcomes[index].policy_limit
        assert len(context.included_rows) == len(expected_violation_indices)
        assert {row.row_index for row in context.included_rows} == set(
            expected_violation_indices
        )


def test_per_day_does_not_aggregate_across_mixed_categories() -> None:
    rule = _enforceable_rule(
        rule_id="rule-meal-day-cap",
        expense_category="meals",
        condition_field="meal.amount",
        cap="75",
        aggregation_period=AggregationPeriod.PER_DAY,
    )
    compiled = _compile_rules(policy_version_id="policy-per-day-mixed", rules=[rule])
    compiled_rule = compiled.entries[0].compiled_rule
    assert compiled_rule is not None

    rows = [
        _meal_row(amount="40.00", employee_id="emp-001"),
        ExpenseReportRow(
            employee_id="emp-001",
            expense_date=date(2026, 6, 21),
            expense_category="lodging",
            amount="40.00",
            currency="USD",
            country="domestic",
            travel_type="domestic",
            business_purpose="Hotel",
            attendee_list=None,
            manager_approval=None,
            receipt_attached=True,
            trip_id="trip-1",
        ),
    ]
    evaluations = evaluate_cross_row_aggregations(compiled_rule, rows)

    assert evaluations == []


def test_per_night_fallback_grouping_note_is_explicit() -> None:
    rule = _enforceable_rule(
        rule_id="rule-lodging-night-cap",
        expense_category="lodging",
        condition_field="lodging.amount",
        cap="220",
        aggregation_period=AggregationPeriod.PER_NIGHT,
    )
    compiled = _compile_rules(policy_version_id="policy-per-night-note", rules=[rule])
    compiled_rule = compiled.entries[0].compiled_rule
    assert compiled_rule is not None

    rows = [
        _lodging_row(amount="120.00", trip_id=None),
        _lodging_row(amount="120.00", trip_id=None),
    ]
    evaluations = evaluate_cross_row_aggregations(compiled_rule, rows)

    assert len(evaluations) == 1
    assert evaluations[0].grouping_note is not None
    assert "No trip ID" in evaluations[0].grouping_note


def test_per_trip_fallback_grouping_note_is_explicit() -> None:
    rule = _enforceable_rule(
        rule_id="rule-ground-trip-cap",
        expense_category="ground_transportation",
        condition_field="ground_transportation.amount",
        cap="60",
        aggregation_period=AggregationPeriod.PER_TRIP,
    )
    compiled = _compile_rules(policy_version_id="policy-per-trip-note", rules=[rule])
    compiled_rule = compiled.entries[0].compiled_rule
    assert compiled_rule is not None

    rows = [
        _ground_transport_row(amount="30.00", trip_id=None),
        _ground_transport_row(amount="35.00", trip_id=None),
    ]
    evaluations = evaluate_cross_row_aggregations(compiled_rule, rows)

    assert len(evaluations) == 1
    assert evaluations[0].grouping_note is not None
    assert "No trip ID" in evaluations[0].grouping_note


def test_runner_exposes_per_attendee_aggregation_context() -> None:
    rule = _enforceable_rule(
        rule_id="rule-meal-attendee-cap",
        expense_category="meals",
        condition_field="meal.amount",
        cap="40",
        aggregation_period=AggregationPeriod.PER_ATTENDEE,
    )
    compiled = _compile_rules(policy_version_id="policy-per-attendee-context", rules=[rule])
    failing_row = _meal_row(amount="90.00", attendee_list="Alice; Bob")
    outcomes = evaluate_compliance_for_expense_rows(compiled, [failing_row])

    assert outcomes[0].outcome is ComplianceOutcome.VIOLATION
    context = outcomes[0].aggregation_context
    assert context is not None
    assert context.aggregation_period is OutcomeAggregationPeriod.PER_ATTENDEE
    assert context.attendee_count == 2
    assert context.included_rows[0].row_index == 0
    assert context.included_rows[0].row_amount == "90.00"
    assert context.aggregate_value == "45.00"
    assert context.policy_limit == "40"


def test_runner_exposes_cross_row_aggregation_context_with_row_amounts() -> None:
    rule = _enforceable_rule(
        rule_id="rule-meal-day-cap",
        expense_category="meals",
        condition_field="meal.amount",
        cap="75",
        aggregation_period=AggregationPeriod.PER_DAY,
    )
    compiled = _compile_rules(policy_version_id="policy-per-day-context", rules=[rule])
    rows = [
        _meal_row(amount="40.00"),
        _meal_row(amount="40.00"),
    ]
    outcomes = evaluate_compliance_for_expense_rows(compiled, rows)

    for outcome in outcomes:
        assert outcome.outcome is ComplianceOutcome.VIOLATION
        context = outcome.aggregation_context
        assert context is not None
        assert context.aggregation_period is OutcomeAggregationPeriod.PER_DAY
        assert context.aggregate_value == "80.00"
        assert {row.row_index for row in context.included_rows} == {0, 1}
        assert {row.row_amount for row in context.included_rows} == {"40.00"}
        assert context.grouping_note is None
