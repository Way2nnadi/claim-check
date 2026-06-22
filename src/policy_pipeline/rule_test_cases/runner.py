from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy.orm import Session

from policy_pipeline.compiled_rule_sets.models import CompiledExecutableRule
from policy_pipeline.compiled_rule_sets.store import get_compiled_rule_set
from policy_pipeline.rule_test_cases.evaluator import (
    UnsupportedRuleEvaluationError,
    evaluate_expense_for_rule,
)
from policy_pipeline.rule_test_cases.models import (
    RuleTestRun,
    RuleTestRunCaseResult,
    RuleTestRunSummary,
)
from policy_pipeline.rule_test_cases.records import RuleTestRunRecord
from policy_pipeline.rule_test_cases.store import (
    CompiledRuleSetNotFoundError,
    list_active_rule_test_cases,
    rule_test_run_from_record,
)


def execute_rule_test_run(
    session: Session,
    *,
    compiled_rule_set_id: str,
    executed_by: str,
) -> RuleTestRun:
    compiled_rule_set = get_compiled_rule_set(
        session,
        compiled_rule_set_id=compiled_rule_set_id,
    )
    if compiled_rule_set is None:
        raise CompiledRuleSetNotFoundError(compiled_rule_set_id)

    cases = list_active_rule_test_cases(session, compiled_rule_set_id=compiled_rule_set_id)
    if not cases:
        raise NoRuleTestCasesError(compiled_rule_set_id)

    compiled_rules_by_id: dict[str, CompiledExecutableRule] = {}
    for entry in compiled_rule_set.entries:
        if entry.status.value == "compiled" and entry.compiled_rule is not None:
            compiled_rules_by_id[entry.rule_id] = entry.compiled_rule

    executed_at = datetime.now(UTC)
    case_results: list[RuleTestRunCaseResult] = []
    for case in cases:
        compiled_rule = compiled_rules_by_id.get(case.rule_id)
        if compiled_rule is None:
            raise RuleNotCompiledError(case.rule_id)

        try:
            actual_outcome = evaluate_expense_for_rule(
                compiled_rule,
                case.expense_fixture,
            )
        except UnsupportedRuleEvaluationError as exc:
            raise UnsupportedRuleEvaluationError(
                f"Rule {case.rule_id}: {exc.detail}",
            ) from exc

        case_results.append(
            RuleTestRunCaseResult(
                rule_test_case_id=case.rule_test_case_id,
                rule_id=case.rule_id,
                variant=case.variant,
                expected_outcome=case.expected_outcome,
                actual_outcome=actual_outcome,
                passed=actual_outcome == case.expected_outcome,
            )
        )

    passed_count = sum(1 for result in case_results if result.passed)
    failed_count = len(case_results) - passed_count
    summary = RuleTestRunSummary(
        total_count=len(case_results),
        passed_count=passed_count,
        failed_count=failed_count,
        overall_passed=failed_count == 0,
    )
    rule_test_run = RuleTestRun(
        rule_test_run_id=f"rtr-{uuid4().hex}",
        compiled_rule_set_id=compiled_rule_set_id,
        executed_by=executed_by,
        executed_at=executed_at,
        summary=summary,
        case_results=case_results,
    )
    session.add(
        RuleTestRunRecord(
            rule_test_run_id=rule_test_run.rule_test_run_id,
            compiled_rule_set_id=rule_test_run.compiled_rule_set_id,
            executed_by=rule_test_run.executed_by,
            payload=rule_test_run.model_dump(mode="json"),
            executed_at=executed_at,
        )
    )
    session.flush()
    return rule_test_run


def get_rule_test_run(
    session: Session,
    *,
    rule_test_run_id: str,
) -> RuleTestRun | None:
    record = session.get(RuleTestRunRecord, rule_test_run_id)
    if record is None:
        return None
    return rule_test_run_from_record(record)


def list_rule_test_runs(
    session: Session,
    *,
    compiled_rule_set_id: str,
) -> list[RuleTestRun]:
    from sqlalchemy import select

    records = session.scalars(
        select(RuleTestRunRecord)
        .where(RuleTestRunRecord.compiled_rule_set_id == compiled_rule_set_id)
        .order_by(
            RuleTestRunRecord.executed_at.desc(),
            RuleTestRunRecord.rule_test_run_id.asc(),
        )
    ).all()
    return [rule_test_run_from_record(record) for record in records]


class RuleNotCompiledError(Exception):
    def __init__(self, rule_id: str) -> None:
        self.rule_id = rule_id
        super().__init__(rule_id)


class NoRuleTestCasesError(Exception):
    def __init__(self, compiled_rule_set_id: str) -> None:
        self.compiled_rule_set_id = compiled_rule_set_id
        super().__init__(compiled_rule_set_id)
