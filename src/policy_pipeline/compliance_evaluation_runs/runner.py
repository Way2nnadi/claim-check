from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy.orm import Session

from policy_pipeline.compiled_rule_sets.models import (
    CompiledRuleEntry,
    CompiledRuleSet,
    CompiledRuleSetSummary,
    CompileStatus,
)
from policy_pipeline.compiled_rule_sets.store import (
    PolicyVersionNotFoundError,
    compile_policy_version,
    get_compiled_rule_set,
)
from policy_pipeline.compliance_evaluation_runs.aggregation import (
    aggregation_period,
    build_cross_row_aggregation_context,
    build_per_attendee_aggregation_context,
    evaluate_cross_row_aggregations,
    uses_cross_row_aggregation,
)
from policy_pipeline.compliance_evaluation_runs.evaluator import (
    build_currency_match_context,
    build_currency_match_context_for_fields,
    build_currency_mismatch_review_reason,
    build_effective_date_scope_context,
    build_needs_review_reason,
    build_review_evidence,
    build_scope_match_context,
    build_violation_evidence,
    evaluate_expense_row_for_compliance_v1,
    non_enforceable_rule_scope_matches_v1,
    resolve_violation_comparison,
    uses_row_level_rule_evaluation,
)
from policy_pipeline.compliance_evaluation_runs.models import (
    AggregationWindowContext,
    ComplianceEvaluationRowOutcome,
    ComplianceEvaluationRun,
    ComplianceEvaluationRunSummary,
    ComplianceOutcome,
    CurrencyMatchContext,
    EffectiveDateScopeContext,
    ScopeMatchContext,
)
from policy_pipeline.compliance_evaluation_runs.records import ComplianceEvaluationRunRecord
from policy_pipeline.compliance_evaluation_runs.gate import assert_rule_test_run_gate_passed
from policy_pipeline.compliance_evaluation_runs.store import (
    compliance_evaluation_run_from_record,
)
from policy_pipeline.expense_reports import (
    ExpenseReportRow,
    compute_expense_input_fingerprint,
    get_expense_report,
)
from policy_pipeline.rule_test_cases.evaluator import UnsupportedRuleEvaluationError
from policy_pipeline.rules.models import AggregationPeriod, Citation

_OUTCOME_PRECEDENCE: dict[ComplianceOutcome, int] = {
    ComplianceOutcome.VIOLATION: 0,
    ComplianceOutcome.MISSING_EVIDENCE: 1,
    ComplianceOutcome.NEEDS_REVIEW: 2,
    ComplianceOutcome.PASS: 3,
}


@dataclass(frozen=True)
class ComplianceEvaluationRunExecutionResult:
    run: ComplianceEvaluationRun
    compiled_rule_set_created: bool
    compiled_rule_set_summary: CompiledRuleSetSummary | None = None


@dataclass(frozen=True)
class CompileErrorDetail:
    rule_id: str
    error_reason: str


@dataclass(frozen=True)
class _RuleMatchCandidate:
    rule_id: str
    outcome: ComplianceOutcome
    reason: str | None
    policy_limit: str | None
    actual_value: str | None
    missing_evidence_fields: tuple[str, ...]
    evidence: tuple[Citation, ...]
    scope_context: ScopeMatchContext | None = None
    currency_context: CurrencyMatchContext | None = None
    effective_date_context: EffectiveDateScopeContext | None = None
    aggregation_context: AggregationWindowContext | None = None


