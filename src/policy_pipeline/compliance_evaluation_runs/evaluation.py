from __future__ import annotations

from collections.abc import Sequence

from pydantic import BaseModel, Field

from policy_pipeline.compiled_rule_sets.models import CompiledRuleSet
from policy_pipeline.compliance_evaluation_runs.models import (
    ComplianceEvaluationRowOutcome,
    ComplianceOutcome,
)
from policy_pipeline.compliance_evaluation_runs.runner import (
    evaluate_compliance_for_expense_rows,
)
from policy_pipeline.extraction.evaluation import GoldenCorpusMetric


class BinaryClassificationMetric(BaseModel):
    true_positive: int = Field(ge=0)
    false_positive: int = Field(ge=0)
    false_negative: int = Field(ge=0)
    true_negative: int = Field(ge=0)
    precision: float = Field(ge=0.0, le=1.0)
    recall: float = Field(ge=0.0, le=1.0)


class ExpenseGoldenCorpusExpectedRow(BaseModel):
    row_index: int = Field(ge=0)
    outcome: ComplianceOutcome
    rule_id: str | None = None
    matching_rule_ids: list[str] = Field(default_factory=list)
    expects_citation: bool = False


class ExpenseGoldenCorpusCaseEvaluation(BaseModel):
    case_id: str = Field(min_length=1)
    compiled_rule_set_id: str = Field(min_length=1)
    policy_version_id: str = Field(min_length=1)
    expected_rows: list[ExpenseGoldenCorpusExpectedRow] = Field(default_factory=list)
    actual_rows: list[ComplianceEvaluationRowOutcome] = Field(default_factory=list)


class ComplianceEvaluationQualityCaseReport(BaseModel):
    case_id: str = Field(min_length=1)
    compiled_rule_set_id: str = Field(min_length=1)
    policy_version_id: str = Field(min_length=1)
    outcome_accuracy: GoldenCorpusMetric
    violation_detection: BinaryClassificationMetric
    ambiguous_routing_accuracy: GoldenCorpusMetric
    citation_presence: GoldenCorpusMetric


class ComplianceEvaluationQualityReport(BaseModel):
    compiled_rule_set_id: str = Field(min_length=1)
    policy_version_id: str = Field(min_length=1)
    cases: list[ComplianceEvaluationQualityCaseReport] = Field(default_factory=list)
    outcome_accuracy: GoldenCorpusMetric
    violation_detection: BinaryClassificationMetric
    ambiguous_routing_accuracy: GoldenCorpusMetric
    citation_presence: GoldenCorpusMetric


class ComplianceEvaluationQualityMetricDelta(BaseModel):
    outcome_accuracy: float
    violation_precision: float
    violation_recall: float
    ambiguous_routing_accuracy: float
    citation_presence: float


class ComplianceEvaluationQualityComparison(BaseModel):
    baseline_compiled_rule_set_id: str = Field(min_length=1)
    candidate_compiled_rule_set_id: str = Field(min_length=1)
    baseline: ComplianceEvaluationQualityReport
    candidate: ComplianceEvaluationQualityReport
    delta: ComplianceEvaluationQualityMetricDelta


def evaluate_golden_expense_corpus(
    evaluations: Sequence[ExpenseGoldenCorpusCaseEvaluation],
    *,
    compiled_rule_set_id: str | None = None,
    policy_version_id: str | None = None,
) -> ComplianceEvaluationQualityReport:
    if not evaluations:
        raise ValueError("At least one golden expense corpus evaluation is required.")

    case_reports = [_evaluate_case(evaluation) for evaluation in evaluations]
    return ComplianceEvaluationQualityReport(
        compiled_rule_set_id=compiled_rule_set_id or evaluations[0].compiled_rule_set_id,
        policy_version_id=policy_version_id or evaluations[0].policy_version_id,
        cases=case_reports,
        outcome_accuracy=_aggregate_golden_metric(case_reports, "outcome_accuracy"),
        violation_detection=_aggregate_binary_metric(case_reports, "violation_detection"),
        ambiguous_routing_accuracy=_aggregate_golden_metric(
            case_reports,
            "ambiguous_routing_accuracy",
        ),
        citation_presence=_aggregate_golden_metric(case_reports, "citation_presence"),
    )


def compare_compiled_rule_set_quality(
    *,
    baseline: ComplianceEvaluationQualityReport,
    candidate: ComplianceEvaluationQualityReport,
) -> ComplianceEvaluationQualityComparison:
    return ComplianceEvaluationQualityComparison(
        baseline_compiled_rule_set_id=baseline.compiled_rule_set_id,
        candidate_compiled_rule_set_id=candidate.compiled_rule_set_id,
        baseline=baseline,
        candidate=candidate,
        delta=ComplianceEvaluationQualityMetricDelta(
            outcome_accuracy=(
                candidate.outcome_accuracy.accuracy - baseline.outcome_accuracy.accuracy
            ),
            violation_precision=(
                candidate.violation_detection.precision
                - baseline.violation_detection.precision
            ),
            violation_recall=(
                candidate.violation_detection.recall - baseline.violation_detection.recall
            ),
            ambiguous_routing_accuracy=(
                candidate.ambiguous_routing_accuracy.accuracy
                - baseline.ambiguous_routing_accuracy.accuracy
            ),
            citation_presence=(
                candidate.citation_presence.accuracy - baseline.citation_presence.accuracy
            ),
        ),
    )


