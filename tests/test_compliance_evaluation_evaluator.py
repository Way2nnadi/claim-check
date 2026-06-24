from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from policy_pipeline.compiled_rule_sets.compiler import compile_policy_version_snapshot
from policy_pipeline.compiled_rule_sets.models import CompiledExecutableRule, CompileStatus
from policy_pipeline.compliance_evaluation_runs.evaluator import (
    EMPLOYEE_GROUP_SCOPE_V1_SKIP_REASON,
    ComplianceEvaluationResult,
    build_needs_review_reason,
    build_review_evidence,
    build_scope_match_context,
    build_unavailable_scope_skip_reason,
    evaluate_expense_row_for_compliance_v1,
    non_enforceable_rule_scope_matches_v1,
    resolve_violation_comparison,
)
from policy_pipeline.compliance_evaluation_runs.models import ComplianceOutcome
from policy_pipeline.expense_reports import ExpenseReportRow
from policy_pipeline.rule_test_cases.evaluator import UnsupportedRuleEvaluationError
from policy_pipeline.rules.models import (
    AggregationPeriod,
    Applicability,
    Citation,
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

_COMPILED_AT = datetime(2026, 6, 22, 12, 0, tzinfo=UTC)


def _expense_row(**overrides: object) -> ExpenseReportRow:
    defaults = {
        "employee_id": "emp-001",
        "expense_date": date(2026, 6, 21),
        "expense_category": "meals",
        "amount": "100.00",
        "currency": "USD",
        "country": "domestic",
        "travel_type": "domestic",
        "business_purpose": "Team dinner",
        "attendee_list": "Alice; Bob",
        "manager_approval": True,
        "receipt_attached": True,
        "trip_id": "trip-1",
        "submission_days": 10,
    }
    defaults.update(overrides)
    return ExpenseReportRow(**defaults)


def _compile_rule(rule: Rule) -> CompiledExecutableRule:
    snapshot = PolicyVersionSnapshot(
        policy_version_id="policy-evaluator-test",
        change_summary="Evaluator field tests.",
        published_by="tests",
        rules=[rule],
    )
    compiled = compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id="compiled-evaluator-test",
        compiled_by="tests",
        compiled_at=_COMPILED_AT,
    )
    entry = compiled.entries[0]
    assert entry.status is CompileStatus.COMPILED
    assert entry.compiled_rule is not None
    return entry.compiled_rule


def _enforceable_rule(
    *,
    rule_id: str,
    field: str,
    operator: str,
    value: str,
    expense_category: str = "meals",
    aggregation_period: AggregationPeriod = AggregationPeriod.PER_TRANSACTION,
    exceptions: list[RuleException] | None = None,
) -> Rule:
    return Rule(
        rule_id=rule_id,
        statement=f"Rule for {field}.",
        enforceability_class=EnforceabilityClass.ENFORCEABLE,
        lifecycle_state=LifecycleState.PUBLISHED,
        origin=RuleOrigin(
            source_type=RuleOriginType.MANUAL,
            rationale="Evaluator field test.",
        ),
        scope=Scope(expense_category=expense_category),
        condition=RuleCondition(field=field, operator=operator, value=value),
        applicability=Applicability(
            aggregation_period=aggregation_period,
            unit="money" if field.endswith(".amount") else "count",
            currency="USD",
        ),
        exceptions=exceptions or [],
        citation=Citation(
            document_id="doc-expense-policy",
            document_version_id="docv-2026-06-01",
            section_id=f"{expense_category}#test",
            quote=f"Policy limit for {field}.",
            start_char=0,
            end_char=24,
        ),
    )


def _enforceable_employee_group_rule(*, rule_id: str = "rule-exec-meals") -> Rule:
    return Rule(
        rule_id=rule_id,
        statement="Executive meal expenses are capped at $150 per day.",
        enforceability_class=EnforceabilityClass.ENFORCEABLE,
        lifecycle_state=LifecycleState.PUBLISHED,
        origin=RuleOrigin(
            source_type=RuleOriginType.MANUAL,
            rationale="Executive tier cap.",
        ),
        scope=Scope(
            expense_category="meals",
            country="domestic",
            employee_group="executives",
        ),
        condition=RuleCondition(field="meal.amount", operator="<=", value="150"),
        applicability=Applicability(
            aggregation_period=AggregationPeriod.PER_DAY,
            unit="money",
            currency="USD",
        ),
        citation=Citation(
            document_id="doc-expense-policy",
            document_version_id="docv-2026-06-01",
            section_id="meals#executive-cap",
            quote="Executive meal expenses are capped at $150 per person per day.",
            start_char=0,
            end_char=58,
        ),
    )


def _guidance_employee_group_rule(*, rule_id: str = "rule-guidance-exec") -> Rule:
    return Rule(
        rule_id=rule_id,
        statement="Executives should book premium hotel blocks when available.",
        enforceability_class=EnforceabilityClass.GUIDANCE,
        lifecycle_state=LifecycleState.PUBLISHED,
        origin=RuleOrigin(
            source_type=RuleOriginType.MANUAL,
            rationale="Executive lodging guidance.",
        ),
        scope=Scope(
            expense_category="lodging",
            employee_group="executives",
        ),
    )


