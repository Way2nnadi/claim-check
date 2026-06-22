from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from uuid import uuid4

from policy_pipeline.compiled_rule_sets.models import CompiledExecutableRule, CompiledRuleSet
from policy_pipeline.expense_reports import ExpenseReportRow
from policy_pipeline.rule_test_cases.models import (
    EvaluationOutcome,
    RuleTestCase,
    RuleTestCaseVariant,
)

_SYNTHETIC_EMPLOYEE_ID = "test-employee-001"
_SYNTHETIC_EXPENSE_DATE = date(2026, 6, 1)
_DEFAULT_AMOUNT = "100"
_STRING_MISMATCH_VALUE = "invalid-for-test"
_TRUE_VALUES = frozenset({"true", "yes", "1"})
_FALSE_VALUES = frozenset({"false", "no", "0"})

_FIELD_ALIASES: dict[str, str] = {
    "meal.amount": "amount",
    "lodging.amount": "amount",
    "ground_transportation.amount": "amount",
    "ground_transport.amount": "amount",
    "expense.business_purpose": "business_purpose",
    "business_purpose": "business_purpose",
    "expense_report.submission_days": "submission_days",
    "submission_days": "submission_days",
    "manager_approval": "manager_approval",
    "receipt_attached": "receipt_attached",
}

_EVIDENCE_FIELDS = frozenset({"manager_approval", "receipt_attached"})


class ConditionValueKind(StrEnum):
    NUMERIC = "numeric"
    STRING = "string"
    BOOLEAN = "boolean"


@dataclass(frozen=True)
class ConditionTarget:
    fixture_field: str
    value_kind: ConditionValueKind


class UnsupportedConditionFieldError(Exception):
    def __init__(self, field: str) -> None:
        self.field = field
        super().__init__(field)


class UnsupportedConditionOperatorError(Exception):
    def __init__(self, *, field: str, operator: str) -> None:
        self.field = field
        self.operator = operator
        super().__init__(f"{field} with operator {operator!r}")


def generate_rule_test_cases(
    compiled_rule_set: CompiledRuleSet,
    *,
    generated_by: str,
    generated_at,
) -> list[RuleTestCase]:
    cases: list[RuleTestCase] = []
    for entry in compiled_rule_set.entries:
        if entry.status.value != "compiled" or entry.compiled_rule is None:
            continue
        cases.extend(
            _generate_cases_for_rule(
                entry.compiled_rule,
                compiled_rule_set_id=compiled_rule_set.compiled_rule_set_id,
                generated_by=generated_by,
                generated_at=generated_at,
            )
        )
    return cases


def _generate_cases_for_rule(
    compiled_rule: CompiledExecutableRule,
    *,
    compiled_rule_set_id: str,
    generated_by: str,
    generated_at,
) -> list[RuleTestCase]:
    condition = compiled_rule.condition
    target = _resolve_condition_target(condition["field"])
    positive_value = _value_for_variant(
        operator=condition["operator"],
        limit=condition["value"],
        variant=RuleTestCaseVariant.POSITIVE,
        target=target,
    )
    negative_value = _value_for_variant(
        operator=condition["operator"],
        limit=condition["value"],
        variant=RuleTestCaseVariant.NEGATIVE,
        target=target,
    )
    cases = [
        RuleTestCase(
            rule_test_case_id=f"rtc-{uuid4().hex}",
            compiled_rule_set_id=compiled_rule_set_id,
            rule_id=compiled_rule.rule_id,
            variant=RuleTestCaseVariant.POSITIVE,
            expense_fixture=_build_expense_fixture(
                compiled_rule,
                target=target,
                value=positive_value,
            ),
            expected_outcome=EvaluationOutcome.PASS,
            generated_by=generated_by,
            generated_at=generated_at,
        ),
        RuleTestCase(
            rule_test_case_id=f"rtc-{uuid4().hex}",
            compiled_rule_set_id=compiled_rule_set_id,
            rule_id=compiled_rule.rule_id,
            variant=RuleTestCaseVariant.NEGATIVE,
            expense_fixture=_build_expense_fixture(
                compiled_rule,
                target=target,
                value=negative_value,
            ),
            expected_outcome=EvaluationOutcome.VIOLATION,
            generated_by=generated_by,
            generated_at=generated_at,
        ),
    ]
    if target.value_kind is ConditionValueKind.NUMERIC:
        boundary_value, boundary_outcome = _numeric_boundary_value(
            operator=condition["operator"],
            limit=condition["value"],
            as_int=target.fixture_field == "submission_days",
        )
        cases.append(
            RuleTestCase(
                rule_test_case_id=f"rtc-{uuid4().hex}",
                compiled_rule_set_id=compiled_rule_set_id,
                rule_id=compiled_rule.rule_id,
                variant=RuleTestCaseVariant.BOUNDARY,
                expense_fixture=_build_expense_fixture(
                    compiled_rule,
                    target=target,
                    value=boundary_value,
                ),
                expected_outcome=boundary_outcome,
                generated_by=generated_by,
                generated_at=generated_at,
            )
        )
    cases.extend(
        _generate_exception_cases_for_rule(
            compiled_rule,
            target=target,
            violating_value=negative_value,
            compiled_rule_set_id=compiled_rule_set_id,
            generated_by=generated_by,
            generated_at=generated_at,
        )
    )
    return cases