def build_case_evaluation(
    *,
    case_id: str,
    compiled_rule_set: CompiledRuleSet,
    expected_rows: Sequence[ExpenseGoldenCorpusExpectedRow],
    expense_rows,
) -> ExpenseGoldenCorpusCaseEvaluation:
    actual_rows = evaluate_compliance_for_expense_rows(compiled_rule_set, expense_rows)
    return ExpenseGoldenCorpusCaseEvaluation(
        case_id=case_id,
        compiled_rule_set_id=compiled_rule_set.compiled_rule_set_id,
        policy_version_id=compiled_rule_set.policy_version_id,
        expected_rows=list(expected_rows),
        actual_rows=actual_rows,
    )


def _evaluate_case(
    evaluation: ExpenseGoldenCorpusCaseEvaluation,
) -> ComplianceEvaluationQualityCaseReport:
    expected_by_index = {
        expected_row.row_index: expected_row for expected_row in evaluation.expected_rows
    }
    actual_by_index = {actual_row.row_index: actual_row for actual_row in evaluation.actual_rows}

    outcome_correct = 0
    violation_tp = violation_fp = violation_fn = violation_tn = 0
    ambiguous_correct = ambiguous_total = 0
    citation_correct = citation_total = 0

    for row_index, expected_row in expected_by_index.items():
        actual_row = actual_by_index[row_index]
        if actual_row.outcome is expected_row.outcome:
            outcome_correct += 1

        expected_violation = expected_row.outcome is ComplianceOutcome.VIOLATION
        actual_violation = actual_row.outcome is ComplianceOutcome.VIOLATION
        if expected_violation and actual_violation:
            violation_tp += 1
        elif not expected_violation and actual_violation:
            violation_fp += 1
        elif expected_violation and not actual_violation:
            violation_fn += 1
        else:
            violation_tn += 1

        if expected_row.outcome is ComplianceOutcome.NEEDS_REVIEW:
            ambiguous_total += 1
            if actual_row.outcome is ComplianceOutcome.NEEDS_REVIEW:
                ambiguous_correct += 1

        if expected_row.expects_citation:
            citation_total += 1
            if len(actual_row.evidence) > 0:
                citation_correct += 1

    row_count = len(expected_by_index)
    return ComplianceEvaluationQualityCaseReport(
        case_id=evaluation.case_id,
        compiled_rule_set_id=evaluation.compiled_rule_set_id,
        policy_version_id=evaluation.policy_version_id,
        outcome_accuracy=_golden_metric(outcome_correct, row_count),
        violation_detection=_binary_metric(
            violation_tp,
            violation_fp,
            violation_fn,
            violation_tn,
        ),
        ambiguous_routing_accuracy=_golden_metric(ambiguous_correct, ambiguous_total),
        citation_presence=_golden_metric(citation_correct, citation_total),
    )


def _aggregate_golden_metric(
    case_reports: Sequence[ComplianceEvaluationQualityCaseReport],
    field_name: str,
) -> GoldenCorpusMetric:
    correct = sum(getattr(case_report, field_name).correct for case_report in case_reports)
    total = sum(getattr(case_report, field_name).total for case_report in case_reports)
    return _golden_metric(correct, total)


def _aggregate_binary_metric(
    case_reports: Sequence[ComplianceEvaluationQualityCaseReport],
    field_name: str,
) -> BinaryClassificationMetric:
    true_positive = sum(
        getattr(case_report, field_name).true_positive for case_report in case_reports
    )
    false_positive = sum(
        getattr(case_report, field_name).false_positive for case_report in case_reports
    )
    false_negative = sum(
        getattr(case_report, field_name).false_negative for case_report in case_reports
    )
    true_negative = sum(
        getattr(case_report, field_name).true_negative for case_report in case_reports
    )
    return _binary_metric(true_positive, false_positive, false_negative, true_negative)


def _golden_metric(correct: int, total: int) -> GoldenCorpusMetric:
    if total == 0:
        return GoldenCorpusMetric(correct=0, total=0, accuracy=1.0)
    return GoldenCorpusMetric(correct=correct, total=total, accuracy=correct / total)


def _binary_metric(
    true_positive: int,
    false_positive: int,
    false_negative: int,
    true_negative: int,
) -> BinaryClassificationMetric:
    precision_denominator = true_positive + false_positive
    recall_denominator = true_positive + false_negative
    precision = (
        true_positive / precision_denominator if precision_denominator > 0 else 1.0
    )
    recall = true_positive / recall_denominator if recall_denominator > 0 else 1.0
    return BinaryClassificationMetric(
        true_positive=true_positive,
        false_positive=false_positive,
        false_negative=false_negative,
        true_negative=true_negative,
        precision=precision,
        recall=recall,
    )
