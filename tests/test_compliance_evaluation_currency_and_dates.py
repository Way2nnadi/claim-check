from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from policy_pipeline.compiled_rule_sets.compiler import compile_policy_version_snapshot
from policy_pipeline.compiled_rule_sets.models import CompileStatus
from policy_pipeline.compliance_evaluation_runs.evaluator import (
    CURRENCY_MISMATCH_V1_REVIEW_SUFFIX,
    build_currency_match_context,
    build_effective_date_scope_context,
    build_scope_match_context,
    evaluate_expense_row_for_compliance_v1,
)
from policy_pipeline.compliance_evaluation_runs.models import (
    ComplianceOutcome,
    CurrencyMatchStatus,
    EffectiveDatePosition,
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


def _money_rule(
    *,
    rule_id: str,
    cap: str = "75",
    currency: str | None = "USD",
    scope: Scope | None = None,
    aggregation_period: AggregationPeriod = AggregationPeriod.PER_TRANSACTION,
) -> Rule:
    return Rule(
        rule_id=rule_id,
        statement="Domestic meals are capped at $75 per transaction.",
        enforceability_class=EnforceabilityClass.ENFORCEABLE,
        lifecycle_state=LifecycleState.PUBLISHED,
        origin=RuleOrigin(
            source_type=RuleOriginType.MANUAL,
            rationale="Currency and date scope tests.",
        ),
        scope=scope or Scope(expense_category="meals"),
        condition=RuleCondition(field="meal.amount", operator="<=", value=cap),
        applicability=Applicability(
            aggregation_period=aggregation_period,
            unit="money",
            currency=currency,
        ),
        citation=Citation(
            document_id="doc-expense-policy",
            document_version_id="docv-2026-06-01",
            section_id="meals#cap",
            quote="Meal expenses are capped.",
            start_char=0,
            end_char=24,
        ),
    )


def _compile_snapshot(*rules: Rule):
    snapshot = PolicyVersionSnapshot(
        policy_version_id="policy-currency-date-test",
        change_summary="Currency and effective-date tests.",
        published_by="tests",
        rules=list(rules),
    )
    return compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id="compiled-currency-date-test",
        compiled_by="tests",
        compiled_at=_COMPILED_AT,
    )


def test_compile_records_currency_and_effective_date_evidence() -> None:
    rule = _money_rule(
        rule_id="rule-dated-cap",
        scope=Scope(
            expense_category="meals",
            effective_start_date="2026-06-01",
            effective_end_date="2026-06-30",
        ),
    )
    compiled = _compile_snapshot(rule)
    entry = compiled.entries[0]
    assert entry.status is CompileStatus.COMPILED
    assert entry.compile_evidence is not None
    assert entry.compile_evidence.rule_currency == "USD"
    assert entry.compile_evidence.effective_start_date == "2026-06-01"
    assert entry.compile_evidence.effective_end_date == "2026-06-30"


@pytest.mark.parametrize(
    ("rule_currency", "expense_currency", "expected_status"),
    [
        ("USD", "USD", CurrencyMatchStatus.MATCH),
        ("USD", "EUR", CurrencyMatchStatus.MISMATCH),
        (None, "USD", CurrencyMatchStatus.NOT_APPLICABLE),
    ],
)
def test_build_currency_match_context_statuses(
    rule_currency: str | None,
    expense_currency: str,
    expected_status: CurrencyMatchStatus,
) -> None:
    compiled = _compile_snapshot(_money_rule(rule_id="rule-cap", currency=rule_currency))
    compiled_rule = compiled.entries[0].compiled_rule
    assert compiled_rule is not None
    context = build_currency_match_context(
        compiled_rule,
        _expense_row(currency=expense_currency),
    )
    assert context is not None
    assert context.status is expected_status
    assert context.conversion_supported is False
    assert context.expense_currency == expense_currency.upper()


def test_currency_match_allows_violation() -> None:
    compiled = _compile_snapshot(_money_rule(rule_id="rule-usd-cap"))
    compiled_rule = compiled.entries[0].compiled_rule
    assert compiled_rule is not None
    result = evaluate_expense_row_for_compliance_v1(
        compiled_rule,
        _expense_row(amount="100.00", currency="USD"),
    )
    assert result.outcome is ComplianceOutcome.VIOLATION


def test_currency_mismatch_routes_to_needs_review_without_numeric_comparison() -> None:
    compiled = _compile_snapshot(_money_rule(rule_id="rule-usd-cap"))
    outcomes = evaluate_compliance_for_expense_rows(
        compiled,
        [_expense_row(amount="100.00", currency="EUR")],
    )
    assert len(outcomes) == 1
    outcome = outcomes[0]
    assert outcome.outcome is ComplianceOutcome.NEEDS_REVIEW
    assert outcome.currency_context is not None
    assert outcome.currency_context.status is CurrencyMatchStatus.MISMATCH
    assert outcome.currency_context.rule_currency == "USD"
    assert outcome.currency_context.expense_currency == "EUR"
    assert outcome.policy_limit is None
    assert outcome.actual_value is None
    assert CURRENCY_MISMATCH_V1_REVIEW_SUFFIX in (outcome.reason or "")


