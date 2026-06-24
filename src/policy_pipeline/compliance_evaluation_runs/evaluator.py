from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from policy_pipeline.compiled_rule_sets.models import CompiledExecutableRule
from policy_pipeline.compliance_evaluation_runs.models import (
    ComplianceOutcome,
    CurrencyMatchContext,
    CurrencyMatchStatus,
    EffectiveDatePosition,
    EffectiveDateScopeContext,
    ScopeMatchContext,
)
from policy_pipeline.expense_reports import ExpenseReportRow
from policy_pipeline.rule_test_cases.evaluator import UnsupportedRuleEvaluationError
from policy_pipeline.rule_test_cases.generator import (
    ConditionValueKind,
    UnsupportedConditionFieldError,
    UnsupportedConditionOperatorError,
    _parse_boolean,
    _parse_numeric,
    _resolve_condition_target,
    _resolve_exception_evidence_fields,
)
from policy_pipeline.rules.models import AggregationPeriod, Citation, EnforceabilityClass, Rule

EMPLOYEE_GROUP_SCOPE_V1_SKIP_REASON = (
    "Rule scope includes employee_group, which Expense Report rows do not carry in v1."
)
CURRENCY_MISMATCH_V1_REVIEW_SUFFIX = (
    "Automated currency conversion is not supported in v1."
)
V1_UNAVAILABLE_SCOPE_DIMENSIONS = (
    "employee_group",
    "department",
    "role",
    "seniority",
    "state",
    "city",
    "region",
)
V1_RESOLVABLE_SCOPE_DIMENSIONS = (
    "expense_category",
    "country",
    "travel_type",
    "effective_start_date",
    "effective_end_date",
)


@dataclass(frozen=True)
class ComplianceEvaluationResult:
    outcome: ComplianceOutcome
    missing_evidence_fields: tuple[str, ...] = ()


def non_enforceable_rule_scope_matches_v1(
    rule: Rule,
    expense: ExpenseReportRow,
) -> bool:
    return _partial_scope_matches_v1_resolvable_dimensions(
        rule.scope.model_dump(mode="json"),
        expense,
    )


def build_needs_review_reason(rule: Rule) -> str:
    unavailable_dimensions = unavailable_v1_scope_dimensions(
        rule.scope.model_dump(mode="json")
    )
    if (
        unavailable_dimensions
        and rule.enforceability_class is EnforceabilityClass.ENFORCEABLE
    ):
        skip_reason = build_unavailable_scope_skip_reason(unavailable_dimensions)
        return f"{rule.statement} {skip_reason}"
    if rule.enforceability_class is EnforceabilityClass.GUIDANCE:
        rationale = "Automated enforcement does not apply to guidance rules."
    else:
        rationale = "Automated enforcement does not apply to subjective rules."
    return f"{rule.statement} {rationale}"


def build_review_evidence(rule: Rule) -> list[Citation]:
    if rule.citation is None:
        return []
    return [rule.citation]


def unavailable_v1_scope_dimensions(scope: dict[str, Any]) -> tuple[str, ...]:
    return tuple(
        dimension
        for dimension in V1_UNAVAILABLE_SCOPE_DIMENSIONS
        if scope.get(dimension) is not None
    )


def build_scope_match_context(
    scope: dict[str, Any],
    expense: ExpenseReportRow,
) -> ScopeMatchContext | None:
    matched: dict[str, str] = {}
    for dimension in V1_RESOLVABLE_SCOPE_DIMENSIONS:
        rule_value = scope.get(dimension)
        if rule_value is None:
            continue
        if dimension == "expense_category":
            matched[dimension] = expense.expense_category
        elif dimension == "country":
            matched[dimension] = expense.country or str(rule_value)
        elif dimension == "travel_type":
            matched[dimension] = expense.travel_type or str(rule_value)
        elif dimension in {"effective_start_date", "effective_end_date"}:
            matched[dimension] = str(rule_value)
        else:
            matched[dimension] = str(rule_value)

    if scope.get("effective_start_date") or scope.get("effective_end_date"):
        matched["expense_date"] = expense.expense_date.isoformat()

    unavailable = {
        dimension: str(scope[dimension])
        for dimension in V1_UNAVAILABLE_SCOPE_DIMENSIONS
        if scope.get(dimension) is not None
    }

    if not matched and not unavailable:
        return None

    return ScopeMatchContext(
        matched_dimensions=matched,
        unavailable_dimensions=unavailable,
    )


def requires_currency_match(compiled_rule: CompiledExecutableRule) -> bool:
    applicability = compiled_rule.applicability
    if applicability.get("unit") == "money":
        return True
    field = compiled_rule.condition.get("field", "")
    return field.endswith(".amount") or field == "amount"


def resolve_rule_currency(compiled_rule: CompiledExecutableRule) -> str | None:
    currency = compiled_rule.applicability.get("currency")
    if currency is None:
        return None
    normalized = str(currency).strip().upper()
    return normalized or None


