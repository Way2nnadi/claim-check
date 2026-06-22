from __future__ import annotations

from datetime import date
from decimal import Decimal

from policy_pipeline.compiled_rule_sets.models import CompiledExecutableRule
from policy_pipeline.compliance_evaluation_runs.models import ComplianceOutcome
from policy_pipeline.expense_reports import ExpenseReportRow
from policy_pipeline.rule_test_cases.evaluator import UnsupportedRuleEvaluationError
from policy_pipeline.rule_test_cases.generator import (
    ConditionValueKind,
    UnsupportedConditionFieldError,
    UnsupportedConditionOperatorError,
    _parse_boolean,
    _parse_numeric,
    _resolve_condition_target,
)


def evaluate_expense_row_for_compliance_v1(
    compiled_rule: CompiledExecutableRule,
    expense: ExpenseReportRow,
) -> ComplianceOutcome:
    if not _scope_matches_v1(compiled_rule, expense):
        return ComplianceOutcome.PASS

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
        return ComplianceOutcome.PASS
    return ComplianceOutcome.VIOLATION


def _scope_matches_v1(
    compiled_rule: CompiledExecutableRule,
    expense: ExpenseReportRow,
) -> bool:
    scope = compiled_rule.scope
    expense_category = scope.get("expense_category")
    if expense_category is not None and expense.expense_category != str(expense_category):
        return False

    country = scope.get("country")
    if country is not None and expense.country != country:
        return False

    travel_type = scope.get("travel_type")
    if travel_type is not None and expense.travel_type != travel_type:
        return False

    employee_group = scope.get("employee_group")
    if employee_group is not None:
        return False

    effective_start = scope.get("effective_start_date")
    if effective_start is not None and expense.expense_date < date.fromisoformat(
        str(effective_start)
    ):
        return False

    effective_end = scope.get("effective_end_date")
    if effective_end is not None and expense.expense_date > date.fromisoformat(
        str(effective_end)
    ):
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
