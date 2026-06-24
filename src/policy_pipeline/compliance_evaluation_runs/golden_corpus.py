"""Golden expense corpus fixtures for compliance evaluation quality measurement."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from policy_pipeline.compliance_evaluation_runs.evaluation import (
    BinaryClassificationMetric,
    ExpenseGoldenCorpusExpectedRow,
)
from policy_pipeline.compliance_evaluation_runs.models import ComplianceOutcome
from policy_pipeline.expense_reports import ExpenseReportRow
from policy_pipeline.extraction.evaluation import GoldenCorpusMetric
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


def _build_enforceable_meal_cap_rule(*, rule_id: str, cap: str = "75") -> Rule:
    return Rule(
        rule_id=rule_id,
        statement="Domestic meals are capped at $75 per day.",
        enforceability_class=EnforceabilityClass.ENFORCEABLE,
        lifecycle_state=LifecycleState.PUBLISHED,
        origin=RuleOrigin(
            source_type=RuleOriginType.MANUAL,
            rationale="Manual cap for golden expense corpus.",
        ),
        scope=Scope(expense_category="meals"),
        condition=RuleCondition(field="meal.amount", operator="<=", value=cap),
        applicability=Applicability(
            aggregation_period=AggregationPeriod.PER_DAY,
            unit="money",
            currency="USD",
        ),
        citation=_meal_cap_citation(),
    )


def _build_meals_guidance_rule(*, rule_id: str, statement: str) -> Rule:
    return Rule(
        rule_id=rule_id,
        statement=statement,
        enforceability_class=EnforceabilityClass.GUIDANCE,
        lifecycle_state=LifecycleState.PUBLISHED,
        origin=RuleOrigin(
            source_type=RuleOriginType.MANUAL,
            rationale="Guidance note for golden expense corpus.",
        ),
        scope=Scope(expense_category="meals"),
        citation=Citation(
            document_id="doc-expense-policy",
            document_version_id="docv-2026-06-01",
            section_id="meals#itemized-receipts",
            quote="Itemized receipts are preferred for meal expenses.",
            start_char=10,
            end_char=58,
        ),
    )


def _build_meal_cap_exception_rule(*, rule_id: str) -> Rule:
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
        citation=_meal_cap_citation(),
    )


def _meal_cap_citation() -> Citation:
    return Citation(
        document_id="doc-expense-policy",
        document_version_id="docv-2026-06-01",
        section_id="meals#domestic-cap",
        quote="Domestic meal expenses are limited to $75 per person per day.",
        start_char=42,
        end_char=98,
    )


def _meal_row(
    *,
    amount: str,
    employee_id: str = "emp-001",
    manager_approval: bool | None = None,
    attendee_list: str | None = "Alice; Bob",
) -> ExpenseReportRow:
    return ExpenseReportRow(
        employee_id=employee_id,
        expense_date=date(2026, 6, 21),
        expense_category="meals",
        amount=amount,
        currency="USD",
        country="domestic",
        travel_type="domestic",
        business_purpose="Team dinner",
        attendee_list=attendee_list,
        manager_approval=manager_approval,
        receipt_attached=True,
        trip_id="trip-1",
    )


@dataclass(frozen=True)
class ExpenseGoldenCorpusExpectedMetrics:
    outcome_accuracy: GoldenCorpusMetric
    violation_detection: BinaryClassificationMetric
    ambiguous_routing_accuracy: GoldenCorpusMetric
    citation_presence: GoldenCorpusMetric


@dataclass(frozen=True)
class ExpenseGoldenCorpusCase:
    case_id: str
    snapshot: PolicyVersionSnapshot
    expense_rows: list[ExpenseReportRow]
    expected_rows: list[ExpenseGoldenCorpusExpectedRow]
    expected_metrics: ExpenseGoldenCorpusExpectedMetrics


EXPENSE_GOLDEN_CORPUS_CASES = [
    ExpenseGoldenCorpusCase(
        case_id="meal-cap-pass-violation",
        snapshot=PolicyVersionSnapshot(
            policy_version_id="policy-meal-cap-pass-violation",
            change_summary="Meal cap with pass and violation rows.",
            published_by="golden-corpus",
            rules=[_build_enforceable_meal_cap_rule(rule_id="rule-meal-cap-domestic")],
        ),
        expense_rows=[
            _meal_row(amount="42.50", employee_id="emp-001"),
            _meal_row(amount="100.00", employee_id="emp-002"),
        ],
        expected_rows=[
            ExpenseGoldenCorpusExpectedRow(
                row_index=0,
                outcome=ComplianceOutcome.PASS,
            ),
            ExpenseGoldenCorpusExpectedRow(
                row_index=1,
                outcome=ComplianceOutcome.VIOLATION,
                rule_id="rule-meal-cap-domestic",
                matching_rule_ids=["rule-meal-cap-domestic"],
                expects_citation=True,
            ),
        ],
        expected_metrics=ExpenseGoldenCorpusExpectedMetrics(
            outcome_accuracy=GoldenCorpusMetric(correct=2, total=2, accuracy=1.0),
            violation_detection=BinaryClassificationMetric(
                true_positive=1,
                false_positive=0,
                false_negative=0,
                true_negative=1,
                precision=1.0,
                recall=1.0,
            ),
            ambiguous_routing_accuracy=GoldenCorpusMetric(correct=0, total=0, accuracy=1.0),
            citation_presence=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
        ),
    ),
    ExpenseGoldenCorpusCase(
        case_id="meal-cap-guidance-routing",
        snapshot=PolicyVersionSnapshot(
            policy_version_id="policy-meal-cap-guidance-routing",
            change_summary="Enforceable pass with guidance scope match routes to needs_review.",
            published_by="golden-corpus",
            rules=[
                _build_enforceable_meal_cap_rule(rule_id="rule-meal-cap-domestic"),
                _build_meals_guidance_rule(
                    rule_id="rule-meals-guidance",
                    statement="Meals should include itemized receipts when possible.",
                ),
            ],
        ),
        expense_rows=[_meal_row(amount="42.50")],
        expected_rows=[
            ExpenseGoldenCorpusExpectedRow(
                row_index=0,
                outcome=ComplianceOutcome.NEEDS_REVIEW,
                rule_id="rule-meals-guidance",
                matching_rule_ids=["rule-meals-guidance"],
                expects_citation=True,
            ),
        ],
        expected_metrics=ExpenseGoldenCorpusExpectedMetrics(
            outcome_accuracy=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
            violation_detection=BinaryClassificationMetric(
                true_positive=0,
                false_positive=0,
                false_negative=0,
                true_negative=1,
                precision=1.0,
                recall=1.0,
            ),
            ambiguous_routing_accuracy=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
            citation_presence=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
        ),
    ),
    ExpenseGoldenCorpusCase(
        case_id="meal-cap-exception-evidence",
        snapshot=PolicyVersionSnapshot(
            policy_version_id="policy-meal-cap-exception-evidence",
            change_summary="Exception evidence gating for over-cap meals.",
            published_by="golden-corpus",
            rules=[_build_meal_cap_exception_rule(rule_id="rule-meal-cap-exception")],
        ),
        expense_rows=[
            _meal_row(amount="42.50", employee_id="emp-001", manager_approval=False),
            _meal_row(amount="100.00", employee_id="emp-002", manager_approval=True),
            _meal_row(amount="100.00", employee_id="emp-003", manager_approval=False),
        ],
        expected_rows=[
            ExpenseGoldenCorpusExpectedRow(row_index=0, outcome=ComplianceOutcome.PASS),
            ExpenseGoldenCorpusExpectedRow(row_index=1, outcome=ComplianceOutcome.PASS),
            ExpenseGoldenCorpusExpectedRow(
                row_index=2,
                outcome=ComplianceOutcome.MISSING_EVIDENCE,
                rule_id="rule-meal-cap-exception",
                matching_rule_ids=["rule-meal-cap-exception"],
                expects_citation=True,
            ),
        ],
        expected_metrics=ExpenseGoldenCorpusExpectedMetrics(
            outcome_accuracy=GoldenCorpusMetric(correct=3, total=3, accuracy=1.0),
            violation_detection=BinaryClassificationMetric(
                true_positive=0,
                false_positive=0,
                false_negative=0,
                true_negative=3,
                precision=1.0,
                recall=1.0,
            ),
            ambiguous_routing_accuracy=GoldenCorpusMetric(correct=0, total=0, accuracy=1.0),
            citation_presence=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
        ),
    ),
    ExpenseGoldenCorpusCase(
        case_id="precedence-violation-over-guidance",
        snapshot=PolicyVersionSnapshot(
            policy_version_id="policy-precedence-violation-over-guidance",
            change_summary="Violation precedence over guidance needs_review.",
            published_by="golden-corpus",
            rules=[
                _build_enforceable_meal_cap_rule(rule_id="rule-meal-cap-domestic"),
                _build_meals_guidance_rule(
                    rule_id="rule-meals-guidance",
                    statement="Meals should include itemized receipts when possible.",
                ),
            ],
        ),
        expense_rows=[_meal_row(amount="100.00")],
        expected_rows=[
            ExpenseGoldenCorpusExpectedRow(
                row_index=0,
                outcome=ComplianceOutcome.VIOLATION,
                rule_id="rule-meal-cap-domestic",
                matching_rule_ids=["rule-meal-cap-domestic", "rule-meals-guidance"],
                expects_citation=True,
            ),
        ],
        expected_metrics=ExpenseGoldenCorpusExpectedMetrics(
            outcome_accuracy=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
            violation_detection=BinaryClassificationMetric(
                true_positive=1,
                false_positive=0,
                false_negative=0,
                true_negative=0,
                precision=1.0,
                recall=1.0,
            ),
            ambiguous_routing_accuracy=GoldenCorpusMetric(correct=0, total=0, accuracy=1.0),
            citation_presence=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
        ),
    ),
    ExpenseGoldenCorpusCase(
        case_id="precedence-guidance-tiebreak",
        snapshot=PolicyVersionSnapshot(
            policy_version_id="policy-precedence-guidance-tiebreak",
            change_summary="Needs_review tie-break by lowest rule_id.",
            published_by="golden-corpus",
            rules=[
                _build_meals_guidance_rule(
                    rule_id="rule-meals-guidance-a",
                    statement="Meals should include itemized receipts when possible.",
                ),
                _build_meals_guidance_rule(
                    rule_id="rule-meals-guidance-z",
                    statement="Meals should avoid excessive tipping.",
                ),
            ],
        ),
        expense_rows=[_meal_row(amount="42.50")],
        expected_rows=[
            ExpenseGoldenCorpusExpectedRow(
                row_index=0,
                outcome=ComplianceOutcome.NEEDS_REVIEW,
                rule_id="rule-meals-guidance-a",
                matching_rule_ids=["rule-meals-guidance-a", "rule-meals-guidance-z"],
                expects_citation=True,
            ),
        ],
        expected_metrics=ExpenseGoldenCorpusExpectedMetrics(
            outcome_accuracy=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
            violation_detection=BinaryClassificationMetric(
                true_positive=0,
                false_positive=0,
                false_negative=0,
                true_negative=1,
                precision=1.0,
                recall=1.0,
            ),
            ambiguous_routing_accuracy=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
            citation_presence=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
        ),
    ),
    ExpenseGoldenCorpusCase(
        case_id="meal-cap-comparison-baseline",
        snapshot=PolicyVersionSnapshot(
            policy_version_id="policy-meal-cap-comparison-baseline",
            change_summary="Baseline meal cap for compiled rule set comparison.",
            published_by="golden-corpus",
            rules=[_build_enforceable_meal_cap_rule(rule_id="rule-meal-cap-domestic", cap="75")],
        ),
        expense_rows=[_meal_row(amount="100.00")],
        expected_rows=[
            ExpenseGoldenCorpusExpectedRow(
                row_index=0,
                outcome=ComplianceOutcome.VIOLATION,
                rule_id="rule-meal-cap-domestic",
                matching_rule_ids=["rule-meal-cap-domestic"],
                expects_citation=True,
            ),
        ],
        expected_metrics=ExpenseGoldenCorpusExpectedMetrics(
            outcome_accuracy=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
            violation_detection=BinaryClassificationMetric(
                true_positive=1,
                false_positive=0,
                false_negative=0,
                true_negative=0,
                precision=1.0,
                recall=1.0,
            ),
            ambiguous_routing_accuracy=GoldenCorpusMetric(correct=0, total=0, accuracy=1.0),
            citation_presence=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
        ),
    ),
    ExpenseGoldenCorpusCase(
        case_id="meal-cap-comparison-candidate",
        snapshot=PolicyVersionSnapshot(
            policy_version_id="policy-meal-cap-comparison-candidate",
            change_summary="Relaxed meal cap for compiled rule set comparison.",
            published_by="golden-corpus",
            rules=[_build_enforceable_meal_cap_rule(rule_id="rule-meal-cap-domestic", cap="150")],
        ),
        expense_rows=[_meal_row(amount="100.00")],
        expected_rows=[
            ExpenseGoldenCorpusExpectedRow(
                row_index=0,
                outcome=ComplianceOutcome.PASS,
            ),
        ],
        expected_metrics=ExpenseGoldenCorpusExpectedMetrics(
            outcome_accuracy=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
            violation_detection=BinaryClassificationMetric(
                true_positive=0,
                false_positive=0,
                false_negative=0,
                true_negative=1,
                precision=1.0,
                recall=1.0,
            ),
            ambiguous_routing_accuracy=GoldenCorpusMetric(correct=0, total=0, accuracy=1.0),
            citation_presence=GoldenCorpusMetric(correct=0, total=0, accuracy=1.0),
        ),
    ),
    ExpenseGoldenCorpusCase(
        case_id="meal-cap-per-day-aggregation",
        snapshot=PolicyVersionSnapshot(
            policy_version_id="policy-meal-cap-per-day-aggregation",
            change_summary="Two meal rows same employee/day exceed daily cap when summed.",
            published_by="golden-corpus",
            rules=[_build_enforceable_meal_cap_rule(rule_id="rule-meal-cap-domestic")],
        ),
        expense_rows=[
            _meal_row(amount="40.00", employee_id="emp-001"),
            _meal_row(amount="40.00", employee_id="emp-001"),
        ],
        expected_rows=[
            ExpenseGoldenCorpusExpectedRow(
                row_index=0,
                outcome=ComplianceOutcome.VIOLATION,
                rule_id="rule-meal-cap-domestic",
                matching_rule_ids=["rule-meal-cap-domestic"],
                expects_citation=True,
            ),
            ExpenseGoldenCorpusExpectedRow(
                row_index=1,
                outcome=ComplianceOutcome.VIOLATION,
                rule_id="rule-meal-cap-domestic",
                matching_rule_ids=["rule-meal-cap-domestic"],
                expects_citation=True,
            ),
        ],
        expected_metrics=ExpenseGoldenCorpusExpectedMetrics(
            outcome_accuracy=GoldenCorpusMetric(correct=2, total=2, accuracy=1.0),
            violation_detection=BinaryClassificationMetric(
                true_positive=2,
                false_positive=0,
                false_negative=0,
                true_negative=0,
                precision=1.0,
                recall=1.0,
            ),
            ambiguous_routing_accuracy=GoldenCorpusMetric(correct=0, total=0, accuracy=1.0),
            citation_presence=GoldenCorpusMetric(correct=2, total=2, accuracy=1.0),
        ),
    ),
    ExpenseGoldenCorpusCase(
        case_id="lodging-cap-per-night-aggregation",
        snapshot=PolicyVersionSnapshot(
            policy_version_id="policy-lodging-cap-per-night-aggregation",
            change_summary="Lodging rows same employee/date exceed nightly cap when summed.",
            published_by="golden-corpus",
            rules=[
                Rule(
                    rule_id="rule-lodging-night-cap",
                    statement="Lodging is capped at $220 per night.",
                    enforceability_class=EnforceabilityClass.ENFORCEABLE,
                    lifecycle_state=LifecycleState.PUBLISHED,
                    origin=RuleOrigin(
                        source_type=RuleOriginType.MANUAL,
                        rationale="Lodging cap for golden expense corpus.",
                    ),
                    scope=Scope(expense_category="lodging"),
                    condition=RuleCondition(
                        field="lodging.amount",
                        operator="<=",
                        value="220",
                    ),
                    applicability=Applicability(
                        aggregation_period=AggregationPeriod.PER_NIGHT,
                        unit="money",
                        currency="USD",
                    ),
                    citation=Citation(
                        document_id="doc-expense-policy",
                        document_version_id="docv-2026-06-01",
                        section_id="lodging#nightly-cap",
                        quote="Lodging is capped at $220 per night.",
                        start_char=0,
                        end_char=34,
                    ),
                )
            ],
        ),
        expense_rows=[
            ExpenseReportRow(
                employee_id="emp-001",
                expense_date=date(2026, 6, 21),
                expense_category="lodging",
                amount="120.00",
                currency="USD",
                country="domestic",
                travel_type="domestic",
                business_purpose="Conference hotel",
                trip_id=None,
            ),
            ExpenseReportRow(
                employee_id="emp-001",
                expense_date=date(2026, 6, 21),
                expense_category="lodging",
                amount="120.00",
                currency="USD",
                country="domestic",
                travel_type="domestic",
                business_purpose="Conference hotel",
                trip_id=None,
            ),
        ],
        expected_rows=[
            ExpenseGoldenCorpusExpectedRow(
                row_index=0,
                outcome=ComplianceOutcome.VIOLATION,
                rule_id="rule-lodging-night-cap",
                matching_rule_ids=["rule-lodging-night-cap"],
                expects_citation=True,
            ),
            ExpenseGoldenCorpusExpectedRow(
                row_index=1,
                outcome=ComplianceOutcome.VIOLATION,
                rule_id="rule-lodging-night-cap",
                matching_rule_ids=["rule-lodging-night-cap"],
                expects_citation=True,
            ),
        ],
        expected_metrics=ExpenseGoldenCorpusExpectedMetrics(
            outcome_accuracy=GoldenCorpusMetric(correct=2, total=2, accuracy=1.0),
            violation_detection=BinaryClassificationMetric(
                true_positive=2,
                false_positive=0,
                false_negative=0,
                true_negative=0,
                precision=1.0,
                recall=1.0,
            ),
            ambiguous_routing_accuracy=GoldenCorpusMetric(correct=0, total=0, accuracy=1.0),
            citation_presence=GoldenCorpusMetric(correct=2, total=2, accuracy=1.0),
        ),
    ),
    ExpenseGoldenCorpusCase(
        case_id="ground-transport-per-trip-aggregation",
        snapshot=PolicyVersionSnapshot(
            policy_version_id="policy-ground-transport-per-trip-aggregation",
            change_summary="Ground transport rows same trip exceed trip cap when summed.",
            published_by="golden-corpus",
            rules=[
                Rule(
                    rule_id="rule-ground-trip-cap",
                    statement="Ground transportation is capped at $60 per trip.",
                    enforceability_class=EnforceabilityClass.ENFORCEABLE,
                    lifecycle_state=LifecycleState.PUBLISHED,
                    origin=RuleOrigin(
                        source_type=RuleOriginType.MANUAL,
                        rationale="Ground transport cap for golden expense corpus.",
                    ),
                    scope=Scope(expense_category="ground_transportation"),
                    condition=RuleCondition(
                        field="ground_transportation.amount",
                        operator="<=",
                        value="60",
                    ),
                    applicability=Applicability(
                        aggregation_period=AggregationPeriod.PER_TRIP,
                        unit="money",
                        currency="USD",
                    ),
                    citation=Citation(
                        document_id="doc-expense-policy",
                        document_version_id="docv-2026-06-01",
                        section_id="ground-transport#trip-cap",
                        quote="Ground transportation is capped at $60 per trip.",
                        start_char=0,
                        end_char=47,
                    ),
                )
            ],
        ),
        expense_rows=[
            ExpenseReportRow(
                employee_id="emp-001",
                expense_date=date(2026, 6, 21),
                expense_category="ground_transportation",
                amount="30.00",
                currency="USD",
                country="domestic",
                travel_type="domestic",
                business_purpose="Airport taxi",
                trip_id="trip-ground-1",
            ),
            ExpenseReportRow(
                employee_id="emp-001",
                expense_date=date(2026, 6, 21),
                expense_category="ground_transportation",
                amount="35.00",
                currency="USD",
                country="domestic",
                travel_type="domestic",
                business_purpose="Airport taxi",
                trip_id="trip-ground-1",
            ),
        ],
        expected_rows=[
            ExpenseGoldenCorpusExpectedRow(
                row_index=0,
                outcome=ComplianceOutcome.VIOLATION,
                rule_id="rule-ground-trip-cap",
                matching_rule_ids=["rule-ground-trip-cap"],
                expects_citation=True,
            ),
            ExpenseGoldenCorpusExpectedRow(
                row_index=1,
                outcome=ComplianceOutcome.VIOLATION,
                rule_id="rule-ground-trip-cap",
                matching_rule_ids=["rule-ground-trip-cap"],
                expects_citation=True,
            ),
        ],
        expected_metrics=ExpenseGoldenCorpusExpectedMetrics(
            outcome_accuracy=GoldenCorpusMetric(correct=2, total=2, accuracy=1.0),
            violation_detection=BinaryClassificationMetric(
                true_positive=2,
                false_positive=0,
                false_negative=0,
                true_negative=0,
                precision=1.0,
                recall=1.0,
            ),
            ambiguous_routing_accuracy=GoldenCorpusMetric(correct=0, total=0, accuracy=1.0),
            citation_presence=GoldenCorpusMetric(correct=2, total=2, accuracy=1.0),
        ),
    ),
    ExpenseGoldenCorpusCase(
        case_id="meal-cap-per-attendee",
        snapshot=PolicyVersionSnapshot(
            policy_version_id="policy-meal-cap-per-attendee",
            change_summary="Meal cap enforced per attendee share of a single row.",
            published_by="golden-corpus",
            rules=[
                Rule(
                    rule_id="rule-meal-attendee-cap",
                    statement="Meals are capped at $40 per attendee.",
                    enforceability_class=EnforceabilityClass.ENFORCEABLE,
                    lifecycle_state=LifecycleState.PUBLISHED,
                    origin=RuleOrigin(
                        source_type=RuleOriginType.MANUAL,
                        rationale="Per-attendee cap for golden expense corpus.",
                    ),
                    scope=Scope(expense_category="meals"),
                    condition=RuleCondition(field="meal.amount", operator="<=", value="40"),
                    applicability=Applicability(
                        aggregation_period=AggregationPeriod.PER_ATTENDEE,
                        unit="money",
                        currency="USD",
                    ),
                    citation=Citation(
                        document_id="doc-expense-policy",
                        document_version_id="docv-2026-06-01",
                        section_id="meals#attendee-cap",
                        quote="Meals are capped at $40 per attendee.",
                        start_char=0,
                        end_char=34,
                    ),
                )
            ],
        ),
        expense_rows=[_meal_row(amount="90.00", attendee_list="Alice; Bob")],
        expected_rows=[
            ExpenseGoldenCorpusExpectedRow(
                row_index=0,
                outcome=ComplianceOutcome.VIOLATION,
                rule_id="rule-meal-attendee-cap",
                matching_rule_ids=["rule-meal-attendee-cap"],
                expects_citation=True,
            ),
        ],
        expected_metrics=ExpenseGoldenCorpusExpectedMetrics(
            outcome_accuracy=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
            violation_detection=BinaryClassificationMetric(
                true_positive=1,
                false_positive=0,
                false_negative=0,
                true_negative=0,
                precision=1.0,
                recall=1.0,
            ),
            ambiguous_routing_accuracy=GoldenCorpusMetric(correct=0, total=0, accuracy=1.0),
            citation_presence=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
        ),
    ),
    ExpenseGoldenCorpusCase(
        case_id="lodging-receipt-required",
        snapshot=PolicyVersionSnapshot(
            policy_version_id="policy-lodging-receipt-required",
            change_summary="Lodging rows must include receipts.",
            published_by="golden-corpus",
            rules=[
                Rule(
                    rule_id="rule-lodging-receipt",
                    statement="Hotel stays require itemized receipts.",
                    enforceability_class=EnforceabilityClass.ENFORCEABLE,
                    lifecycle_state=LifecycleState.PUBLISHED,
                    origin=RuleOrigin(
                        source_type=RuleOriginType.MANUAL,
                        rationale="Receipt requirement for golden expense corpus.",
                    ),
                    scope=Scope(expense_category="lodging"),
                    condition=RuleCondition(
                        field="receipt_attached",
                        operator="==",
                        value="true",
                    ),
                    applicability=Applicability(
                        aggregation_period=AggregationPeriod.PER_TRANSACTION,
                        unit="count",
                        currency="USD",
                    ),
                    citation=Citation(
                        document_id="doc-expense-policy",
                        document_version_id="docv-2026-06-01",
                        section_id="lodging#receipt-required",
                        quote="Hotel stays require itemized receipts.",
                        start_char=0,
                        end_char=38,
                    ),
                )
            ],
        ),
        expense_rows=[
            ExpenseReportRow(
                employee_id="emp-001",
                expense_date=date(2026, 6, 21),
                expense_category="lodging",
                amount="180.00",
                currency="USD",
                country="domestic",
                travel_type="domestic",
                business_purpose="Conference hotel",
                receipt_attached=True,
                trip_id="trip-lodging",
            ),
            ExpenseReportRow(
                employee_id="emp-002",
                expense_date=date(2026, 6, 21),
                expense_category="lodging",
                amount="180.00",
                currency="USD",
                country="domestic",
                travel_type="domestic",
                business_purpose="Conference hotel",
                receipt_attached=False,
                trip_id="trip-lodging",
            ),
        ],
        expected_rows=[
            ExpenseGoldenCorpusExpectedRow(row_index=0, outcome=ComplianceOutcome.PASS),
            ExpenseGoldenCorpusExpectedRow(
                row_index=1,
                outcome=ComplianceOutcome.VIOLATION,
                rule_id="rule-lodging-receipt",
                matching_rule_ids=["rule-lodging-receipt"],
                expects_citation=True,
            ),
        ],
        expected_metrics=ExpenseGoldenCorpusExpectedMetrics(
            outcome_accuracy=GoldenCorpusMetric(correct=2, total=2, accuracy=1.0),
            violation_detection=BinaryClassificationMetric(
                true_positive=1,
                false_positive=0,
                false_negative=0,
                true_negative=1,
                precision=1.0,
                recall=1.0,
            ),
            ambiguous_routing_accuracy=GoldenCorpusMetric(correct=0, total=0, accuracy=1.0),
            citation_presence=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
        ),
    ),
    ExpenseGoldenCorpusCase(
        case_id="submission-age-timeliness",
        snapshot=PolicyVersionSnapshot(
            policy_version_id="policy-submission-age-timeliness",
            change_summary="Expense reports must be submitted within 30 days.",
            published_by="golden-corpus",
            rules=[
                Rule(
                    rule_id="rule-submission-30-days",
                    statement="Expense reports must be submitted within 30 days.",
                    enforceability_class=EnforceabilityClass.ENFORCEABLE,
                    lifecycle_state=LifecycleState.PUBLISHED,
                    origin=RuleOrigin(
                        source_type=RuleOriginType.MANUAL,
                        rationale="Timeliness rule for golden expense corpus.",
                    ),
                    scope=Scope(expense_category="meals"),
                    condition=RuleCondition(
                        field="expense_report.submission_days",
                        operator="<=",
                        value="30",
                    ),
                    applicability=Applicability(
                        aggregation_period=AggregationPeriod.PER_TRANSACTION,
                        unit="count",
                        currency="USD",
                    ),
                    citation=Citation(
                        document_id="doc-expense-policy",
                        document_version_id="docv-2026-06-01",
                        section_id="expense-report#timeliness",
                        quote="Expense reports must be submitted within 30 days.",
                        start_char=0,
                        end_char=48,
                    ),
                )
            ],
        ),
        expense_rows=[
            _meal_row(amount="42.50", employee_id="emp-001").model_copy(
                update={"submission_days": 15}
            ),
            _meal_row(amount="42.50", employee_id="emp-002").model_copy(
                update={"submission_days": 45}
            ),
        ],
        expected_rows=[
            ExpenseGoldenCorpusExpectedRow(row_index=0, outcome=ComplianceOutcome.PASS),
            ExpenseGoldenCorpusExpectedRow(
                row_index=1,
                outcome=ComplianceOutcome.VIOLATION,
                rule_id="rule-submission-30-days",
                matching_rule_ids=["rule-submission-30-days"],
                expects_citation=True,
            ),
        ],
        expected_metrics=ExpenseGoldenCorpusExpectedMetrics(
            outcome_accuracy=GoldenCorpusMetric(correct=2, total=2, accuracy=1.0),
            violation_detection=BinaryClassificationMetric(
                true_positive=1,
                false_positive=0,
                false_negative=0,
                true_negative=1,
                precision=1.0,
                recall=1.0,
            ),
            ambiguous_routing_accuracy=GoldenCorpusMetric(correct=0, total=0, accuracy=1.0),
            citation_presence=GoldenCorpusMetric(correct=1, total=1, accuracy=1.0),
        ),
    ),
]

COMPARISON_CORPUS_CASE_IDS = (
    "meal-cap-comparison-baseline",
    "meal-cap-comparison-candidate",
)
