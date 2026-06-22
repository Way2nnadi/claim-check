from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from policy_pipeline.compiled_rule_sets.compiler import compile_policy_version_snapshot
from policy_pipeline.compiled_rule_sets.records import CompiledRuleSetRecord
from policy_pipeline.rule_test_cases.evaluation import (
    RuleTestCaseGoldenCorpusCaseEvaluation,
    evaluate_golden_corpus,
)
from policy_pipeline.rule_test_cases.generator import generate_rule_test_cases
from policy_pipeline.rule_test_cases.records import RuleTestCaseRecord
from policy_pipeline.rule_test_cases.runner import execute_rule_test_run
from policy_pipeline.shared.database import Base
from tests.rule_test_case_golden_corpus import (
    RULE_TEST_CASE_GOLDEN_CORPUS_CASES,
    RuleTestCaseGoldenCorpusCase,
)

_GOLDEN_CORPUS_TIMESTAMP = datetime(2026, 6, 22, 12, 0, tzinfo=UTC)


def _evaluate_case(
    tmp_path: Path,
    case: RuleTestCaseGoldenCorpusCase,
) -> RuleTestCaseGoldenCorpusCaseEvaluation:
    database_path = tmp_path / f"{case.case_id}.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    compiled_rule_set_id = f"compiled-{case.case_id}"

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)

    try:
        with Session(engine) as session:
            compiled_rule_set = compile_policy_version_snapshot(
                case.snapshot,
                compiled_rule_set_id=compiled_rule_set_id,
                compiled_by="golden-corpus",
                compiled_at=_GOLDEN_CORPUS_TIMESTAMP,
            )
            session.add(
                CompiledRuleSetRecord(
                    compiled_rule_set_id=compiled_rule_set.compiled_rule_set_id,
                    policy_version_id=compiled_rule_set.policy_version_id,
                    compiled_by=compiled_rule_set.compiled_by,
                    payload=compiled_rule_set.model_dump(mode="json"),
                    compiled_at=_GOLDEN_CORPUS_TIMESTAMP,
                )
            )
            generated_cases = generate_rule_test_cases(
                compiled_rule_set,
                generated_by="golden-corpus",
                generated_at=_GOLDEN_CORPUS_TIMESTAMP,
            )
            for generated_case in generated_cases:
                session.add(
                    RuleTestCaseRecord(
                        rule_test_case_id=generated_case.rule_test_case_id,
                        compiled_rule_set_id=generated_case.compiled_rule_set_id,
                        rule_id=generated_case.rule_id,
                        generated_by=generated_case.generated_by,
                        payload=generated_case.model_dump(mode="json"),
                        generated_at=_GOLDEN_CORPUS_TIMESTAMP,
                    )
                )
            session.flush()
            rule_test_run = execute_rule_test_run(
                session,
                compiled_rule_set_id=compiled_rule_set_id,
                executed_by="golden-corpus",
            )
            session.commit()
    finally:
        engine.dispose()

    return RuleTestCaseGoldenCorpusCaseEvaluation(
        case_id=case.case_id,
        compile_summary=compiled_rule_set.summary,
        generated_cases=generated_cases,
        rule_test_run=rule_test_run,
    )


def test_evaluate_golden_corpus_reports_expected_metrics(tmp_path: Path) -> None:
    report = evaluate_golden_corpus(
        [_evaluate_case(tmp_path, case) for case in RULE_TEST_CASE_GOLDEN_CORPUS_CASES]
    )

    assert [case.case_id for case in report.cases] == [
        "meal-cap-happy-path",
        "meal-cap-exception-edge",
    ]

    happy_path_case = report.cases[0]
    assert happy_path_case.compile_summary.compiled == 1
    assert happy_path_case.compile_summary.skipped_non_enforceable == 1
    assert happy_path_case.compile_summary.compile_error == 0
    assert happy_path_case.generation.total_count == 3
    assert happy_path_case.generation.positive_count == 1
    assert happy_path_case.generation.negative_count == 1
    assert happy_path_case.generation.boundary_count == 1
    assert happy_path_case.generation.exception_count == 0
    assert happy_path_case.run.total_count == 3
    assert happy_path_case.run.passed_count == 3
    assert happy_path_case.run.failed_count == 0
    assert happy_path_case.run.overall_passed is True

    exception_edge_case = report.cases[1]
    assert exception_edge_case.compile_summary.compiled == 1
    assert exception_edge_case.compile_summary.skipped_non_enforceable == 0
    assert exception_edge_case.compile_summary.compile_error == 0
    assert exception_edge_case.generation.total_count == 5
    assert exception_edge_case.generation.positive_count == 1
    assert exception_edge_case.generation.negative_count == 1
    assert exception_edge_case.generation.boundary_count == 1
    assert exception_edge_case.generation.exception_count == 2
    assert exception_edge_case.run.total_count == 5
    assert exception_edge_case.run.passed_count == 5
    assert exception_edge_case.run.failed_count == 0
    assert exception_edge_case.run.overall_passed is True

    assert report.compile_summary.compiled == 2
    assert report.compile_summary.skipped_non_enforceable == 1
    assert report.compile_summary.compile_error == 0
    assert report.generation.total_count == 8
    assert report.generation.positive_count == 2
    assert report.generation.negative_count == 2
    assert report.generation.boundary_count == 2
    assert report.generation.exception_count == 2
    assert report.run.total_count == 8
    assert report.run.passed_count == 8
    assert report.run.failed_count == 0
    assert report.run.overall_passed is True


def test_golden_corpus_expected_metrics_match_report(tmp_path: Path) -> None:
    report = evaluate_golden_corpus(
        [_evaluate_case(tmp_path, case) for case in RULE_TEST_CASE_GOLDEN_CORPUS_CASES]
    )
    cases_by_id = {case.case_id: case for case in report.cases}

    for corpus_case in RULE_TEST_CASE_GOLDEN_CORPUS_CASES:
        case_report = cases_by_id[corpus_case.case_id]
        expected = corpus_case.expected

        assert case_report.compile_summary.compiled == expected.compile.compiled
        assert (
            case_report.compile_summary.skipped_non_enforceable
            == expected.compile.skipped_non_enforceable
        )
        assert case_report.compile_summary.compile_error == expected.compile.compile_error
        assert case_report.generation.total_count == expected.generation.total_count
        assert case_report.generation.positive_count == expected.generation.positive_count
        assert case_report.generation.negative_count == expected.generation.negative_count
        assert case_report.generation.boundary_count == expected.generation.boundary_count
        assert case_report.generation.exception_count == expected.generation.exception_count
        assert case_report.run.total_count == expected.run.total_count
        assert case_report.run.passed_count == expected.run.passed_count
        assert case_report.run.failed_count == expected.run.failed_count
        assert case_report.run.overall_passed == expected.run.overall_passed


@pytest.mark.parametrize("case", RULE_TEST_CASE_GOLDEN_CORPUS_CASES, ids=lambda case: case.case_id)
def test_golden_corpus_case_passes_rule_test_run(tmp_path: Path, case) -> None:
    evaluation = _evaluate_case(tmp_path, case)
    assert evaluation.rule_test_run.summary.overall_passed is True
    assert all(result.passed for result in evaluation.rule_test_run.case_results)