def execute_compliance_evaluation_run(
    session: Session,
    *,
    expense_report_id: str,
    executed_by: str,
    compiled_rule_set_id: str | None = None,
    policy_version_id: str | None = None,
) -> ComplianceEvaluationRunExecutionResult:
    expense_report = get_expense_report(session, expense_report_id=expense_report_id)
    if expense_report is None:
        raise ExpenseReportNotFoundError(expense_report_id)

    compiled_rule_set, compiled_rule_set_created = _resolve_compiled_rule_set(
        session,
        compiled_rule_set_id=compiled_rule_set_id,
        policy_version_id=policy_version_id,
        compiled_by=executed_by,
    )
    resolved_compiled_rule_set_id = compiled_rule_set.compiled_rule_set_id

    compile_errors = _compile_error_details(compiled_rule_set.entries)
    compiled_rules = _evaluable_entries_in_order(compiled_rule_set.entries)
    if not compiled_rules:
        if compile_errors:
            raise CompiledRuleSetCompileErrorsError(
                compiled_rule_set.policy_version_id,
                compile_errors,
            )
        raise NoCompiledRulesError(resolved_compiled_rule_set_id)

    assert_rule_test_run_gate_passed(
        session,
        compiled_rule_set_id=resolved_compiled_rule_set_id,
    )

    executed_at = datetime.now(UTC)
    aggregated_candidates = _build_aggregated_candidates(
        compiled_rules,
        expense_report.rows,
    )
    row_outcomes: list[ComplianceEvaluationRowOutcome] = []
    for row_index, row in enumerate(expense_report.rows):
        row_outcomes.append(
            _evaluate_row(
                compiled_rules,
                row,
                row_index=row_index,
                extra_candidates=aggregated_candidates.get(row_index, ()),
            )
        )

    pass_count = sum(
        1 for outcome in row_outcomes if outcome.outcome is ComplianceOutcome.PASS
    )
    violation_count = sum(
        1 for outcome in row_outcomes if outcome.outcome is ComplianceOutcome.VIOLATION
    )
    needs_review_count = sum(
        1
        for outcome in row_outcomes
        if outcome.outcome is ComplianceOutcome.NEEDS_REVIEW
    )
    missing_evidence_count = sum(
        1
        for outcome in row_outcomes
        if outcome.outcome is ComplianceOutcome.MISSING_EVIDENCE
    )
    summary = ComplianceEvaluationRunSummary(
        total_count=len(row_outcomes),
        pass_count=pass_count,
        violation_count=violation_count,
        needs_review_count=needs_review_count,
        missing_evidence_count=missing_evidence_count,
    )
    expense_input_fingerprint = compute_expense_input_fingerprint(
        source_filename=expense_report.source_filename,
        rows=expense_report.rows,
    )
    compliance_run = ComplianceEvaluationRun(
        compliance_evaluation_run_id=f"cer-{uuid4().hex}",
        expense_report_id=expense_report_id,
        expense_input_fingerprint=expense_input_fingerprint,
        compiled_rule_set_id=resolved_compiled_rule_set_id,
        policy_version_id=compiled_rule_set.policy_version_id,
        executed_by=executed_by,
        executed_at=executed_at,
        summary=summary,
        row_outcomes=row_outcomes,
    )
    session.add(
        ComplianceEvaluationRunRecord(
            compliance_evaluation_run_id=compliance_run.compliance_evaluation_run_id,
            expense_report_id=compliance_run.expense_report_id,
            compiled_rule_set_id=compliance_run.compiled_rule_set_id,
            policy_version_id=compliance_run.policy_version_id,
            executed_by=compliance_run.executed_by,
            payload=compliance_run.model_dump(mode="json"),
            executed_at=executed_at,
        )
    )
    session.flush()
    return ComplianceEvaluationRunExecutionResult(
        run=compliance_run,
        compiled_rule_set_created=compiled_rule_set_created,
        compiled_rule_set_summary=(
            compiled_rule_set.summary if compiled_rule_set_created else None
        ),
    )


