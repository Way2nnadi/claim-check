from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from policy_pipeline.compiled_rule_sets.models import CompiledExecutableRule
from policy_pipeline.compliance_evaluation_runs.evaluator import (
    _collect_exception_evidence_fields,
    _compare_numeric,
    _resolve_exception_evidence_value,
    _scope_matches_v1_scope,
    currency_mismatch_blocks_evaluation,
)
from policy_pipeline.compliance_evaluation_runs.models import (
    AggregationWindowContext,
    AggregationWindowRowRef,
    ComplianceOutcome,
)
from policy_pipeline.expense_reports import ExpenseReportRow
from policy_pipeline.rule_test_cases.evaluator import UnsupportedRuleEvaluationError
from policy_pipeline.rule_test_cases.generator import (
    ConditionValueKind,
    UnsupportedConditionFieldError,
    _parse_numeric,
    _resolve_condition_target,
    _resolve_exception_evidence_fields,
)
from policy_pipeline.rules.models import AggregationPeriod


@dataclass(frozen=True)
class AggregatedWindowEvaluation:
    rule_id: str
    row_indices: tuple[int, ...]
    outcome: ComplianceOutcome
    policy_limit: str
    actual_value: str
    missing_evidence_fields: tuple[str, ...] = ()
    aggregation_period: AggregationPeriod | None = None
    window_row_indices: tuple[int, ...] = ()
    trip_id: str | None = None
    grouping_note: str | None = None


def aggregation_period(compiled_rule: CompiledExecutableRule) -> AggregationPeriod:
    return AggregationPeriod(compiled_rule.applicability["aggregation_period"])


def uses_cross_row_aggregation(period: AggregationPeriod) -> bool:
    return period in {
        AggregationPeriod.PER_DAY,
        AggregationPeriod.PER_NIGHT,
        AggregationPeriod.PER_TRIP,
    }


def uses_per_attendee_adjustment(period: AggregationPeriod) -> bool:
    return period is AggregationPeriod.PER_ATTENDEE


def attendee_count(attendee_list: str | None) -> int:
    if attendee_list is None or not attendee_list.strip():
        return 1
    attendees = [name.strip() for name in attendee_list.split(";") if name.strip()]
    return max(len(attendees), 1)


def per_attendee_amount(row: ExpenseReportRow, *, fixture_field: str) -> Decimal:
    field_value = getattr(row, fixture_field)
    amount = _parse_numeric(str(field_value))
    return amount / Decimal(attendee_count(row.attendee_list))


def evaluate_cross_row_aggregations(
    compiled_rule: CompiledExecutableRule,
    expense_rows: Sequence[ExpenseReportRow],
) -> list[AggregatedWindowEvaluation]:
    period = aggregation_period(compiled_rule)
    if not uses_cross_row_aggregation(period):
        return []

    try:
        target = _resolve_condition_target(compiled_rule.condition["field"])
    except UnsupportedConditionFieldError as exc:
        raise UnsupportedRuleEvaluationError(str(exc)) from exc

    if target.value_kind is not ConditionValueKind.NUMERIC:
        return []

    windows: dict[tuple[Any, ...], list[tuple[int, ExpenseReportRow]]] = defaultdict(list)
    for row_index, row in enumerate(expense_rows):
        window_key = _window_key(compiled_rule, row, period)
        if window_key is None:
            continue
        windows[window_key].append((row_index, row))

    evaluations: list[AggregatedWindowEvaluation] = []
    for grouped_rows in windows.values():
        evaluations.extend(
            _evaluate_window(
                compiled_rule,
                grouped_rows,
                target=target,
                period=period,
            )
        )
    return evaluations


def _window_key(
    compiled_rule: CompiledExecutableRule,
    row: ExpenseReportRow,
    period: AggregationPeriod,
) -> tuple[Any, ...] | None:
    if not _scope_matches_v1_scope(compiled_rule.scope, row):
        return None
    if currency_mismatch_blocks_evaluation(compiled_rule, row):
        return None

    scope_part = _scope_dimensions_key(compiled_rule.scope)
    employee_id = row.employee_id

    if period is AggregationPeriod.PER_DAY:
        return (compiled_rule.rule_id, period.value, employee_id, row.expense_date, scope_part)

    if period is AggregationPeriod.PER_NIGHT:
        if row.trip_id:
            return (compiled_rule.rule_id, period.value, employee_id, row.trip_id, scope_part)
        return (compiled_rule.rule_id, period.value, employee_id, row.expense_date, scope_part)

    if period is AggregationPeriod.PER_TRIP:
        if row.trip_id:
            return (compiled_rule.rule_id, period.value, employee_id, row.trip_id, scope_part)
        return (
            compiled_rule.rule_id,
            period.value,
            employee_id,
            row.expense_date,
            scope_part,
            "no-trip",
        )

    return None


def _scope_dimensions_key(scope: dict[str, Any]) -> tuple[tuple[str, str], ...]:
    parts: list[tuple[str, str]] = []
    for field_name in ("expense_category", "country", "travel_type"):
        value = scope.get(field_name)
        if value is not None:
            parts.append((field_name, str(value)))
    return tuple(parts)