@pytest.mark.parametrize(
    ("field", "operator", "value", "expense_overrides", "expected_outcome"),
    [
        ("meal.amount", "<=", "75", {"amount": "50.00"}, ComplianceOutcome.PASS),
        ("meal.amount", "<=", "75", {"amount": "100.00"}, ComplianceOutcome.VIOLATION),
        (
            "lodging.amount",
            "<=",
            "220",
            {"expense_category": "lodging", "amount": "180.00"},
            ComplianceOutcome.PASS,
        ),
        (
            "lodging.amount",
            "<=",
            "220",
            {"expense_category": "lodging", "amount": "250.00"},
            ComplianceOutcome.VIOLATION,
        ),
        ("receipt_attached", "==", "true", {"receipt_attached": True}, ComplianceOutcome.PASS),
        (
            "receipt_attached",
            "==",
            "true",
            {"receipt_attached": False},
            ComplianceOutcome.VIOLATION,
        ),
        (
            "manager_approval",
            "==",
            "true",
            {"manager_approval": True},
            ComplianceOutcome.PASS,
        ),
        (
            "manager_approval",
            "==",
            "true",
            {"manager_approval": False},
            ComplianceOutcome.VIOLATION,
        ),
        (
            "expense_report.submission_days",
            "<=",
            "30",
            {"submission_days": 15},
            ComplianceOutcome.PASS,
        ),
        (
            "expense_report.submission_days",
            "<=",
            "30",
            {"submission_days": 45},
            ComplianceOutcome.VIOLATION,
        ),
    ],
)
def test_evaluate_supported_condition_fields(
    field: str,
    operator: str,
    value: str,
    expense_overrides: dict[str, object],
    expected_outcome: ComplianceOutcome,
) -> None:
    expense_category = str(expense_overrides.get("expense_category", "meals"))
    compiled_rule = _compile_rule(
        _enforceable_rule(
            rule_id=f"rule-{field.replace('.', '-')}",
            field=field,
            operator=operator,
            value=value,
            expense_category=expense_category,
        )
    )
    result = evaluate_expense_row_for_compliance_v1(
        compiled_rule,
        _expense_row(**expense_overrides),
    )
    assert result.outcome is expected_outcome


def test_evaluate_unsupported_condition_field_raises() -> None:
    compiled_rule = _compile_rule(
        _enforceable_rule(
            rule_id="rule-bad-field",
            field="meal.amount",
            operator="<=",
            value="75",
        )
    )
    compiled_rule = compiled_rule.model_copy(
        update={
            "condition": {
                **compiled_rule.condition,
                "field": "director_approval",
            }
        }
    )
    with pytest.raises(UnsupportedRuleEvaluationError, match="director_approval"):
        evaluate_expense_row_for_compliance_v1(compiled_rule, _expense_row())


def test_compile_rejects_unsupported_condition_field() -> None:
    snapshot = PolicyVersionSnapshot(
        policy_version_id="policy-v1",
        change_summary="Unsupported field compile test.",
        published_by="tests",
        rules=[
            _enforceable_rule(
                rule_id="rule-bad-field",
                field="director_approval",
                operator="==",
                value="true",
            )
        ],
    )
    compiled = compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id="compiled-bad-field",
        compiled_by="tests",
        compiled_at=_COMPILED_AT,
    )
    assert compiled.summary.compile_error == 1
    assert compiled.entries[0].status is CompileStatus.COMPILE_ERROR
    assert "director_approval" in (compiled.entries[0].error_reason or "")


def test_compile_rejects_unsupported_exception_evidence() -> None:
    rule = _enforceable_rule(
        rule_id="rule-bad-evidence",
        field="meal.amount",
        operator="<=",
        value="75",
        exceptions=[
            RuleException(
                description="Director approval required.",
                required_evidence=["director_approval"],
            )
        ],
    )
    snapshot = PolicyVersionSnapshot(
        policy_version_id="policy-v1",
        change_summary="Unsupported evidence compile test.",
        published_by="tests",
        rules=[rule],
    )
    compiled = compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id="compiled-bad-evidence",
        compiled_by="tests",
        compiled_at=_COMPILED_AT,
    )
    assert compiled.summary.compile_error == 1
    assert "director_approval" in (compiled.entries[0].error_reason or "")


def test_exception_evidence_null_treated_as_missing() -> None:
    rule = _enforceable_rule(
        rule_id="rule-meal-exception",
        field="meal.amount",
        operator="<=",
        value="75",
        exceptions=[
            RuleException(
                description="Client entertainment requires manager approval.",
                required_evidence=["manager_approval"],
            )
        ],
    )
    compiled_rule = _compile_rule(rule)
    result = evaluate_expense_row_for_compliance_v1(
        compiled_rule,
        _expense_row(amount="100.00", manager_approval=None),
    )
    assert result == ComplianceEvaluationResult(
        ComplianceOutcome.MISSING_EVIDENCE,
        missing_evidence_fields=("manager_approval",),
    )