def _resolve_compiled_rule_set(
    session: Session,
    *,
    compiled_rule_set_id: str | None,
    policy_version_id: str | None,
    compiled_by: str,
) -> tuple[CompiledRuleSet, bool]:
    if policy_version_id is not None:
        compiled_rule_set, created = compile_policy_version(
            session,
            policy_version_id=policy_version_id,
            compiled_by=compiled_by,
        )

        if (
            compiled_rule_set_id is not None
            and compiled_rule_set.compiled_rule_set_id != compiled_rule_set_id
        ):
            raise PolicyVersionCompiledRuleSetMismatchError(
                policy_version_id,
                compiled_rule_set_id,
            )
        return compiled_rule_set, created

    assert compiled_rule_set_id is not None
    compiled_rule_set = get_compiled_rule_set(
        session,
        compiled_rule_set_id=compiled_rule_set_id,
    )
    if compiled_rule_set is None:
        raise CompiledRuleSetNotFoundError(compiled_rule_set_id)
    return compiled_rule_set, False


def _compile_error_details(entries) -> tuple[CompileErrorDetail, ...]:
    return tuple(
        CompileErrorDetail(
            rule_id=entry.rule_id,
            error_reason=entry.error_reason or "Rule failed to compile.",
        )
        for entry in entries
        if entry.status is CompileStatus.COMPILE_ERROR
    )


def get_compliance_evaluation_run(
    session: Session,
    *,
    compliance_evaluation_run_id: str,
) -> ComplianceEvaluationRun | None:
    record = session.get(ComplianceEvaluationRunRecord, compliance_evaluation_run_id)
    if record is None:
        return None
    return compliance_evaluation_run_from_record(record)


def list_compliance_evaluation_runs(
    session: Session,
    *,
    expense_report_id: str,
) -> list[ComplianceEvaluationRun]:
    from sqlalchemy import select

    records = session.scalars(
        select(ComplianceEvaluationRunRecord)
        .where(ComplianceEvaluationRunRecord.expense_report_id == expense_report_id)
        .order_by(
            ComplianceEvaluationRunRecord.executed_at.desc(),
            ComplianceEvaluationRunRecord.compliance_evaluation_run_id.asc(),
        )
    ).all()
    return [compliance_evaluation_run_from_record(record) for record in records]


def evaluate_compliance_for_expense_rows(
    compiled_rule_set: CompiledRuleSet,
    expense_rows: Sequence[ExpenseReportRow],
) -> list[ComplianceEvaluationRowOutcome]:
    compiled_rules = _evaluable_entries_in_order(compiled_rule_set.entries)
    if not compiled_rules:
        raise NoCompiledRulesError(compiled_rule_set.compiled_rule_set_id)

    aggregated_candidates = _build_aggregated_candidates(compiled_rules, expense_rows)
    return [
        _evaluate_row(
            compiled_rules,
            row,
            row_index=row_index,
            extra_candidates=aggregated_candidates.get(row_index, ()),
        )
        for row_index, row in enumerate(expense_rows)
    ]


def _evaluable_entries_in_order(entries) -> list[CompiledRuleEntry]:
    evaluable: list[CompiledRuleEntry] = []
    for entry in entries:
        if entry.status is CompileStatus.COMPILED and entry.compiled_rule is not None:
            evaluable.append(entry)
        elif entry.status is CompileStatus.SKIPPED_NON_ENFORCEABLE:
            evaluable.append(entry)
    return evaluable