def normalize_expense_currency(expense: ExpenseReportRow) -> str:
    return expense.currency.strip().upper()


def build_currency_match_context(
    compiled_rule: CompiledExecutableRule,
    expense: ExpenseReportRow,
) -> CurrencyMatchContext | None:
    return build_currency_match_context_for_fields(
        applicability=compiled_rule.applicability,
        condition=compiled_rule.condition,
        expense=expense,
    )


def build_currency_match_context_for_fields(
    *,
    applicability: dict[str, Any],
    condition: dict[str, str] | None,
    expense: ExpenseReportRow,
) -> CurrencyMatchContext | None:
    if condition is None:
        return None
    if applicability.get("unit") != "money":
        field = condition.get("field", "")
        if not (field.endswith(".amount") or field == "amount"):
            return None

    rule_currency_raw = applicability.get("currency")
    expense_currency = normalize_expense_currency(expense)
    if rule_currency_raw is None:
        return CurrencyMatchContext(
            rule_currency=None,
            expense_currency=expense_currency,
            status=CurrencyMatchStatus.NOT_APPLICABLE,
            conversion_supported=False,
        )

    rule_currency = str(rule_currency_raw).strip().upper()
    if rule_currency == expense_currency:
        return CurrencyMatchContext(
            rule_currency=rule_currency,
            expense_currency=expense_currency,
            status=CurrencyMatchStatus.MATCH,
            conversion_supported=False,
        )
    return CurrencyMatchContext(
        rule_currency=rule_currency,
        expense_currency=expense_currency,
        status=CurrencyMatchStatus.MISMATCH,
        conversion_supported=False,
    )


def build_effective_date_scope_context(
    scope: dict[str, Any],
    expense: ExpenseReportRow,
) -> EffectiveDateScopeContext | None:
    effective_start = scope.get("effective_start_date")
    effective_end = scope.get("effective_end_date")
    if effective_start is None and effective_end is None:
        return None

    start_date = (
        date.fromisoformat(str(effective_start)) if effective_start is not None else None
    )
    end_date = (
        date.fromisoformat(str(effective_end)) if effective_end is not None else None
    )
    if start_date is not None and expense.expense_date < start_date:
        position = EffectiveDatePosition.BEFORE
    elif end_date is not None and expense.expense_date > end_date:
        position = EffectiveDatePosition.AFTER
    else:
        position = EffectiveDatePosition.WITHIN

    return EffectiveDateScopeContext(
        effective_start_date=str(effective_start) if effective_start is not None else None,
        effective_end_date=str(effective_end) if effective_end is not None else None,
        expense_date=expense.expense_date.isoformat(),
        position=position,
    )


def build_currency_mismatch_review_reason(
    compiled_rule: CompiledExecutableRule,
    expense: ExpenseReportRow,
) -> str | None:
    currency_context = build_currency_match_context(compiled_rule, expense)
    if currency_context is None:
        return None
    if currency_context.status is not CurrencyMatchStatus.MISMATCH:
        return None
    assert currency_context.rule_currency is not None
    return (
        f"{compiled_rule.statement} Rule limit is denominated in "
        f"{currency_context.rule_currency} but expense is recorded in "
        f"{currency_context.expense_currency}. {CURRENCY_MISMATCH_V1_REVIEW_SUFFIX}"
    )


def currency_mismatch_blocks_evaluation(
    compiled_rule: CompiledExecutableRule,
    expense: ExpenseReportRow,
) -> bool:
    currency_context = build_currency_match_context(compiled_rule, expense)
    return (
        currency_context is not None
        and currency_context.status is CurrencyMatchStatus.MISMATCH
    )


def build_unavailable_scope_skip_reason(unavailable_dimensions: tuple[str, ...]) -> str:
    if unavailable_dimensions == ("employee_group",):
        return EMPLOYEE_GROUP_SCOPE_V1_SKIP_REASON
    if len(unavailable_dimensions) == 1:
        dimension = unavailable_dimensions[0]
        return (
            f"Rule scope includes {dimension}, which is deferred to future "
            "HR or jurisdiction lookup services in v1."
        )
    return (
        "Rule scope includes unavailable v1 dimensions "
        f"({', '.join(unavailable_dimensions)}), which are deferred to future "
        "HR or jurisdiction lookup services."
    )


