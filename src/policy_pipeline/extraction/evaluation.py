from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel, Field, ValidationError, model_validator

from policy_pipeline.extraction.structured_output import StructuredCandidateRule
from policy_pipeline.rules.models import (
    Applicability,
    CandidateRule,
    Citation,
    EnforceabilityClass,
    RuleCondition,
    Scope,
)


class GoldenCorpusMetric(BaseModel):
    correct: int = Field(ge=0)
    total: int = Field(ge=0)
    accuracy: float = Field(ge=0.0, le=1.0)


class ExpectedRule(BaseModel):
    statement: str = Field(min_length=1)
    enforceability_class: EnforceabilityClass
    scope: Scope
    citation: Citation
    condition: RuleCondition | None = None
    applicability: Applicability | None = None

    @model_validator(mode="after")
    def validate_expected_rule(self) -> ExpectedRule:
        if self.enforceability_class is EnforceabilityClass.ENFORCEABLE and self.condition is None:
            raise ValueError("Enforceable expected Rule requires a machine-checkable condition.")
        if (
            self.enforceability_class is not EnforceabilityClass.ENFORCEABLE
            and self.condition is not None
        ):
            raise ValueError(
                "Guidance and subjective expected Rules must not include "
                "a machine-checkable condition."
            )
        return self


class GoldenCorpusCaseEvaluation(BaseModel):
    case_id: str = Field(min_length=1)
    expected_rules: list[ExpectedRule] = Field(default_factory=list)
    candidate_rules: list[CandidateRule] = Field(default_factory=list)
    raw_candidate_rules: list[Any] = Field(default_factory=list)


class GoldenCorpusCaseReport(BaseModel):
    case_id: str = Field(min_length=1)
    completeness: GoldenCorpusMetric
    threshold_accuracy: GoldenCorpusMetric
    enforceability_class_accuracy: GoldenCorpusMetric
    citation_accuracy: GoldenCorpusMetric
    schema_validity: GoldenCorpusMetric


class GoldenCorpusEvaluationReport(BaseModel):
    cases: list[GoldenCorpusCaseReport] = Field(default_factory=list)
    completeness: GoldenCorpusMetric
    threshold_accuracy: GoldenCorpusMetric
    enforceability_class_accuracy: GoldenCorpusMetric
    citation_accuracy: GoldenCorpusMetric
    schema_validity: GoldenCorpusMetric


def evaluate_golden_corpus(
    evaluations: Sequence[GoldenCorpusCaseEvaluation],
) -> GoldenCorpusEvaluationReport:
    case_reports = [_evaluate_case(evaluation) for evaluation in evaluations]
    return GoldenCorpusEvaluationReport(
        cases=case_reports,
        completeness=_aggregate_metric(case_reports, "completeness"),
        threshold_accuracy=_aggregate_metric(case_reports, "threshold_accuracy"),
        enforceability_class_accuracy=_aggregate_metric(
            case_reports,
            "enforceability_class_accuracy",
        ),
        citation_accuracy=_aggregate_metric(case_reports, "citation_accuracy"),
        schema_validity=_aggregate_metric(case_reports, "schema_validity"),
    )


def _evaluate_case(evaluation: GoldenCorpusCaseEvaluation) -> GoldenCorpusCaseReport:
    matches = _match_candidate_rules(
        expected_rules=evaluation.expected_rules,
        candidate_rules=evaluation.candidate_rules,
    )
    raw_candidate_rules = list(evaluation.raw_candidate_rules)
    if not raw_candidate_rules:
        raw_candidate_rules = [
            candidate_rule.model_dump(mode="json") for candidate_rule in evaluation.candidate_rules
        ]

    completeness_correct = sum(1 for _, candidate_rule in matches if candidate_rule is not None)
    threshold_matches = [
        (expected_rule, candidate_rule)
        for expected_rule, candidate_rule in matches
        if expected_rule.condition is not None
    ]
    threshold_correct = sum(
        1
        for expected_rule, candidate_rule in threshold_matches
        if candidate_rule is not None and candidate_rule.condition == expected_rule.condition
    )
    enforceability_correct = sum(
        1
        for expected_rule, candidate_rule in matches
        if (
            candidate_rule is not None
            and candidate_rule.enforceability_class == expected_rule.enforceability_class
        )
    )
    citation_correct = sum(
        1
        for expected_rule, candidate_rule in matches
        if candidate_rule is not None and candidate_rule.citation == expected_rule.citation
    )
    schema_valid_correct = sum(
        1 for raw_candidate_rule in raw_candidate_rules if _is_schema_valid(raw_candidate_rule)
    )

    return GoldenCorpusCaseReport(
        case_id=evaluation.case_id,
        completeness=_metric(completeness_correct, len(evaluation.expected_rules)),
        threshold_accuracy=_metric(threshold_correct, len(threshold_matches)),
        enforceability_class_accuracy=_metric(
            enforceability_correct,
            len(evaluation.expected_rules),
        ),
        citation_accuracy=_metric(citation_correct, len(evaluation.expected_rules)),
        schema_validity=_metric(schema_valid_correct, len(raw_candidate_rules)),
    )


def _aggregate_metric(
    case_reports: Sequence[GoldenCorpusCaseReport],
    field_name: str,
) -> GoldenCorpusMetric:
    correct = sum(getattr(case_report, field_name).correct for case_report in case_reports)
    total = sum(getattr(case_report, field_name).total for case_report in case_reports)
    return _metric(correct, total)


def _metric(correct: int, total: int) -> GoldenCorpusMetric:
    if total == 0:
        return GoldenCorpusMetric(correct=0, total=0, accuracy=1.0)
    return GoldenCorpusMetric(correct=correct, total=total, accuracy=correct / total)


def _match_candidate_rules(
    *,
    expected_rules: Sequence[ExpectedRule],
    candidate_rules: Sequence[CandidateRule],
) -> list[tuple[ExpectedRule, CandidateRule | None]]:
    remaining_rules = list(candidate_rules)
    matches: list[tuple[ExpectedRule, CandidateRule | None]] = []
    for expected_rule in expected_rules:
        matched_index = next(
            (
                index
                for index, candidate_rule in enumerate(remaining_rules)
                if _same_rule_identity(expected_rule=expected_rule, candidate_rule=candidate_rule)
            ),
            None,
        )
        if matched_index is None:
            matches.append((expected_rule, None))
            continue
        matches.append((expected_rule, remaining_rules.pop(matched_index)))
    return matches


def _same_rule_identity(*, expected_rule: ExpectedRule, candidate_rule: CandidateRule) -> bool:
    return _normalize_statement(candidate_rule.statement) == _normalize_statement(
        expected_rule.statement
    ) and candidate_rule.scope.model_dump(mode="json", exclude_none=True) == (
        expected_rule.scope.model_dump(mode="json", exclude_none=True)
    )


def _normalize_statement(value: str) -> str:
    return " ".join(value.split())


def _is_schema_valid(raw_candidate_rule: Any) -> bool:
    try:
        StructuredCandidateRule.model_validate(raw_candidate_rule)
    except ValidationError:
        return False
    return True