def _resolve_condition_target(field: str) -> ConditionTarget:
    normalized = field.strip()
    fixture_field = _FIELD_ALIASES.get(normalized)
    if fixture_field is None and normalized.endswith(".amount"):
        fixture_field = "amount"
    if fixture_field is None:
        raise UnsupportedConditionFieldError(normalized)

    if fixture_field in {"amount", "submission_days"}:
        value_kind = ConditionValueKind.NUMERIC
    elif fixture_field in {"manager_approval", "receipt_attached"}:
        value_kind = ConditionValueKind.BOOLEAN
    else:
        value_kind = ConditionValueKind.STRING
    return ConditionTarget(fixture_field=fixture_field, value_kind=value_kind)


def _value_for_variant(
    *,
    operator: str,
    limit: str,
    variant: RuleTestCaseVariant,
    target: ConditionTarget,
) -> str | bool | int:
    if target.value_kind is ConditionValueKind.NUMERIC:
        return _numeric_value_for_variant(
            operator=operator,
            limit=limit,
            variant=variant,
            as_int=target.fixture_field == "submission_days",
        )
    if target.value_kind is ConditionValueKind.STRING:
        return _string_value_for_variant(
            operator=operator,
            limit=limit,
            variant=variant,
            field=target.fixture_field,
        )
    return _boolean_value_for_variant(
        operator=operator,
        limit=limit,
        variant=variant,
        field=target.fixture_field,
    )


def _build_expense_fixture(
    compiled_rule: CompiledExecutableRule,
    *,
    target: ConditionTarget,
    value: str | bool | int,
) -> ExpenseReportRow:
    scope = compiled_rule.scope
    applicability = compiled_rule.applicability
    currency = applicability.get("currency") or "USD"
    fixture = ExpenseReportRow(
        employee_id=_SYNTHETIC_EMPLOYEE_ID,
        expense_date=_SYNTHETIC_EXPENSE_DATE,
        expense_category=str(scope.get("expense_category", "misc")),
        amount=_DEFAULT_AMOUNT,
        currency=currency,
        country=scope.get("country"),
        travel_type=scope.get("travel_type"),
    )
    return fixture.model_copy(update={target.fixture_field: value})


def _generate_exception_cases_for_rule(
    compiled_rule: CompiledExecutableRule,
    *,
    target: ConditionTarget,
    violating_value: str | bool | int,
    compiled_rule_set_id: str,
    generated_by: str,
    generated_at,
) -> list[RuleTestCase]:
    cases: list[RuleTestCase] = []
    for exception in compiled_rule.exceptions:
        evidence_fields = _resolve_exception_evidence_fields(exception)
        if not evidence_fields:
            continue
        base_fixture = _build_expense_fixture(
            compiled_rule,
            target=target,
            value=violating_value,
        )
        present_updates = dict.fromkeys(evidence_fields, True)
        absent_updates = dict.fromkeys(evidence_fields, False)
        cases.append(
            RuleTestCase(
                rule_test_case_id=f"rtc-{uuid4().hex}",
                compiled_rule_set_id=compiled_rule_set_id,
                rule_id=compiled_rule.rule_id,
                variant=RuleTestCaseVariant.EXCEPTION,
                expense_fixture=base_fixture.model_copy(update=present_updates),
                expected_outcome=EvaluationOutcome.PASS,
                generated_by=generated_by,
                generated_at=generated_at,
            )
        )
        cases.append(
            RuleTestCase(
                rule_test_case_id=f"rtc-{uuid4().hex}",
                compiled_rule_set_id=compiled_rule_set_id,
                rule_id=compiled_rule.rule_id,
                variant=RuleTestCaseVariant.EXCEPTION,
                expense_fixture=base_fixture.model_copy(update=absent_updates),
                expected_outcome=EvaluationOutcome.MISSING_EVIDENCE,
                generated_by=generated_by,
                generated_at=generated_at,
            )
        )
    return cases


def _resolve_exception_evidence_fields(exception: dict[str, object]) -> list[str]:
    raw_evidence = exception.get("required_evidence")
    if not isinstance(raw_evidence, list):
        return []
    fields: list[str] = []
    for item in raw_evidence:
        if not isinstance(item, str):
            continue
        normalized = item.strip()
        if normalized in _EVIDENCE_FIELDS and normalized not in fields:
            fields.append(normalized)
    return fields


