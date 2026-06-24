from __future__ import annotations

from datetime import UTC, datetime

import pytest

from policy_pipeline.compiled_rule_sets.compiler import compile_policy_version_snapshot
from policy_pipeline.compliance_evaluation_runs.evaluation import (
    build_case_evaluation,
    compare_compiled_rule_set_quality,
    evaluate_golden_expense_corpus,
)
from policy_pipeline.compliance_evaluation_runs.golden_corpus import (
    COMPARISON_CORPUS_CASE_IDS,
    EXPENSE_GOLDEN_CORPUS_CASES,
    ExpenseGoldenCorpusCase,
)

_GOLDEN_CORPUS_TIMESTAMP = datetime(2026, 6, 22, 12, 0, tzinfo=UTC)
_FIXTURE_CASES = [
    case
    for case in EXPENSE_GOLDEN_CORPUS_CASES
    if case.case_id not in COMPARISON_CORPUS_CASE_IDS
]


def _evaluate_case(case: ExpenseGoldenCorpusCase):
    compiled_rule_set = compile_policy_version_snapshot(
        case.snapshot,
        compiled_rule_set_id=f"compiled-{case.case_id}",
        compiled_by="golden-corpus",
        compiled_at=_GOLDEN_CORPUS_TIMESTAMP,
    )
    return build_case_evaluation(
        case_id=case.case_id,
        compiled_rule_set=compiled_rule_set,
        expected_rows=case.expected_rows,
        expense_rows=case.expense_rows,
    )


def test_evaluate_golden_expense_corpus_reports_expected_metrics() -> None:
    report = evaluate_golden_expense_corpus(
        [_evaluate_case(case) for case in _FIXTURE_CASES],
        compiled_rule_set_id="golden-corpus-fixture",
        policy_version_id="golden-corpus-fixture",
    )

    assert [case.case_id for case in report.cases] == [
        "meal-cap-pass-violation",
        "meal-cap-guidance-routing",
        "meal-cap-exception-evidence",
        "precedence-violation-over-guidance",
        "precedence-guidance-tiebreak",
        "meal-cap-per-day-aggregation",
        "lodging-cap-per-night-aggregation",
        "ground-transport-per-trip-aggregation",
        "meal-cap-per-attendee",
        "lodging-receipt-required",
        "submission-age-timeliness",
    ]
    assert report.outcome_accuracy.correct == 19
    assert report.outcome_accuracy.total == 19
    assert report.outcome_accuracy.accuracy == 1.0
    assert report.violation_detection.precision == 1.0
    assert report.violation_detection.recall == 1.0
    assert report.ambiguous_routing_accuracy.accuracy == 1.0
    assert report.citation_presence.accuracy == 1.0


def test_golden_corpus_expected_metrics_match_report() -> None:
    report = evaluate_golden_expense_corpus(
        [_evaluate_case(case) for case in _FIXTURE_CASES],
        compiled_rule_set_id="golden-corpus-fixture",
        policy_version_id="golden-corpus-fixture",
    )
    cases_by_id = {case.case_id: case for case in report.cases}

    for corpus_case in _FIXTURE_CASES:
        case_report = cases_by_id[corpus_case.case_id]
        expected = corpus_case.expected_metrics

        assert case_report.outcome_accuracy == expected.outcome_accuracy
        assert case_report.violation_detection == expected.violation_detection
        assert case_report.ambiguous_routing_accuracy == expected.ambiguous_routing_accuracy
        assert case_report.citation_presence == expected.citation_presence


@pytest.mark.parametrize(
    "case",
    _FIXTURE_CASES,
    ids=lambda case: case.case_id,
)
def test_golden_expense_corpus_case_matches_expected_outcomes(
    case: ExpenseGoldenCorpusCase,
) -> None:
    evaluation = _evaluate_case(case)
    expected_by_index = {
        expected_row.row_index: expected_row for expected_row in case.expected_rows
    }
    for actual_row in evaluation.actual_rows:
        expected_row = expected_by_index[actual_row.row_index]
        assert actual_row.outcome is expected_row.outcome
        assert actual_row.rule_id == expected_row.rule_id
        assert actual_row.matching_rule_ids == expected_row.matching_rule_ids
        if expected_row.expects_citation:
            assert len(actual_row.evidence) > 0


def test_compare_compiled_rule_sets_detects_violation_recall_regression() -> None:
    baseline_case = next(
        case
        for case in EXPENSE_GOLDEN_CORPUS_CASES
        if case.case_id == "meal-cap-comparison-baseline"
    )
    candidate_case = next(
        case
        for case in EXPENSE_GOLDEN_CORPUS_CASES
        if case.case_id == "meal-cap-comparison-candidate"
    )
    baseline_report = evaluate_golden_expense_corpus(
        [_evaluate_case(baseline_case)],
    )
    candidate_report = evaluate_golden_expense_corpus(
        [_evaluate_case(candidate_case)],
    )
    comparison = compare_compiled_rule_set_quality(
        baseline=baseline_report,
        candidate=candidate_report,
    )

    assert comparison.baseline.violation_detection.recall == 1.0
    assert comparison.candidate.violation_detection.recall == 1.0
    assert comparison.baseline.violation_detection.true_positive == 1
    assert comparison.candidate.violation_detection.true_positive == 0
    assert comparison.delta.violation_recall == 0.0


def test_golden_expense_corpus_smoke() -> None:
    report = evaluate_golden_expense_corpus(
        [
            build_case_evaluation(
                case_id=case.case_id,
                compiled_rule_set=compile_policy_version_snapshot(
                    case.snapshot,
                    compiled_rule_set_id=f"compiled-{case.case_id}",
                    compiled_by="golden-corpus",
                    compiled_at=_GOLDEN_CORPUS_TIMESTAMP,
                ),
                expected_rows=case.expected_rows,
                expense_rows=case.expense_rows,
            )
            for case in _FIXTURE_CASES
        ],
        compiled_rule_set_id="golden-corpus-fixture",
        policy_version_id="golden-corpus-fixture",
    )
    assert report.outcome_accuracy.accuracy == 1.0