@pytest.mark.parametrize(
    ("expense_date", "expected_position", "expected_outcome"),
    [
        (date(2026, 5, 31), EffectiveDatePosition.BEFORE, ComplianceOutcome.PASS),
        (date(2026, 6, 15), EffectiveDatePosition.WITHIN, ComplianceOutcome.VIOLATION),
        (date(2026, 7, 1), EffectiveDatePosition.AFTER, ComplianceOutcome.PASS),
    ],
)
def test_effective_date_window_boundaries(
    expense_date: date,
    expected_position: EffectiveDatePosition,
    expected_outcome: ComplianceOutcome,
) -> None:
    rule = _money_rule(
        rule_id="rule-dated-cap",
        scope=Scope(
            expense_category="meals",
            effective_start_date="2026-06-01",
            effective_end_date="2026-06-30",
        ),
    )
    compiled = _compile_snapshot(rule)
    outcomes = evaluate_compliance_for_expense_rows(
        compiled,
        [_expense_row(expense_date=expense_date, amount="100.00")],
    )
    assert outcomes[0].outcome is expected_outcome
    context = build_effective_date_scope_context(
        rule.scope.model_dump(mode="json"),
        _expense_row(expense_date=expense_date),
    )
    assert context is not None
    assert context.position is expected_position
    if expected_outcome is not ComplianceOutcome.PASS:
        assert outcomes[0].effective_date_context is not None
        assert outcomes[0].effective_date_context.position is expected_position


def test_within_effective_window_records_scope_and_date_evidence() -> None:
    rule = _money_rule(
        rule_id="rule-dated-cap",
        scope=Scope(
            expense_category="meals",
            effective_start_date="2026-06-01",
            effective_end_date="2026-06-30",
        ),
    )
    compiled = _compile_snapshot(rule)
    expense = _expense_row(expense_date=date(2026, 6, 15), amount="100.00")
    outcomes = evaluate_compliance_for_expense_rows(compiled, [expense])
    outcome = outcomes[0]
    scope_context = build_scope_match_context(rule.scope.model_dump(mode="json"), expense)
    assert scope_context is not None
    assert scope_context.matched_dimensions["expense_date"] == "2026-06-15"
    assert outcome.scope_context is not None
    assert outcome.scope_context.matched_dimensions["expense_date"] == "2026-06-15"
    assert outcome.effective_date_context is not None
    assert outcome.effective_date_context.position is EffectiveDatePosition.WITHIN
    assert outcome.currency_context is not None
    assert outcome.currency_context.status is CurrencyMatchStatus.MATCH


def test_audit_row_context_includes_reproducibility_pins_and_evaluation_evidence() -> None:
    from policy_pipeline.compliance_evaluation_runs.models import (
        ComplianceEvaluationRun,
        ComplianceEvaluationRunSummary,
        CurrencyMatchContext,
        CurrencyMatchStatus,
        EffectiveDatePosition,
        EffectiveDateScopeContext,
    )
    from policy_pipeline.compliance_review.router import _audit_row_context_for_decision
    from policy_pipeline.compliance_review.models import (
        ComplianceReviewDecision,
        ComplianceReviewResolutionType,
    )

    class _FakeSession:
        pass

    run = ComplianceEvaluationRun(
        compliance_evaluation_run_id="cer-audit-test",
        expense_report_id="expense-audit-test",
        compiled_rule_set_id="compiled-audit-test",
        policy_version_id="policy-audit-test",
        executed_by="admin-user",
        executed_at=_COMPILED_AT,
        summary=ComplianceEvaluationRunSummary(
            total_count=1,
            pass_count=0,
            violation_count=1,
            needs_review_count=0,
            missing_evidence_count=0,
        ),
        row_outcomes=[
            {
                "row_index": 0,
                "employee_id": "emp-001",
                "expense_date": "2026-06-21",
                "outcome": "violation",
                "rule_id": "rule-dated-cap",
                "matching_rule_ids": ["rule-dated-cap"],
                "reason": "June 2026 domestic meals are capped at $75 per transaction.",
                "policy_limit": "75",
                "actual_value": "100.00",
                "missing_evidence_fields": [],
                "evidence": [],
                "scope_context": {
                    "matched_dimensions": {
                        "expense_category": "meals",
                        "effective_start_date": "2026-06-01",
                        "effective_end_date": "2026-06-30",
                        "expense_date": "2026-06-21",
                    },
                    "unavailable_dimensions": {},
                },
                "currency_context": {
                    "rule_currency": "USD",
                    "expense_currency": "USD",
                    "status": "match",
                    "conversion_supported": False,
                },
                "effective_date_context": {
                    "effective_start_date": "2026-06-01",
                    "effective_end_date": "2026-06-30",
                    "expense_date": "2026-06-21",
                    "position": "within",
                },
            }
        ],
    )
    decision = ComplianceReviewDecision(
        compliance_review_decision_id="crd-audit-test",
        evaluation_outcome_id="cer-audit-test:0",
        compliance_evaluation_run_id="cer-audit-test",
        row_index=0,
        resolution_type=ComplianceReviewResolutionType.UPHELD,
        rationale="Violation confirmed within the June 2026 policy window.",
        recorded_by="approver-user",
        recorded_at=_COMPILED_AT,
    )

    import policy_pipeline.compliance_review.router as review_router

    original_get_run = review_router.get_compliance_evaluation_run
    review_router.get_compliance_evaluation_run = lambda _session, **kwargs: run
    try:
        context = _audit_row_context_for_decision(_FakeSession(), decision=decision)
    finally:
        review_router.get_compliance_evaluation_run = original_get_run

    assert context["policy_version_id"] == "policy-audit-test"
    assert context["compiled_rule_set_id"] == "compiled-audit-test"
    assert context["currency_context"] == CurrencyMatchContext(
        rule_currency="USD",
        expense_currency="USD",
        status=CurrencyMatchStatus.MATCH,
        conversion_supported=False,
    ).model_dump(mode="json")
    assert context["effective_date_context"] == EffectiveDateScopeContext(
        effective_start_date="2026-06-01",
        effective_end_date="2026-06-30",
        expense_date="2026-06-21",
        position=EffectiveDatePosition.WITHIN,
    ).model_dump(mode="json")
