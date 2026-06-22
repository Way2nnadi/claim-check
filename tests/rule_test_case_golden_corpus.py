"""Golden Rule Test Case corpus fixtures for compiler and runner regression tests.

How to add a corpus case
------------------------
1. Add a ``RuleTestCaseGoldenCorpusCase`` to ``RULE_TEST_CASE_GOLDEN_CORPUS_CASES``.
2. Build a ``PolicyVersionSnapshot`` with the Rules you want to compile. Reuse the
   rule builders from ``tests.test_compiled_rule_sets_compiler`` and
   ``tests.test_rule_test_cases_generator`` when possible.
3. Set ``expected`` compile, generation, and run metrics to the values produced by
   the current compiler, generator, and runner. Run
   ``pytest tests/test_rule_test_case_evaluation.py -vv`` to capture actual output
   when adding a new case.
4. Prefer one happy-path case (numeric threshold rule) and one edge case (exceptions,
   string conditions, or compile partitioning) so regressions surface in CI.
"""

from __future__ import annotations

from dataclasses import dataclass

from policy_pipeline.rules.models import PolicyVersionSnapshot
from tests.test_compiled_rule_sets_compiler import _build_enforceable_rule, _build_guidance_rule
from tests.test_rule_test_cases_generator import _build_meal_cap_rule_with_exception


@dataclass(frozen=True)
class RuleTestCaseGoldenCorpusExpectedCompileMetrics:
    compiled: int
    skipped_non_enforceable: int
    compile_error: int


@dataclass(frozen=True)
class RuleTestCaseGoldenCorpusExpectedGenerationMetrics:
    total_count: int
    positive_count: int
    negative_count: int
    boundary_count: int
    exception_count: int


@dataclass(frozen=True)
class RuleTestCaseGoldenCorpusExpectedRunMetrics:
    total_count: int
    passed_count: int
    failed_count: int
    overall_passed: bool


@dataclass(frozen=True)
class RuleTestCaseGoldenCorpusExpectedMetrics:
    compile: RuleTestCaseGoldenCorpusExpectedCompileMetrics
    generation: RuleTestCaseGoldenCorpusExpectedGenerationMetrics
    run: RuleTestCaseGoldenCorpusExpectedRunMetrics


@dataclass(frozen=True)
class RuleTestCaseGoldenCorpusCase:
    case_id: str
    snapshot: PolicyVersionSnapshot
    expected: RuleTestCaseGoldenCorpusExpectedMetrics


RULE_TEST_CASE_GOLDEN_CORPUS_CASES = [
    RuleTestCaseGoldenCorpusCase(
        case_id="meal-cap-happy-path",
        snapshot=PolicyVersionSnapshot(
            policy_version_id="policy-meal-cap-happy-path",
            change_summary="Happy-path meal cap with guidance-only rule skipped.",
            published_by="golden-corpus",
            rules=[
                _build_enforceable_rule(rule_id="rule-meal-cap-domestic"),
                _build_guidance_rule(rule_id="rule-lodging-guidance"),
            ],
        ),
        expected=RuleTestCaseGoldenCorpusExpectedMetrics(
            compile=RuleTestCaseGoldenCorpusExpectedCompileMetrics(
                compiled=1,
                skipped_non_enforceable=1,
                compile_error=0,
            ),
            generation=RuleTestCaseGoldenCorpusExpectedGenerationMetrics(
                total_count=3,
                positive_count=1,
                negative_count=1,
                boundary_count=1,
                exception_count=0,
            ),
            run=RuleTestCaseGoldenCorpusExpectedRunMetrics(
                total_count=3,
                passed_count=3,
                failed_count=0,
                overall_passed=True,
            ),
        ),
    ),
    RuleTestCaseGoldenCorpusCase(
        case_id="meal-cap-exception-edge",
        snapshot=PolicyVersionSnapshot(
            policy_version_id="policy-meal-cap-exception-edge",
            change_summary="Meal cap with manager-approval exception evidence edge case.",
            published_by="golden-corpus",
            rules=[_build_meal_cap_rule_with_exception(rule_id="rule-meal-cap-exception")],
        ),
        expected=RuleTestCaseGoldenCorpusExpectedMetrics(
            compile=RuleTestCaseGoldenCorpusExpectedCompileMetrics(
                compiled=1,
                skipped_non_enforceable=0,
                compile_error=0,
            ),
            generation=RuleTestCaseGoldenCorpusExpectedGenerationMetrics(
                total_count=5,
                positive_count=1,
                negative_count=1,
                boundary_count=1,
                exception_count=2,
            ),
            run=RuleTestCaseGoldenCorpusExpectedRunMetrics(
                total_count=5,
                passed_count=5,
                failed_count=0,
                overall_passed=True,
            ),
        ),
    ),
]
