from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from policy_pipeline.compiled_rule_sets.store import get_compiled_rule_set
from policy_pipeline.compliance_evaluation_runs.models import (
    ComplianceEvaluationRun,
    ComplianceOutcome,
)
from policy_pipeline.compliance_evaluation_runs.records import ComplianceEvaluationRunRecord
from policy_pipeline.compliance_evaluation_runs.runner import get_compliance_evaluation_run
from policy_pipeline.compliance_evaluation_runs.store import (
    compliance_evaluation_run_from_record,
)
from policy_pipeline.compliance_review.models import (
    ComplianceReviewDecision,
    ComplianceReviewDetail,
    ComplianceReviewQueueItem,
    ComplianceReviewResolutionType,
)
from policy_pipeline.compliance_review.store import (
    get_compliance_review_decision,
    list_resolved_evaluation_outcome_ids,
    record_compliance_review_decision,
)
from policy_pipeline.expense_reports import get_expense_report
from policy_pipeline.rules.models import Citation

DEFAULT_ACTIONABLE_OUTCOMES: frozenset[ComplianceOutcome] = frozenset(
    {
        ComplianceOutcome.NEEDS_REVIEW,
        ComplianceOutcome.MISSING_EVIDENCE,
        ComplianceOutcome.VIOLATION,
    }
)


def build_compliance_review_id(
    *,
    compliance_evaluation_run_id: str,
    row_index: int,
) -> str:
    return f"{compliance_evaluation_run_id}:{row_index}"


def parse_compliance_review_id(compliance_review_id: str) -> tuple[str, int]:
    if ":" not in compliance_review_id:
        raise InvalidComplianceReviewIdError(compliance_review_id)
    run_id, row_index_raw = compliance_review_id.rsplit(":", maxsplit=1)
    if not run_id or not row_index_raw.isdigit():
        raise InvalidComplianceReviewIdError(compliance_review_id)
    return run_id, int(row_index_raw)


def list_compliance_reviews(
    session: Session,
    *,
    compliance_evaluation_run_id: str | None = None,
    include_violations: bool = True,
    outcomes: Iterable[ComplianceOutcome] | None = None,
) -> list[ComplianceReviewQueueItem]:
    actionable_outcomes = _resolve_actionable_outcomes(
        include_violations=include_violations,
        outcomes=outcomes,
    )
    runs = _list_runs_for_review(
        session,
        compliance_evaluation_run_id=compliance_evaluation_run_id,
    )
    resolved_ids = list_resolved_evaluation_outcome_ids(session)
    items: list[ComplianceReviewQueueItem] = []
    for compliance_run in runs:
        for row_outcome in compliance_run.row_outcomes:
            if row_outcome.outcome not in actionable_outcomes:
                continue
            review_id = build_compliance_review_id(
                compliance_evaluation_run_id=compliance_run.compliance_evaluation_run_id,
                row_index=row_outcome.row_index,
            )
            if review_id in resolved_ids:
                continue
            items.append(
                _queue_item_from_outcome(
                    compliance_run,
                    row_outcome,
                )
            )
    return items


def get_compliance_review(
    session: Session,
    *,
    compliance_review_id: str,
) -> ComplianceReviewDetail | None:
    try:
        run_id, row_index = parse_compliance_review_id(compliance_review_id)
    except InvalidComplianceReviewIdError:
        return None

    compliance_run = get_compliance_evaluation_run(
        session,
        compliance_evaluation_run_id=run_id,
    )
    if compliance_run is None:
        return None

    row_outcome = _find_row_outcome(compliance_run, row_index=row_index)
    if row_outcome is None:
        return None
    if row_outcome.outcome is ComplianceOutcome.PASS:
        return None

    expense_report = get_expense_report(
        session,
        expense_report_id=compliance_run.expense_report_id,
    )
    if expense_report is None or row_index >= len(expense_report.rows):
        return None

    rule_statement = _resolve_rule_statement(
        session,
        compiled_rule_set_id=compliance_run.compiled_rule_set_id,
        rule_id=row_outcome.rule_id,
        fallback_reason=row_outcome.reason,
    )
    citation = _primary_citation(row_outcome)
    decision = get_compliance_review_decision(
        session,
        evaluation_outcome_id=build_compliance_review_id(
            compliance_evaluation_run_id=run_id,
            row_index=row_index,
        ),
    )

    return ComplianceReviewDetail(
        compliance_review_id=build_compliance_review_id(
            compliance_evaluation_run_id=run_id,
            row_index=row_index,
        ),
        compliance_evaluation_run_id=run_id,
        expense_report_id=compliance_run.expense_report_id,
        policy_version_id=compliance_run.policy_version_id,
        compiled_rule_set_id=compliance_run.compiled_rule_set_id,
        executed_at=compliance_run.executed_at,
        expense_row=expense_report.rows[row_index],
        row_outcome=row_outcome,
        rule_statement=rule_statement,
        citation=citation,
        decision=decision,
    )