def _build_aggregated_candidates(
    compiled_rule_entries: list[CompiledRuleEntry],
    expense_rows: Sequence[ExpenseReportRow],
) -> dict[int, tuple[_RuleMatchCandidate, ...]]:
    candidates_by_row: dict[int, list[_RuleMatchCandidate]] = {}

    for entry in compiled_rule_entries:
        if entry.status is not CompileStatus.COMPILED or entry.compiled_rule is None:
            continue

        compiled_rule = entry.compiled_rule
        period = aggregation_period(compiled_rule)
        if not uses_cross_row_aggregation(period):
            continue

        try:
            window_evaluations = evaluate_cross_row_aggregations(
                compiled_rule,
                expense_rows,
            )
        except UnsupportedRuleEvaluationError as exc:
            raise UnsupportedRuleEvaluationError(
                f"Rule {compiled_rule.rule_id}: {exc.detail}",
            ) from exc

        for window_evaluation in window_evaluations:
            row = expense_rows[window_evaluation.row_indices[0]]
            aggregation_context = build_cross_row_aggregation_context(
                compiled_rule=compiled_rule,
                window_evaluation=window_evaluation,
                expense_rows=expense_rows,
            )
            candidate = _RuleMatchCandidate(
                rule_id=window_evaluation.rule_id,
                outcome=window_evaluation.outcome,
                reason=compiled_rule.statement,
                policy_limit=window_evaluation.policy_limit,
                actual_value=window_evaluation.actual_value,
                missing_evidence_fields=window_evaluation.missing_evidence_fields,
                evidence=tuple(build_violation_evidence(compiled_rule)),
                scope_context=build_scope_match_context(compiled_rule.scope, row),
                currency_context=build_currency_match_context(compiled_rule, row),
                effective_date_context=build_effective_date_scope_context(
                    compiled_rule.scope,
                    row,
                ),
                aggregation_context=aggregation_context,
            )
            for row_index in window_evaluation.row_indices:
                candidates_by_row.setdefault(row_index, []).append(candidate)

    return {
        row_index: tuple(candidates)
        for row_index, candidates in candidates_by_row.items()
    }