def evaluate_expense_row_for_compliance_v1(
    compiled_rule: CompiledExecutableRule,
    expense: ExpenseReportRow,
) -> ComplianceEvaluationResult:
    period = AggregationPeriod(compiled_rule.applicability["aggregation_period"])
    if period not in {
        AggregationPeriod.PER_TRANSACTION,
        AggregationPeriod.PER_ATTENDEE,
    }:
        return ComplianceEvaluationResult(ComplianceOutcome.PASS)

    if not _scope_matches_v1_scope(compiled_rule.scope, expense):
        return ComplianceEvaluationResult(ComplianceOutcome.PASS)

    if currency_mismatch_blocks_evaluation(compiled_rule, expense):
        return ComplianceEvaluationResult(ComplianceOutcome.PASS)

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
            aggregation_period=period,
        )
    except UnsupportedConditionOperatorError as exc:
        raise UnsupportedRuleEvaluationError(
            f"{exc.field} with operator {exc.operator!r}",
        ) from exc
    except ValueError as exc:
        raise UnsupportedRuleEvaluationError(str(exc)) from exc

    if condition_satisfied:
        return ComplianceEvaluationResult(ComplianceOutcome.PASS)

    evidence_fields = _collect_exception_evidence_fields(compiled_rule)
    if not evidence_fields:
        return ComplianceEvaluationResult(ComplianceOutcome.VIOLATION)

    for exception in compiled_rule.exceptions:
        exception_fields = _resolve_exception_evidence_fields(exception)
        if not exception_fields:
            continue
        field_values = [
            _resolve_exception_evidence_value(expense, field)
            for field in exception_fields
        ]
        if all(value is True for value in field_values):
            return ComplianceEvaluationResult(ComplianceOutcome.PASS)
        missing_fields = tuple(
            field
            for field, value in zip(exception_fields, field_values, strict=True)
            if value is not True
        )
        if missing_fields:
            return ComplianceEvaluationResult(
                ComplianceOutcome.MISSING_EVIDENCE,
                missing_evidence_fields=missing_fields,
            )
    return ComplianceEvaluationResult(ComplianceOutcome.VIOLATION)


def uses_row_level_rule_evaluation(compiled_rule: CompiledExecutableRule) -> bool:
    period = AggregationPeriod(compiled_rule.applicability["aggregation_period"])
    return period in {AggregationPeriod.PER_TRANSACTION, AggregationPeriod.PER_ATTENDEE}


def resolve_violation_comparison(
    compiled_rule: CompiledExecutableRule,
    expense: ExpenseReportRow,
) -> tuple[str, str]:
    condition = compiled_rule.condition
    target = _resolve_condition_target(condition["field"])
    policy_limit = condition["value"]
    period = AggregationPeriod(compiled_rule.applicability["aggregation_period"])
    field_value = getattr(expense, target.fixture_field)
    if target.value_kind is ConditionValueKind.NUMERIC:
        if target.fixture_field == "submission_days":
            actual = Decimal(str(field_value if field_value is not None else 0))
        elif period is AggregationPeriod.PER_ATTENDEE:
            from policy_pipeline.compliance_evaluation_runs.aggregation import (
                per_attendee_amount,
            )

            actual = per_attendee_amount(expense, fixture_field=target.fixture_field)
        else:
            actual = _parse_numeric(str(field_value))
        return policy_limit, str(actual)
    if target.value_kind is ConditionValueKind.STRING:
        return policy_limit, str(field_value or "")
    actual = bool(field_value) if field_value is not None else False
    return policy_limit, "true" if actual else "false"


def build_violation_evidence(
    compiled_rule: CompiledExecutableRule,
) -> list[Citation]:
    if compiled_rule.citation is None:
        return []
    return [Citation.model_validate(compiled_rule.citation)]


def _partial_scope_matches_v1_resolvable_dimensions(
    scope: dict[str, Any],
    expense: ExpenseReportRow,
) -> bool:
    expense_category = scope.get("expense_category")
    if expense_category is not None and expense.expense_category != str(expense_category):
        return False

    country = scope.get("country")
    if country is not None and expense.country != country:
        return False

    travel_type = scope.get("travel_type")
    if travel_type is not None and expense.travel_type != travel_type:
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


def _scope_matches_v1_scope(
    scope: dict[str, Any],
    expense: ExpenseReportRow,
) -> bool:
    if unavailable_v1_scope_dimensions(scope):
        return False

    return _partial_scope_matches_v1_resolvable_dimensions(scope, expense)


def _evaluate_condition(
    expense: ExpenseReportRow,
    *,
    operator: str,
    limit: str,
    target,
    aggregation_period: AggregationPeriod = AggregationPeriod.PER_TRANSACTION,
) -> bool:
    field_value = getattr(expense, target.fixture_field)
    if target.value_kind is ConditionValueKind.NUMERIC:
        if target.fixture_field == "submission_days":
            actual = Decimal(str(field_value if field_value is not None else 0))
        elif aggregation_period is AggregationPeriod.PER_ATTENDEE:
            from policy_pipeline.compliance_evaluation_runs.aggregation import (
                per_attendee_amount,
            )

            actual = per_attendee_amount(expense, fixture_field=target.fixture_field)
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


def _resolve_exception_evidence_value(
    expense: ExpenseReportRow,
    field: str,
) -> bool | None:
    value = getattr(expense, field, None)
    if field in {"manager_approval", "receipt_attached"}:
        if value is True:
            return True
        if value is False:
            return False
        return None
    if field in {"business_purpose", "attendee_list"}:
        if value is None:
            return False
        normalized = str(value).strip()
        if normalized:
            return True
        return False
    return None