def test_exception_evidence_present_passes_over_cap() -> None:
    rule = _enforceable_rule(
        rule_id="rule-meal-exception",
        field="meal.amount",
        operator="<=",
        value="75",
        exceptions=[
            RuleException(
                description="Client entertainment requires manager approval.",
                required_evidence=["manager_approval"],
            )
        ],
    )
    compiled_rule = _compile_rule(rule)
    result = evaluate_expense_row_for_compliance_v1(
        compiled_rule,
        _expense_row(amount="100.00", manager_approval=True),
    )
    assert result.outcome is ComplianceOutcome.PASS


def test_resolve_violation_comparison_for_boolean_fields() -> None:
    compiled_rule = _compile_rule(
        _enforceable_rule(
            rule_id="rule-receipt",
            field="receipt_attached",
            operator="==",
            value="true",
            expense_category="lodging",
        )
    )
    policy_limit, actual_value = resolve_violation_comparison(
        compiled_rule,
        _expense_row(expense_category="lodging", receipt_attached=False),
    )
    assert policy_limit == "true"
    assert actual_value == "false"


def test_resolve_violation_comparison_for_submission_days() -> None:
    compiled_rule = _compile_rule(
        _enforceable_rule(
            rule_id="rule-timeliness",
            field="expense_report.submission_days",
            operator="<=",
            value="30",
        )
    )
    policy_limit, actual_value = resolve_violation_comparison(
        compiled_rule,
        _expense_row(submission_days=45),
    )
    assert policy_limit == "30"
    assert actual_value == "45"


def test_non_enforceable_rule_scope_matches_v1_ignores_employee_group() -> None:
    rule = _enforceable_employee_group_rule()
    matching_row = _expense_row()
    wrong_category_row = _expense_row(expense_category="lodging")

    assert non_enforceable_rule_scope_matches_v1(rule, matching_row) is True
    assert non_enforceable_rule_scope_matches_v1(rule, wrong_category_row) is False


def test_non_enforceable_rule_scope_matches_v1_ignores_deferred_dimensions() -> None:
    rule = _enforceable_employee_group_rule().model_copy(
        update={
            "scope": Scope(
                expense_category="meals",
                country="domestic",
                department="sales",
                region="west",
            )
        }
    )
    matching_row = _expense_row()
    wrong_country_row = _expense_row(country="international")

    assert non_enforceable_rule_scope_matches_v1(rule, matching_row) is True
    assert non_enforceable_rule_scope_matches_v1(rule, wrong_country_row) is False


def test_guidance_rule_with_employee_group_scope_matches_partial_dimensions() -> None:
    rule = _guidance_employee_group_rule()
    matching_row = _expense_row(expense_category="lodging")
    wrong_category_row = _expense_row(expense_category="meals")

    assert non_enforceable_rule_scope_matches_v1(rule, matching_row) is True
    assert non_enforceable_rule_scope_matches_v1(rule, wrong_category_row) is False


def test_build_needs_review_reason_for_employee_group_enforceable_rule() -> None:
    rule = _enforceable_employee_group_rule()

    assert build_needs_review_reason(rule) == (
        "Executive meal expenses are capped at $150 per day. "
        f"{EMPLOYEE_GROUP_SCOPE_V1_SKIP_REASON}"
    )


def test_build_needs_review_reason_for_deferred_scope_dimensions() -> None:
    rule = _enforceable_employee_group_rule().model_copy(
        update={
            "statement": "Sales team meals are capped at $90 per day.",
            "scope": Scope(
                expense_category="meals",
                country="domestic",
                department="sales",
                state="CA",
            ),
        }
    )

    assert build_needs_review_reason(rule) == (
        "Sales team meals are capped at $90 per day. "
        f"{build_unavailable_scope_skip_reason(('department', 'state'))}"
    )


def test_build_review_evidence_includes_citation() -> None:
    rule = _enforceable_employee_group_rule()

    evidence = build_review_evidence(rule)

    assert len(evidence) == 1
    assert evidence[0].quote == (
        "Executive meal expenses are capped at $150 per person per day."
    )


def test_build_scope_match_context_for_deferred_employee_group_rule() -> None:
    rule = _enforceable_employee_group_rule()
    expense = _expense_row()

    context = build_scope_match_context(rule.scope.model_dump(mode="json"), expense)

    assert context is not None
    assert context.matched_dimensions == {
        "expense_category": "meals",
        "country": "domestic",
    }
    assert context.unavailable_dimensions == {"employee_group": "executives"}


def test_build_scope_match_context_returns_none_for_global_scope() -> None:
    rule = _enforceable_rule(
        rule_id="rule-global",
        field="meal.amount",
        operator="<=",
        value="75",
        expense_category="meals",
    ).model_copy(update={"scope": Scope()})

    context = build_scope_match_context(rule.scope.model_dump(mode="json"), _expense_row())

    assert context is None
