from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy.orm import Session

from policy_pipeline.compiled_rule_sets.models import CompiledExecutableRule
from policy_pipeline.compiled_rule_sets.store import get_compiled_rule_set
from policy_pipeline.compliance_evaluation_runs.evaluator import (
    evaluate_expense_row_for_compliance_v1,
)
from policy_pipeline.compliance_evaluation_runs.models import (
    ComplianceEvaluationRowOutcome,
    ComplianceEvaluationRun,
    ComplianceEvaluationRunSummary,
    ComplianceOutcome,
)
from policy_pipeline.compliance_evaluation_runs.records import ComplianceEvaluationRunRecord
from policy_pipeline.compliance_evaluation_runs.store import (
    compliance_evaluation_run_from_record,
)
from policy_pipeline.expense_reports import get_expense_report
from policy_pipeline.rule_test_cases.evaluator import UnsupportedRuleEvaluationError


def execute_compliance_evaluation_run(
    session: Session,
    *,
    expense_report_id: str,
    compiled_rule_set_id: str,
    executed_by: str,
) -> ComplianceEvaluationRun:
    expense_report = get_expense_report(session, expense_report_id=expense_report_id)
    if expense_report is None:
        raise ExpenseReportNotFoundError(expense_report_id)

    compiled_rule_set = get_compiled_rule_set(
        session,
        compiled_rule_set_id=compiled_rule_set_id,
    )
    if compiled_rule_set is None:
        raise CompiledRuleSetNotFoundError(compiled_rule_set_id)

    compiled_rules = _compiled_rules_in_order(compiled_rule_set.entries)
    if not compiled_rules:
        raise NoCompiledRulesError(compiled_rule_set_id)

    executed_at = datetime.now(UTC)
    row_outcomes: list[ComplianceEvaluationRowOutcome] = []
    for row_index, row in enumerate(expense_report.rows):
        row_outcomes.append(
            _evaluate_row(
                compiled_rules,
                row,
                row_index=row_index,
            )
        )

    pass_count = sum(
        1 for outcome in row_outcomes if outcome.outcome is ComplianceOutcome.PASS
    )
    violation_count = len(row_outcomes) - pass_count
    summary = ComplianceEvaluationRunSummary(
        total_count=len(row_outcomes),
        pass_count=pass_count,
        violation_count=violation_count,
    )
    compliance_run = ComplianceEvaluationRun(
        compliance_evaluation_run_id=f"cer-{uuid4().hex}",
        expense_report_id=expense_report_id,
        compiled_rule_set_id=compiled_rule_set_id,
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
    return compliance_run


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


def _compiled_rules_in_order(entries) -> list[CompiledExecutableRule]:
    compiled_rules: list[CompiledExecutableRule] = []
    for entry in entries:
        if entry.status.value == "compiled" and entry.compiled_rule is not None:
            compiled_rules.append(entry.compiled_rule)
    return compiled_rules


def _evaluate_row(
    compiled_rules: list[CompiledExecutableRule],
    row,
    *,
    row_index: int,
) -> ComplianceEvaluationRowOutcome:
    for compiled_rule in compiled_rules:
        try:
            outcome = evaluate_expense_row_for_compliance_v1(compiled_rule, row)
        except UnsupportedRuleEvaluationError as exc:
            raise UnsupportedRuleEvaluationError(
                f"Rule {compiled_rule.rule_id}: {exc.detail}",
            ) from exc

        if outcome is ComplianceOutcome.VIOLATION:
            return ComplianceEvaluationRowOutcome(
                row_index=row_index,
                employee_id=row.employee_id,
                expense_date=row.expense_date,
                outcome=ComplianceOutcome.VIOLATION,
                rule_id=compiled_rule.rule_id,
                reason=compiled_rule.statement,
            )

    return ComplianceEvaluationRowOutcome(
        row_index=row_index,
        employee_id=row.employee_id,
        expense_date=row.expense_date,
        outcome=ComplianceOutcome.PASS,
        rule_id=None,
        reason=None,
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
