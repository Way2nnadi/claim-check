from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from policy_pipeline.database import Base
from policy_pipeline.documents import (
    PDF_CONTENT_TYPE,
    CitationAnchor,
    create_document_version,
    resolve_citation_anchor,
)
from policy_pipeline.extraction_evaluation import (
    ExpectedRule,
    GoldenCorpusCaseEvaluation,
    evaluate_golden_corpus,
)
from policy_pipeline.extraction_registry import save_model_configuration, save_prompt_template
from policy_pipeline.extraction_runs import (
    StructuredOutputRejectedError,
    execute_extraction_run,
)
from policy_pipeline.rules import Citation
from tests.golden_corpus import GOLDEN_CORPUS_CASES, GoldenCorpusCase
from tests.test_document_sections import _make_pdf_bytes


def _citation_from_anchor(anchor: CitationAnchor) -> Citation:
    return Citation(
        document_id=anchor.document_id,
        document_version_id=anchor.document_version_id,
        section_id=anchor.section_id,
        quote=anchor.quote,
        start_char=anchor.start_char,
        end_char=anchor.end_char,
    )


def _evaluate_case(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    case: GoldenCorpusCase,
) -> GoldenCorpusCaseEvaluation:
    database_path = tmp_path / f"{case.case_id}.db"
    object_storage_root = tmp_path / case.case_id
    database_url = f"sqlite+pysqlite:///{database_path}"
    monkeypatch.setenv("POLICY_PIPELINE_DATABASE_URL", database_url)
    monkeypatch.setenv("POLICY_PIPELINE_OBJECT_STORAGE_ROOT", str(object_storage_root))

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)

    try:
        with Session(engine) as session:
            save_prompt_template(
                session,
                prompt_template_id="rule-extraction",
                version="v1",
                template="Extract candidate Rules from the Policy Document.",
            )
            save_model_configuration(
                session,
                model_configuration_id="fake-openai",
                version="v1",
                model="gpt-5-mini",
                endpoint="https://fake-openai.local/v1/chat/completions",
                settings={"fake_structured_outputs": [case.fake_structured_output]},
            )
            document_version = create_document_version(
                session,
                document_id=case.document_id,
                filename=case.filename,
                content_type=PDF_CONTENT_TYPE,
                document_bytes=_make_pdf_bytes(case.pdf_lines),
            )

            expected_rules = []
            for expected_rule_spec in case.expected_rules:
                anchor = resolve_citation_anchor(
                    session,
                    document_id=case.document_id,
                    document_version_id=document_version.document_version_id,
                    quote=expected_rule_spec.citation_quote,
                )
                assert anchor is not None
                expected_rules.append(
                    ExpectedRule(
                        statement=expected_rule_spec.statement,
                        enforceability_class=expected_rule_spec.enforceability_class,
                        scope=expected_rule_spec.scope,
                        citation=_citation_from_anchor(anchor),
                        condition=expected_rule_spec.condition,
                        applicability=expected_rule_spec.applicability,
                    )
                )

            try:
                result = execute_extraction_run(
                    session,
                    extraction_run_id=f"{case.case_id}-run",
                    document_id=case.document_id,
                    document_version_id=document_version.document_version_id,
                    prompt_template_id="rule-extraction",
                    prompt_template_version="v1",
                    model_configuration_id="fake-openai",
                    model_configuration_version="v1",
                )
            except StructuredOutputRejectedError:
                candidate_rules = []
            else:
                candidate_rules = result.candidate_rules
    finally:
        engine.dispose()

    return GoldenCorpusCaseEvaluation(
        case_id=case.case_id,
        expected_rules=expected_rules,
        candidate_rules=candidate_rules,
        raw_candidate_rules=case.fake_structured_output["candidate_rules"],
    )


def test_evaluate_golden_corpus_reports_expected_metrics(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    report = evaluate_golden_corpus(
        [
            _evaluate_case(monkeypatch, tmp_path, case)
            for case in GOLDEN_CORPUS_CASES
        ]
    )

    assert [case.case_id for case in report.cases] == [
        "expense-policy-core-rules",
        "expense-policy-invalid-structured-output",
    ]

    core_rules_case = report.cases[0]
    assert core_rules_case.completeness.correct == 3
    assert core_rules_case.completeness.total == 3
    assert core_rules_case.threshold_accuracy.correct == 1
    assert core_rules_case.threshold_accuracy.total == 2
    assert core_rules_case.enforceability_class_accuracy.correct == 2
    assert core_rules_case.enforceability_class_accuracy.total == 3
    assert core_rules_case.citation_accuracy.correct == 2
    assert core_rules_case.citation_accuracy.total == 3
    assert core_rules_case.schema_validity.correct == 3
    assert core_rules_case.schema_validity.total == 3

    invalid_case = report.cases[1]
    assert invalid_case.completeness.correct == 0
    assert invalid_case.completeness.total == 1
    assert invalid_case.threshold_accuracy.correct == 0
    assert invalid_case.threshold_accuracy.total == 1
    assert invalid_case.enforceability_class_accuracy.correct == 0
    assert invalid_case.enforceability_class_accuracy.total == 1
    assert invalid_case.citation_accuracy.correct == 0
    assert invalid_case.citation_accuracy.total == 1
    assert invalid_case.schema_validity.correct == 1
    assert invalid_case.schema_validity.total == 2

    assert report.completeness.correct == 3
    assert report.completeness.total == 4
    assert report.completeness.accuracy == pytest.approx(0.75)
    assert report.threshold_accuracy.correct == 1
    assert report.threshold_accuracy.total == 3
    assert report.threshold_accuracy.accuracy == pytest.approx(1 / 3)
    assert report.enforceability_class_accuracy.correct == 2
    assert report.enforceability_class_accuracy.total == 4
    assert report.enforceability_class_accuracy.accuracy == pytest.approx(0.5)
    assert report.citation_accuracy.correct == 2
    assert report.citation_accuracy.total == 4
    assert report.citation_accuracy.accuracy == pytest.approx(0.5)
    assert report.schema_validity.correct == 4
    assert report.schema_validity.total == 5
    assert report.schema_validity.accuracy == pytest.approx(0.8)