def _evaluate_window(
    compiled_rule: CompiledExecutableRule,
    grouped_rows: list[tuple[int, ExpenseReportRow]],
    *,
    target,
    period: AggregationPeriod,
) -> list[AggregatedWindowEvaluation]:
    if not grouped_rows:
        return []

    total = sum(
        _parse_numeric(str(getattr(row, target.fixture_field)))
        for _, row in grouped_rows
    )
    limit = compiled_rule.condition["value"]
    operator = compiled_rule.condition["operator"]
    limit_value = _parse_numeric(limit)
    condition_satisfied = _compare_numeric(total, limit_value, operator)

    window_row_indices = tuple(row_index for row_index, _ in grouped_rows)
    actual_value = str(total)
    _, sample_row = grouped_rows[0]
    trip_id = _trip_id_from_group(grouped_rows)
    grouping_note = _grouping_note(period, sample_row)

    if condition_satisfied:
        return []

    evidence_fields = _collect_exception_evidence_fields(compiled_rule)
    if not evidence_fields:
        return [
            AggregatedWindowEvaluation(
                rule_id=compiled_rule.rule_id,
                row_indices=window_row_indices,
                outcome=ComplianceOutcome.VIOLATION,
                policy_limit=limit,
                actual_value=actual_value,
                aggregation_period=period,
                window_row_indices=window_row_indices,
                trip_id=trip_id,
                grouping_note=grouping_note,
            )
        ]

    evaluations: list[AggregatedWindowEvaluation] = []
    for row_index, row in grouped_rows:
        row_outcome = _exception_outcome_for_row(compiled_rule, row)
        if row_outcome is ComplianceOutcome.PASS:
            continue
        missing_fields = (
            _missing_exception_fields(compiled_rule, row)
            if row_outcome is ComplianceOutcome.MISSING_EVIDENCE
            else ()
        )
        evaluations.append(
            AggregatedWindowEvaluation(
                rule_id=compiled_rule.rule_id,
                row_indices=(row_index,),
                outcome=row_outcome,
                policy_limit=limit,
                actual_value=actual_value,
                missing_evidence_fields=missing_fields,
                aggregation_period=period,
                window_row_indices=window_row_indices,
                trip_id=trip_id,
                grouping_note=grouping_note,
            )
        )
    return evaluations


def _trip_id_from_group(
    grouped_rows: list[tuple[int, ExpenseReportRow]],
) -> str | None:
    for _, row in grouped_rows:
        if row.trip_id:
            return row.trip_id
    return None


def _grouping_note(
    period: AggregationPeriod,
    row: ExpenseReportRow,
) -> str | None:
    if period is AggregationPeriod.PER_NIGHT and not row.trip_id:
        return (
            "No trip ID on expense row; grouped lodging by employee "
            f"({row.employee_id}) and expense date ({row.expense_date})."
        )
    if period is AggregationPeriod.PER_TRIP and not row.trip_id:
        return (
            "No trip ID on expense row; grouped by employee "
            f"({row.employee_id}) and expense date ({row.expense_date})."
        )
    return None


def build_cross_row_aggregation_context(
    *,
    compiled_rule: CompiledExecutableRule,
    window_evaluation: AggregatedWindowEvaluation,
    expense_rows: Sequence[ExpenseReportRow],
) -> AggregationWindowContext:
    period = window_evaluation.aggregation_period
    assert period is not None

    target = _resolve_condition_target(compiled_rule.condition["field"])
    window_indices = (
        window_evaluation.window_row_indices or window_evaluation.row_indices
    )
    included_rows = [
        AggregationWindowRowRef(
            row_index=row_index,
            row_amount=str(getattr(expense_rows[row_index], target.fixture_field)),
        )
        for row_index in window_indices
    ]
    return AggregationWindowContext(
        aggregation_period=period,
        included_rows=included_rows,
        aggregate_value=window_evaluation.actual_value,
        policy_limit=window_evaluation.policy_limit,
        trip_id=window_evaluation.trip_id,
        grouping_note=window_evaluation.grouping_note,
    )


def build_per_attendee_aggregation_context(
    *,
    compiled_rule: CompiledExecutableRule,
    row: ExpenseReportRow,
    row_index: int,
    policy_limit: str,
    aggregate_value: str,
) -> AggregationWindowContext:
    target = _resolve_condition_target(compiled_rule.condition["field"])
    row_amount = str(getattr(row, target.fixture_field))
    return AggregationWindowContext(
        aggregation_period=AggregationPeriod.PER_ATTENDEE,
        included_rows=[
            AggregationWindowRowRef(row_index=row_index, row_amount=row_amount),
        ],
        aggregate_value=aggregate_value,
        policy_limit=policy_limit,
        attendee_count=attendee_count(row.attendee_list),
    )


def _exception_outcome_for_row(
    compiled_rule: CompiledExecutableRule,
    row: ExpenseReportRow,
) -> ComplianceOutcome:
    for exception in compiled_rule.exceptions:
        exception_fields = _resolve_exception_evidence_fields(exception)
        if not exception_fields:
            continue
        field_values = [
            _resolve_exception_evidence_value(row, field) for field in exception_fields
        ]
        if all(value is True for value in field_values):
            return ComplianceOutcome.PASS
        if any(value is not True for value in field_values):
            return ComplianceOutcome.MISSING_EVIDENCE
    return ComplianceOutcome.VIOLATION


def _missing_exception_fields(
    compiled_rule: CompiledExecutableRule,
    row: ExpenseReportRow,
) -> tuple[str, ...]:
    missing_fields: list[str] = []
    for exception in compiled_rule.exceptions:
        exception_fields = _resolve_exception_evidence_fields(exception)
        if not exception_fields:
            continue
        for field, value in zip(
            exception_fields,
            [
                _resolve_exception_evidence_value(row, field)
                for field in exception_fields
            ],
            strict=True,
        ):
            if value is not True and field not in missing_fields:
                missing_fields.append(field)
    return tuple(missing_fields)
