from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from policy_pipeline.compiled_rule_sets.compiler import compile_policy_version_snapshot
from policy_pipeline.compiled_rule_sets.store import get_compiled_rule_set
from policy_pipeline.compliance_evaluation_runs.evaluation import (
    ComplianceEvaluationQualityComparison,
    ComplianceEvaluationQualityReport,
    build_case_evaluation,
    compare_compiled_rule_set_quality,
    evaluate_golden_expense_corpus,
)
from policy_pipeline.compliance_evaluation_runs.runner import (
    CompiledRuleSetNotFoundError,
    NoCompiledRulesError,
)
from policy_pipeline.compliance_evaluation_runs.golden_corpus import (
    COMPARISON_CORPUS_CASE_IDS,
    EXPENSE_GOLDEN_CORPUS_CASES,
    ExpenseGoldenCorpusCase,
)


def corpus_cases_for_policy_version(
    policy_version_id: str,
) -> list[ExpenseGoldenCorpusCase]:
    return [
        case
        for case in EXPENSE_GOLDEN_CORPUS_CASES
        if case.snapshot.policy_version_id == policy_version_id
    ]


def generate_fixture_quality_report(
    *,
    compiled_at: datetime | None = None,
) -> ComplianceEvaluationQualityReport:
    evaluations = [
        _evaluate_fixture_case(case, compiled_at=compiled_at)
        for case in EXPENSE_GOLDEN_CORPUS_CASES
        if case.case_id not in COMPARISON_CORPUS_CASE_IDS
    ]
    return evaluate_golden_expense_corpus(
        evaluations,
        compiled_rule_set_id="golden-corpus-fixture",
        policy_version_id="golden-corpus-fixture",
    )


def generate_quality_report_for_compiled_rule_set(
    session: Session,
    *,
    policy_version_id: str,
    compiled_rule_set_id: str,
) -> ComplianceEvaluationQualityReport:
    compiled_rule_set = get_compiled_rule_set(
        session,
        compiled_rule_set_id=compiled_rule_set_id,
    )
    if compiled_rule_set is None:
        raise CompiledRuleSetNotFoundError(compiled_rule_set_id)
    if compiled_rule_set.policy_version_id != policy_version_id:
        raise PolicyVersionCompiledRuleSetMismatchError(
            policy_version_id,
            compiled_rule_set_id,
        )

    corpus_cases = corpus_cases_for_policy_version(policy_version_id)
    if not corpus_cases:
        raise GoldenCorpusCaseNotFoundError(policy_version_id)

    evaluations = [
        build_case_evaluation(
            case_id=case.case_id,
            compiled_rule_set=compiled_rule_set,
            expected_rows=case.expected_rows,
            expense_rows=case.expense_rows,
        )
        for case in corpus_cases
    ]
    return evaluate_golden_expense_corpus(evaluations)


def compare_quality_reports_for_compiled_rule_sets(
    session: Session,
    *,
    baseline_compiled_rule_set_id: str,
    candidate_compiled_rule_set_id: str,
) -> ComplianceEvaluationQualityComparison:
    baseline = _quality_report_for_compiled_rule_set_id(
        session,
        compiled_rule_set_id=baseline_compiled_rule_set_id,
    )
    candidate = _quality_report_for_compiled_rule_set_id(
        session,
        compiled_rule_set_id=candidate_compiled_rule_set_id,
    )
    return compare_compiled_rule_set_quality(baseline=baseline, candidate=candidate)


def _quality_report_for_compiled_rule_set_id(
    session: Session,
    *,
    compiled_rule_set_id: str,
) -> ComplianceEvaluationQualityReport:
    compiled_rule_set = get_compiled_rule_set(
        session,
        compiled_rule_set_id=compiled_rule_set_id,
    )
    if compiled_rule_set is None:
        raise CompiledRuleSetNotFoundError(compiled_rule_set_id)

    corpus_cases = corpus_cases_for_policy_version(compiled_rule_set.policy_version_id)
    if not corpus_cases:
        raise GoldenCorpusCaseNotFoundError(compiled_rule_set.policy_version_id)

    evaluations = [
        build_case_evaluation(
            case_id=case.case_id,
            compiled_rule_set=compiled_rule_set,
            expected_rows=case.expected_rows,
            expense_rows=case.expense_rows,
        )
        for case in corpus_cases
    ]
    return evaluate_golden_expense_corpus(evaluations)


def _evaluate_fixture_case(
    case: ExpenseGoldenCorpusCase,
    *,
    compiled_at: datetime | None,
) -> object:
    timestamp = compiled_at or datetime(2026, 6, 22, 12, 0, tzinfo=UTC)
    compiled_rule_set = compile_policy_version_snapshot(
        case.snapshot,
        compiled_rule_set_id=f"compiled-{case.case_id}",
        compiled_by="golden-corpus",
        compiled_at=timestamp,
    )
    return build_case_evaluation(
        case_id=case.case_id,
        compiled_rule_set=compiled_rule_set,
        expected_rows=case.expected_rows,
        expense_rows=case.expense_rows,
    )


class PolicyVersionCompiledRuleSetMismatchError(Exception):
    def __init__(self, policy_version_id: str, compiled_rule_set_id: str) -> None:
        self.policy_version_id = policy_version_id
        self.compiled_rule_set_id = compiled_rule_set_id
        super().__init__(policy_version_id, compiled_rule_set_id)


class GoldenCorpusCaseNotFoundError(Exception):
    def __init__(self, policy_version_id: str) -> None:
        self.policy_version_id = policy_version_id
        super().__init__(policy_version_id)


__all__ = [
    "CompiledRuleSetNotFoundError",
    "GoldenCorpusCaseNotFoundError",
    "NoCompiledRulesError",
    "PolicyVersionCompiledRuleSetMismatchError",
    "compare_quality_reports_for_compiled_rule_sets",
    "generate_fixture_quality_report",
    "generate_quality_report_for_compiled_rule_set",
]