def _evaluate_row(
    compiled_rule_entries: list[CompiledRuleEntry],
    row,
    *,
    row_index: int,
    extra_candidates: tuple[_RuleMatchCandidate, ...] = (),
) -> ComplianceEvaluationRowOutcome:
    candidates: list[_RuleMatchCandidate] = list(extra_candidates)

    for entry in compiled_rule_entries:
        if entry.status is CompileStatus.COMPILED:
            assert entry.compiled_rule is not None
            compiled_rule = entry.compiled_rule
            scope_context = build_scope_match_context(compiled_rule.scope, row)
            currency_context = build_currency_match_context(compiled_rule, row)
            effective_date_context = build_effective_date_scope_context(
                compiled_rule.scope,
                row,
            )

            currency_mismatch_reason = build_currency_mismatch_review_reason(
                compiled_rule,
                row,
            )
            if currency_mismatch_reason is not None:
                candidates.append(
                    _RuleMatchCandidate(
                        rule_id=compiled_rule.rule_id,
                        outcome=ComplianceOutcome.NEEDS_REVIEW,
                        reason=currency_mismatch_reason,
                        policy_limit=None,
                        actual_value=None,
                        missing_evidence_fields=(),
                        evidence=tuple(build_violation_evidence(compiled_rule)),
                        scope_context=scope_context,
                        currency_context=currency_context,
                        effective_date_context=effective_date_context,
                    )
                )
                continue

            if not uses_row_level_rule_evaluation(compiled_rule):
                continue

            try:
                evaluation = evaluate_expense_row_for_compliance_v1(compiled_rule, row)
            except UnsupportedRuleEvaluationError as exc:
                raise UnsupportedRuleEvaluationError(
                    f"Rule {compiled_rule.rule_id}: {exc.detail}",
                ) from exc

            if evaluation.outcome is ComplianceOutcome.PASS:
                continue

            policy_limit, actual_value = resolve_violation_comparison(compiled_rule, row)
            rule_period = aggregation_period(compiled_rule)
            aggregation_context = None
            if rule_period is AggregationPeriod.PER_ATTENDEE:
                aggregation_context = build_per_attendee_aggregation_context(
                    compiled_rule=compiled_rule,
                    row=row,
                    row_index=row_index,
                    policy_limit=policy_limit,
                    aggregate_value=actual_value,
                )
            candidates.append(
                _RuleMatchCandidate(
                    rule_id=compiled_rule.rule_id,
                    outcome=evaluation.outcome,
                    reason=compiled_rule.statement,
                    policy_limit=policy_limit,
                    actual_value=actual_value,
                    missing_evidence_fields=evaluation.missing_evidence_fields,
                    evidence=tuple(build_violation_evidence(compiled_rule)),
                    scope_context=scope_context,
                    currency_context=currency_context,
                    effective_date_context=effective_date_context,
                    aggregation_context=aggregation_context,
                )
            )
            continue

        if non_enforceable_rule_scope_matches_v1(entry.source_rule, row):
            source_rule = entry.source_rule
            candidates.append(
                _RuleMatchCandidate(
                    rule_id=source_rule.rule_id,
                    outcome=ComplianceOutcome.NEEDS_REVIEW,
                    reason=build_needs_review_reason(source_rule),
                    policy_limit=None,
                    actual_value=None,
                    missing_evidence_fields=(),
                    evidence=tuple(build_review_evidence(source_rule)),
                    scope_context=build_scope_match_context(
                        source_rule.scope.model_dump(mode="json"),
                        row,
                    ),
                    currency_context=build_currency_match_context_for_fields(
                        applicability=(
                            source_rule.applicability.model_dump(mode="json")
                            if source_rule.applicability is not None
                            else {}
                        ),
                        condition=(
                            source_rule.condition.model_dump(mode="json")
                            if source_rule.condition is not None
                            else None
                        ),
                        expense=row,
                    ),
                    effective_date_context=build_effective_date_scope_context(
                        source_rule.scope.model_dump(mode="json"),
                        row,
                    ),
                )
            )

    if not candidates:
        return ComplianceEvaluationRowOutcome(
            row_index=row_index,
            employee_id=row.employee_id,
            expense_date=row.expense_date,
            outcome=ComplianceOutcome.PASS,
            rule_id=None,
            reason=None,
        )

    winner = min(
        candidates,
        key=lambda candidate: (
            _OUTCOME_PRECEDENCE[candidate.outcome],
            candidate.rule_id,
        ),
    )
    matching_rule_ids = sorted({candidate.rule_id for candidate in candidates})

    return ComplianceEvaluationRowOutcome(
        row_index=row_index,
        employee_id=row.employee_id,
        expense_date=row.expense_date,
        outcome=winner.outcome,
        rule_id=winner.rule_id,
        matching_rule_ids=matching_rule_ids,
        reason=winner.reason,
        policy_limit=winner.policy_limit,
        actual_value=winner.actual_value,
        missing_evidence_fields=list(winner.missing_evidence_fields),
        evidence=list(winner.evidence),
        scope_context=winner.scope_context,
        currency_context=winner.currency_context,
        effective_date_context=winner.effective_date_context,
        aggregation_context=winner.aggregation_context,
    )


class ExpenseReportNotFoundError(Exception):
    def __init__(self, expense_report_id: str) -> None:
        self.expense_report_id = expense_report_id
        super().__init__(expense_report_id)


class CompiledRuleSetNotFoundError(Exception):
    def __init__(self, compiled_rule_set_id: str) -> None:
        self.compiled_rule_set_id = compiled_rule_set_id
        super().__init__(compiled_rule_set_id)


class NoCompiledRulesError(Exception):
    def __init__(self, compiled_rule_set_id: str) -> None:
        self.compiled_rule_set_id = compiled_rule_set_id
        super().__init__(compiled_rule_set_id)


class PolicyVersionCompiledRuleSetMismatchError(Exception):
    def __init__(self, policy_version_id: str, compiled_rule_set_id: str) -> None:
        self.policy_version_id = policy_version_id
        self.compiled_rule_set_id = compiled_rule_set_id
        super().__init__(policy_version_id, compiled_rule_set_id)


class CompiledRuleSetCompileErrorsError(Exception):
    def __init__(
        self,
        policy_version_id: str,
        compile_errors: Sequence[CompileErrorDetail],
    ) -> None:
        self.policy_version_id = policy_version_id
        self.compile_errors = tuple(compile_errors)
        super().__init__(policy_version_id)
