from __future__ import annotations

from collections.abc import Sequence

from pydantic import BaseModel, Field

from policy_pipeline.compiled_rule_sets.models import CompiledRuleSetSummary
from policy_pipeline.rule_test_cases.models import (
    RuleTestCase,
    RuleTestCaseVariant,
    RuleTestRun,
    RuleTestRunSummary,
)


class RuleTestCaseGoldenCorpusGenerationMetrics(BaseModel):
    total_count: int = Field(ge=0)
    positive_count: int = Field(ge=0)
    negative_count: int = Field(ge=0)
    boundary_count: int = Field(ge=0)
    exception_count: int = Field(ge=0)


class RuleTestCaseGoldenCorpusCaseEvaluation(BaseModel):
    case_id: str = Field(min_length=1)
    compile_summary: CompiledRuleSetSummary
    generated_cases: list[RuleTestCase] = Field(default_factory=list)
    rule_test_run: RuleTestRun


class RuleTestCaseGoldenCorpusCaseReport(BaseModel):
    case_id: str = Field(min_length=1)
    compile_summary: CompiledRuleSetSummary
    generation: RuleTestCaseGoldenCorpusGenerationMetrics
    run: RuleTestRunSummary


class RuleTestCaseGoldenCorpusEvaluationReport(BaseModel):
    cases: list[RuleTestCaseGoldenCorpusCaseReport] = Field(default_factory=list)
    compile_summary: CompiledRuleSetSummary
    generation: RuleTestCaseGoldenCorpusGenerationMetrics
    run: RuleTestRunSummary


def evaluate_golden_corpus(
    evaluations: Sequence[RuleTestCaseGoldenCorpusCaseEvaluation],
) -> RuleTestCaseGoldenCorpusEvaluationReport:
    case_reports = [_evaluate_case(evaluation) for evaluation in evaluations]
    return RuleTestCaseGoldenCorpusEvaluationReport(
        cases=case_reports,
        compile_summary=_aggregate_compile_summary(case_reports),
        generation=_aggregate_generation_metrics(case_reports),
        run=_aggregate_run_summary(case_reports),
    )


def _evaluate_case(
    evaluation: RuleTestCaseGoldenCorpusCaseEvaluation,
) -> RuleTestCaseGoldenCorpusCaseReport:
    return RuleTestCaseGoldenCorpusCaseReport(
        case_id=evaluation.case_id,
        compile_summary=evaluation.compile_summary,
        generation=_generation_metrics(evaluation.generated_cases),
        run=evaluation.rule_test_run.summary,
    )


def _generation_metrics(cases: Sequence[RuleTestCase]) -> RuleTestCaseGoldenCorpusGenerationMetrics:
    return RuleTestCaseGoldenCorpusGenerationMetrics(
        total_count=len(cases),
        positive_count=sum(
            1 for case in cases if case.variant is RuleTestCaseVariant.POSITIVE
        ),
        negative_count=sum(
            1 for case in cases if case.variant is RuleTestCaseVariant.NEGATIVE
        ),
        boundary_count=sum(
            1 for case in cases if case.variant is RuleTestCaseVariant.BOUNDARY
        ),
        exception_count=sum(
            1 for case in cases if case.variant is RuleTestCaseVariant.EXCEPTION
        ),
    )


def _aggregate_compile_summary(
    case_reports: Sequence[RuleTestCaseGoldenCorpusCaseReport],
) -> CompiledRuleSetSummary:
    return CompiledRuleSetSummary(
        compiled=sum(case.compile_summary.compiled for case in case_reports),
        skipped_non_enforceable=sum(
            case.compile_summary.skipped_non_enforceable for case in case_reports
        ),
        compile_error=sum(case.compile_summary.compile_error for case in case_reports),
    )


def _aggregate_generation_metrics(
    case_reports: Sequence[RuleTestCaseGoldenCorpusCaseReport],
) -> RuleTestCaseGoldenCorpusGenerationMetrics:
    return RuleTestCaseGoldenCorpusGenerationMetrics(
        total_count=sum(case.generation.total_count for case in case_reports),
        positive_count=sum(case.generation.positive_count for case in case_reports),
        negative_count=sum(case.generation.negative_count for case in case_reports),
        boundary_count=sum(case.generation.boundary_count for case in case_reports),
        exception_count=sum(case.generation.exception_count for case in case_reports),
    )


def _aggregate_run_summary(
    case_reports: Sequence[RuleTestCaseGoldenCorpusCaseReport],
) -> RuleTestRunSummary:
    total_count = sum(case.run.total_count for case in case_reports)
    passed_count = sum(case.run.passed_count for case in case_reports)
    failed_count = sum(case.run.failed_count for case in case_reports)
    return RuleTestRunSummary(
        total_count=total_count,
        passed_count=passed_count,
        failed_count=failed_count,
        overall_passed=failed_count == 0,
    )
