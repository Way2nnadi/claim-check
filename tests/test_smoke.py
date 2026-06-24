from datetime import UTC, datetime

from policy_pipeline.compiled_rule_sets.compiler import compile_policy_version_snapshot
from policy_pipeline.compliance_evaluation_runs.evaluation import (
    build_case_evaluation,
    evaluate_golden_expense_corpus,
)
from policy_pipeline.compliance_evaluation_runs.golden_corpus import (
    COMPARISON_CORPUS_CASE_IDS,
    EXPENSE_GOLDEN_CORPUS_CASES,
)

_GOLDEN_CORPUS_TIMESTAMP = datetime(2026, 6, 22, 12, 0, tzinfo=UTC)


def test_smoke() -> None:
    fixture_cases = [
        case
        for case in EXPENSE_GOLDEN_CORPUS_CASES
        if case.case_id not in COMPARISON_CORPUS_CASE_IDS
    ]
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
            for case in fixture_cases
        ],
        compiled_rule_set_id="golden-corpus-fixture",
        policy_version_id="golden-corpus-fixture",
    )
    assert report.outcome_accuracy.accuracy == 1.0