def resolve_compliance_review(
    session: Session,
    *,
    compliance_review_id: str,
    resolution_type: ComplianceReviewResolutionType,
    rationale: str,
    recorded_by: str,
) -> ComplianceReviewDecision:
    review = get_compliance_review(session, compliance_review_id=compliance_review_id)
    if review is None:
        raise ComplianceReviewNotFoundError(compliance_review_id)
    if review.decision is not None:
        raise ComplianceReviewAlreadyResolvedError(compliance_review_id)

    trimmed_rationale = rationale.strip()
    if not trimmed_rationale:
        raise ComplianceReviewRationaleRequiredError()

    return record_compliance_review_decision(
        session,
        evaluation_outcome_id=review.compliance_review_id,
        compliance_evaluation_run_id=review.compliance_evaluation_run_id,
        row_index=review.row_outcome.row_index,
        resolution_type=resolution_type,
        rationale=trimmed_rationale,
        recorded_by=recorded_by,
    )


def _resolve_actionable_outcomes(
    *,
    include_violations: bool,
    outcomes: Iterable[ComplianceOutcome] | None,
) -> frozenset[ComplianceOutcome]:
    if outcomes is not None:
        return frozenset(outcomes)
    if include_violations:
        return DEFAULT_ACTIONABLE_OUTCOMES
    return frozenset(
        outcome
        for outcome in DEFAULT_ACTIONABLE_OUTCOMES
        if outcome is not ComplianceOutcome.VIOLATION
    )


def _list_runs_for_review(
    session: Session,
    *,
    compliance_evaluation_run_id: str | None,
) -> list[ComplianceEvaluationRun]:
    if compliance_evaluation_run_id is not None:
        compliance_run = get_compliance_evaluation_run(
            session,
            compliance_evaluation_run_id=compliance_evaluation_run_id,
        )
        return [compliance_run] if compliance_run is not None else []

    records = session.scalars(
        select(ComplianceEvaluationRunRecord).order_by(
            ComplianceEvaluationRunRecord.executed_at.desc(),
            ComplianceEvaluationRunRecord.compliance_evaluation_run_id.asc(),
        )
    ).all()
    return [compliance_evaluation_run_from_record(record) for record in records]


def _queue_item_from_outcome(
    compliance_run: ComplianceEvaluationRun,
    row_outcome,
) -> ComplianceReviewQueueItem:
    return ComplianceReviewQueueItem(
        compliance_review_id=build_compliance_review_id(
            compliance_evaluation_run_id=compliance_run.compliance_evaluation_run_id,
            row_index=row_outcome.row_index,
        ),
        compliance_evaluation_run_id=compliance_run.compliance_evaluation_run_id,
        expense_report_id=compliance_run.expense_report_id,
        row_index=row_outcome.row_index,
        outcome=row_outcome.outcome,
        rule_id=row_outcome.rule_id,
        employee_id=row_outcome.employee_id,
        expense_date=row_outcome.expense_date,
        reason=row_outcome.reason,
        executed_at=compliance_run.executed_at,
    )


def _find_row_outcome(
    compliance_run: ComplianceEvaluationRun,
    *,
    row_index: int,
):
    for row_outcome in compliance_run.row_outcomes:
        if row_outcome.row_index == row_index:
            return row_outcome
    return None


def _resolve_rule_statement(
    session: Session,
    *,
    compiled_rule_set_id: str,
    rule_id: str | None,
    fallback_reason: str | None,
) -> str | None:
    if rule_id is None:
        return fallback_reason

    compiled_rule_set = get_compiled_rule_set(
        session,
        compiled_rule_set_id=compiled_rule_set_id,
    )
    if compiled_rule_set is None:
        return fallback_reason

    for entry in compiled_rule_set.entries:
        if entry.rule_id != rule_id:
            continue
        if entry.compiled_rule is not None:
            return entry.compiled_rule.statement
        return entry.source_rule.statement
    return fallback_reason


def _primary_citation(row_outcome) -> Citation | None:
    if row_outcome.evidence:
        return row_outcome.evidence[0]
    return None


class InvalidComplianceReviewIdError(Exception):
    def __init__(self, compliance_review_id: str) -> None:
        self.compliance_review_id = compliance_review_id
        super().__init__(compliance_review_id)


class ComplianceReviewNotFoundError(Exception):
    def __init__(self, compliance_review_id: str) -> None:
        self.compliance_review_id = compliance_review_id
        super().__init__(compliance_review_id)


class ComplianceReviewAlreadyResolvedError(Exception):
    def __init__(self, compliance_review_id: str) -> None:
        self.compliance_review_id = compliance_review_id
        super().__init__(compliance_review_id)


class ComplianceReviewRationaleRequiredError(Exception):
    pass