def _numeric_boundary_value(
    *,
    operator: str,
    limit: str,
    as_int: bool,
) -> tuple[str | int, EvaluationOutcome]:
    limit_value = _parse_numeric(limit)
    if operator in ("<=", ">=", "=="):
        outcome = EvaluationOutcome.PASS
    elif operator in ("<", ">", "!="):
        outcome = EvaluationOutcome.VIOLATION
    else:
        raise UnsupportedConditionOperatorError(field="amount", operator=operator)

    if as_int:
        return int(limit_value), outcome
    return _format_amount(limit_value), outcome


def _numeric_value_for_variant(
    *,
    operator: str,
    limit: str,
    variant: RuleTestCaseVariant,
    as_int: bool,
) -> str | int:
    limit_value = _parse_numeric(limit)
    delta = Decimal("1")
    if operator in ("<=", "<"):
        positive = limit_value - delta
        negative = limit_value + delta
    elif operator in (">=", ">"):
        positive = limit_value + delta
        negative = limit_value - delta
    elif operator == "==":
        positive = limit_value
        negative = limit_value + delta
    elif operator == "!=":
        positive = limit_value + delta
        negative = limit_value
    else:
        raise UnsupportedConditionOperatorError(field="amount", operator=operator)

    selected = positive if variant is RuleTestCaseVariant.POSITIVE else negative
    if as_int:
        return int(selected)
    return _format_amount(selected)


def _string_value_for_variant(
    *,
    operator: str,
    limit: str,
    variant: RuleTestCaseVariant,
    field: str,
) -> str:
    if operator == "==":
        if variant is RuleTestCaseVariant.POSITIVE:
            return limit
        return _STRING_MISMATCH_VALUE if limit != _STRING_MISMATCH_VALUE else "alternate-value"
    if operator == "!=":
        if variant is RuleTestCaseVariant.POSITIVE:
            return _STRING_MISMATCH_VALUE if limit != _STRING_MISMATCH_VALUE else "alternate-value"
        return limit
    raise UnsupportedConditionOperatorError(field=field, operator=operator)


def _boolean_value_for_variant(
    *,
    operator: str,
    limit: str,
    variant: RuleTestCaseVariant,
    field: str,
) -> bool:
    limit_value = _parse_boolean(limit)
    if operator == "==":
        if variant is RuleTestCaseVariant.POSITIVE:
            return limit_value
        return not limit_value
    if operator == "!=":
        if variant is RuleTestCaseVariant.POSITIVE:
            return not limit_value
        return limit_value
    raise UnsupportedConditionOperatorError(field=field, operator=operator)


def _parse_numeric(limit: str) -> Decimal:
    try:
        return Decimal(limit)
    except InvalidOperation as exc:
        raise ValueError(f"Condition limit {limit!r} is not numeric.") from exc


def _parse_boolean(limit: str) -> bool:
    normalized = limit.strip().lower()
    if normalized in _TRUE_VALUES:
        return True
    if normalized in _FALSE_VALUES:
        return False
    raise ValueError(f"Condition limit {limit!r} is not a boolean.")


def _format_amount(value: Decimal) -> str:
    normalized = value.normalize()
    text = format(normalized, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    if text == "-0":
        return "0"
    return text


def group_rule_test_cases(
    compiled_rule_set: CompiledRuleSet,
    cases: list[RuleTestCase],
) -> list:
    from policy_pipeline.rule_test_cases.models import RuleTestCaseGroup

    cases_by_rule: dict[str, list[RuleTestCase]] = {}
    for case in cases:
        cases_by_rule.setdefault(case.rule_id, []).append(case)

    groups: list[RuleTestCaseGroup] = []
    for entry in compiled_rule_set.entries:
        rule_cases = cases_by_rule.get(entry.rule_id, [])
        if not rule_cases:
            continue
        positive_count = sum(
            1 for case in rule_cases if case.variant is RuleTestCaseVariant.POSITIVE
        )
        negative_count = sum(
            1 for case in rule_cases if case.variant is RuleTestCaseVariant.NEGATIVE
        )
        boundary_count = sum(
            1 for case in rule_cases if case.variant is RuleTestCaseVariant.BOUNDARY
        )
        exception_count = sum(
            1 for case in rule_cases if case.variant is RuleTestCaseVariant.EXCEPTION
        )
        groups.append(
            RuleTestCaseGroup(
                rule_id=entry.rule_id,
                statement=entry.source_rule.statement,
                positive_count=positive_count,
                negative_count=negative_count,
                boundary_count=boundary_count,
                exception_count=exception_count,
                cases=sorted(rule_cases, key=lambda case: case.variant.value),
            )
        )
    return groups
