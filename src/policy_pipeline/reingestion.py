from __future__ import annotations

import re
from collections import defaultdict, deque

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from policy_pipeline.documents import DocumentVersion, create_document_version
from policy_pipeline.extraction_runs import ExtractionExecutionResult, execute_extraction_run
from policy_pipeline.rules import CandidateRule, LifecycleState, Rule, RuleOriginType
from policy_pipeline.structured_policy_store import get_latest_policy_version_snapshot

_NUMBER_PATTERN = re.compile(r"[$€£]?\d+(?:\.\d+)?")


class ChangedRuleDiff(BaseModel):
    current_rule: Rule
    candidate_rule: CandidateRule
    lifecycle_state: LifecycleState = LifecycleState.SUPERSEDED


class RemovedRuleDiff(BaseModel):
    current_rule: Rule
    lifecycle_state: LifecycleState = LifecycleState.WITHDRAWN


class UnchangedRuleDiff(BaseModel):
    current_rule: Rule
    candidate_rule: CandidateRule


class PolicyVersionDiff(BaseModel):
    baseline_policy_version_id: str | None = None
    added: list[CandidateRule] = Field(default_factory=list)
    changed: list[ChangedRuleDiff] = Field(default_factory=list)
    removed: list[RemovedRuleDiff] = Field(default_factory=list)
    unchanged: list[UnchangedRuleDiff] = Field(default_factory=list)


class ReingestionResult(BaseModel):
    document_version: DocumentVersion
    extraction_run: ExtractionExecutionResult
    diff: PolicyVersionDiff


def reingest_document(
    session: Session,
    *,
    document_id: str,
    filename: str,
    content_type: str,
    document_bytes: bytes,
    extraction_run_id: str,
    prompt_template_id: str,
    prompt_template_version: str,
    model_configuration_id: str,
    model_configuration_version: str,
) -> ReingestionResult:
    document_version = create_document_version(
        session,
        document_id=document_id,
        filename=filename,
        content_type=content_type,
        document_bytes=document_bytes,
        commit=False,
    )
    extraction_run = execute_extraction_run(
        session,
        extraction_run_id=extraction_run_id,
        document_id=document_id,
        document_version_id=document_version.document_version_id,
        prompt_template_id=prompt_template_id,
        prompt_template_version=prompt_template_version,
        model_configuration_id=model_configuration_id,
        model_configuration_version=model_configuration_version,
    )
    current_policy_version = get_latest_policy_version_snapshot(session)
    diff = diff_candidate_rules_against_current_policy_version(
        document_id=document_id,
        candidate_rules=extraction_run.candidate_rules,
        current_policy_version=current_policy_version,
    )
    return ReingestionResult(
        document_version=document_version,
        extraction_run=extraction_run,
        diff=diff,
    )


def diff_candidate_rules_against_current_policy_version(
    *,
    document_id: str,
    candidate_rules: list[CandidateRule],
    current_policy_version: object | None,
) -> PolicyVersionDiff:
    if current_policy_version is None:
        return PolicyVersionDiff(added=list(candidate_rules))

    current_rules = [
        rule
        for rule in current_policy_version.rules
        if rule.origin.source_type is RuleOriginType.EXTRACTED
        and rule.citation is not None
        and rule.citation.document_id == document_id
    ]
    diff = PolicyVersionDiff(
        baseline_policy_version_id=current_policy_version.policy_version_id,
    )
    if not current_rules:
        diff.added = list(candidate_rules)
        return diff

    current_exact_matches: dict[tuple[object, ...], deque[Rule]] = defaultdict(deque)
    for rule in current_rules:
        current_exact_matches[_semantic_signature(rule)].append(rule)

    unmatched_candidates: list[CandidateRule] = []
    matched_current_rule_ids: set[str] = set()

    for candidate_rule in candidate_rules:
        exact_match_pool = current_exact_matches[_semantic_signature(candidate_rule)]
        if not exact_match_pool:
            unmatched_candidates.append(candidate_rule)
            continue
        current_rule = exact_match_pool.popleft()
        matched_current_rule_ids.add(current_rule.rule_id)
        diff.unchanged.append(
            UnchangedRuleDiff(
                current_rule=current_rule,
                candidate_rule=candidate_rule,
            )
        )

    remaining_current_rules = [
        rule for rule in current_rules if rule.rule_id not in matched_current_rule_ids
    ]
    current_relaxed_matches: dict[tuple[object, ...], deque[Rule]] = defaultdict(deque)
    for rule in remaining_current_rules:
        current_relaxed_matches[_relaxed_signature(rule)].append(rule)

    for candidate_rule in unmatched_candidates:
        relaxed_match_pool = current_relaxed_matches[_relaxed_signature(candidate_rule)]
        if not relaxed_match_pool:
            diff.added.append(candidate_rule)
            continue
        current_rule = relaxed_match_pool.popleft()
        matched_current_rule_ids.add(current_rule.rule_id)
        diff.changed.append(
            ChangedRuleDiff(
                current_rule=current_rule,
                candidate_rule=candidate_rule,
            )
        )

    for current_rule in current_rules:
        if current_rule.rule_id in matched_current_rule_ids:
            continue
        diff.removed.append(RemovedRuleDiff(current_rule=current_rule))

    return diff


def _semantic_signature(rule: CandidateRule | Rule) -> tuple[object, ...]:
    return (
        _normalized_statement(rule.statement),
        rule.enforceability_class.value,
        _scope_signature(rule),
        _condition_signature(rule),
        _applicability_signature(rule),
        _exceptions_signature(rule),
    )


def _relaxed_signature(rule: CandidateRule | Rule) -> tuple[object, ...]:
    return (
        _normalized_statement_shape(rule.statement),
        rule.enforceability_class.value,
        _scope_signature(rule),
        rule.condition.field if rule.condition is not None else None,
        _applicability_signature(rule),
    )


def _normalized_statement(statement: str) -> str:
    return " ".join(statement.casefold().split())


def _normalized_statement_shape(statement: str) -> str:
    return " ".join(_NUMBER_PATTERN.sub("<num>", statement.casefold()).split())


def _scope_signature(rule: CandidateRule | Rule) -> tuple[object, ...]:
    scope = rule.scope
    return (
        scope.country,
        scope.expense_category,
        scope.travel_type,
        scope.employee_group,
        scope.effective_start_date,
        scope.effective_end_date,
    )


def _condition_signature(rule: CandidateRule | Rule) -> tuple[object, ...]:
    if rule.condition is None:
        return (None, None, None)
    return (
        rule.condition.field,
        rule.condition.operator,
        rule.condition.value,
    )


def _applicability_signature(rule: CandidateRule | Rule) -> tuple[object, ...]:
    if rule.applicability is None:
        return (None, None, None, None)
    return (
        rule.applicability.aggregation_period.value,
        rule.applicability.unit,
        rule.applicability.currency,
        rule.applicability.limit_basis,
    )


def _exceptions_signature(rule: CandidateRule | Rule) -> tuple[object, ...]:
    return tuple(
        (exception.description, tuple(exception.required_evidence)) for exception in rule.exceptions
    )
