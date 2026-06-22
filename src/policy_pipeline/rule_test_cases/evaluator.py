from __future__ import annotations

from decimal import Decimal

from policy_pipeline.compiled_rule_sets.models import CompiledExecutableRule
from policy_pipeline.expense_reports import ExpenseReportRow
from policy_pipeline.rule_test_cases.generator import (
    ConditionValueKind,
    UnsupportedConditionFieldError,
    UnsupportedConditionOperatorError,
    _parse_boolean,
    _parse_numeric,
    _resolve_condition_target,
    _resolve_exception_evidence_fields,
)
from policy_pipeline.rule_test_cases.models import EvaluationOutcome


def evaluate_expense_for_rule(
    compiled_rule: CompiledExecutableRule,
    expense: ExpenseReportRow,
) -> EvaluationOutcome:
    if not _scope_matches(compiled_rule, expense):
        return EvaluationOutcome.PASS

    condition = compiled_rule.condition
    try:
        target = _resolve_condition_target(condition["field"])
    except UnsupportedConditionFieldError as exc:
        raise UnsupportedRuleEvaluationError(str(exc)) from exc

    try:
        condition_satisfied = _evaluate_condition(
            expense,
            operator=condition["operator"],
            limit=condition["value"],
            target=target,
        )
    except UnsupportedConditionOperatorError as exc:
        raise UnsupportedRuleEvaluationError(
            f"{exc.field} with operator {exc.operator!r}",
        ) from exc
    except ValueError as exc:
        raise UnsupportedRuleEvaluationError(str(exc)) from exc

    if condition_satisfied:
        return EvaluationOutcome.PASS

    evidence_fields = _collect_exception_evidence_fields(compiled_rule)
    if not evidence_fields:
        return EvaluationOutcome.VIOLATION

    for exception in compiled_rule.exceptions:
        exception_fields = _resolve_exception_evidence_fields(exception)
        if not exception_fields:
            continue
        field_values = [getattr(expense, field, None) for field in exception_fields]
        if all(value is True for value in field_values):
            return EvaluationOutcome.PASS
        if any(value is False for value in field_values):
            return EvaluationOutcome.MISSING_EVIDENCE
    return EvaluationOutcome.VIOLATION


def _scope_matches(
    compiled_rule: CompiledExecutableRule,
    expense: ExpenseReportRow,
) -> bool:
    scope = compiled_rule.scope
    if expense.expense_category != str(scope.get("expense_category", "")):
        return False
    country = scope.get("country")
    if country is not None and expense.country != country:
        return False
    travel_type = scope.get("travel_type")
    if travel_type is not None and expense.travel_type != travel_type:
        return False
    return True


def _evaluate_condition(
    expense: ExpenseReportRow,
    *,
    operator: str,
    limit: str,
    target,
) -> bool:
    field_value = getattr(expense, target.fixture_field)
    if target.value_kind is ConditionValueKind.NUMERIC:
        if target.fixture_field == "submission_days":
            actual = Decimal(str(field_value if field_value is not None else 0))
        else:
            actual = _parse_numeric(str(field_value))
        limit_value = _parse_numeric(limit)
        return _compare_numeric(actual, limit_value, operator)
    if target.value_kind is ConditionValueKind.STRING:
        actual = str(field_value or "")
        return _compare_string(actual, limit, operator)
    actual = bool(field_value) if field_value is not None else False
    limit_value = _parse_boolean(limit)
    return _compare_boolean(actual, limit_value, operator)


def _compare_numeric(actual: Decimal, limit: Decimal, operator: str) -> bool:
    if operator == "<=":
        return actual <= limit
    if operator == "<":
        return actual < limit
    if operator == ">=":
        return actual >= limit
    if operator == ">":
        return actual > limit
    if operator == "==":
        return actual == limit
    if operator == "!=":
        return actual != limit
    raise UnsupportedConditionOperatorError(field="amount", operator=operator)


def _compare_string(actual: str, limit: str, operator: str) -> bool:
    if operator == "==":
        return actual == limit
    if operator == "!=":
        return actual != limit
    raise UnsupportedConditionOperatorError(field="business_purpose", operator=operator)


def _compare_boolean(actual: bool, limit: bool, operator: str) -> bool:
    if operator == "==":
        return actual == limit
    if operator == "!=":
        return actual != limit
    raise UnsupportedConditionOperatorError(field="boolean", operator=operator)


def _collect_exception_evidence_fields(
    compiled_rule: CompiledExecutableRule,
) -> list[str]:
    fields: list[str] = []
    for exception in compiled_rule.exceptions:
        for field in _resolve_exception_evidence_fields(exception):
            if field not in fields:
                fields.append(field)
    return fields


class UnsupportedRuleEvaluationError(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail
        super().__init__(detail)
