from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from policy_pipeline.compiled_rule_sets.store import get_compiled_rule_set
from policy_pipeline.rule_test_cases.generator import (
    UnsupportedConditionFieldError,
    UnsupportedConditionOperatorError,
    generate_rule_test_cases,
    group_rule_test_cases,
)
from policy_pipeline.rule_test_cases.models import (
    EvaluationOutcome,
    RuleTestCase,
    RuleTestCaseListResponse,
    RuleTestCaseStatus,
    RuleTestRun,
)
from policy_pipeline.expense_reports import ExpenseReportRow
from policy_pipeline.rule_test_cases.records import RuleTestCaseRecord, RuleTestRunRecord


def generate_rule_test_cases_for_compiled_rule_set(
    session: Session,
    *,
    compiled_rule_set_id: str,
    generated_by: str,
) -> tuple[list[RuleTestCase], bool]:
    compiled_rule_set = get_compiled_rule_set(
        session,
        compiled_rule_set_id=compiled_rule_set_id,
    )
    if compiled_rule_set is None:
        raise CompiledRuleSetNotFoundError(compiled_rule_set_id)

    existing = list_rule_test_cases(session, compiled_rule_set_id=compiled_rule_set_id)
    if existing:
        return existing, False

    enforceable_count = compiled_rule_set.summary.compiled
    if enforceable_count == 0:
        raise NoEnforceableRulesError(compiled_rule_set_id)

    generated_at = datetime.now(UTC)
    try:
        cases = generate_rule_test_cases(
            compiled_rule_set,
            generated_by=generated_by,
            generated_at=generated_at,
        )
    except UnsupportedConditionFieldError as exc:
        raise UnsupportedRuleConditionError(exc.field) from exc
    except UnsupportedConditionOperatorError as exc:
        raise UnsupportedRuleConditionError(
            f"{exc.field} with operator {exc.operator!r}",
        ) from exc
    except ValueError as exc:
        raise UnsupportedRuleConditionError(str(exc)) from exc
    for case in cases:
        session.add(
            RuleTestCaseRecord(
                rule_test_case_id=case.rule_test_case_id,
                compiled_rule_set_id=case.compiled_rule_set_id,
                rule_id=case.rule_id,
                generated_by=case.generated_by,
                payload=case.model_dump(mode="json"),
                generated_at=generated_at,
            )
        )
    session.flush()
    return cases, True


def list_rule_test_cases(
    session: Session,
    *,
    compiled_rule_set_id: str,
) -> list[RuleTestCase]:
    records = session.scalars(
        select(RuleTestCaseRecord)
        .where(RuleTestCaseRecord.compiled_rule_set_id == compiled_rule_set_id)
        .order_by(
            RuleTestCaseRecord.rule_id.asc(),
            RuleTestCaseRecord.generated_at.asc(),
            RuleTestCaseRecord.rule_test_case_id.asc(),
        )
    ).all()
    return [rule_test_case_from_record(record) for record in records]


def is_rule_test_case_active(case: RuleTestCase) -> bool:
    return case.status is RuleTestCaseStatus.ACTIVE


def list_active_rule_test_cases(
    session: Session,
    *,
    compiled_rule_set_id: str,
) -> list[RuleTestCase]:
    return [
        case
        for case in list_rule_test_cases(
            session,
            compiled_rule_set_id=compiled_rule_set_id,
        )
        if is_rule_test_case_active(case)
    ]


def get_rule_test_case(
    session: Session,
    *,
    rule_test_case_id: str,
) -> RuleTestCase | None:
    record = session.get(RuleTestCaseRecord, rule_test_case_id)
    if record is None:
        return None
    return rule_test_case_from_record(record)


def disable_rule_test_case(
    session: Session,
    *,
    rule_test_case_id: str,
    disabled_by: str,
    rationale: str,
) -> RuleTestCase:
    record = session.get(RuleTestCaseRecord, rule_test_case_id)
    if record is None:
        raise RuleTestCaseNotFoundError(rule_test_case_id)

    case = rule_test_case_from_record(record)
    if not is_rule_test_case_active(case):
        raise RuleTestCaseAlreadyDisabledError(rule_test_case_id)

    disabled_at = datetime.now(UTC)
    updated = case.model_copy(
        update={
            "status": RuleTestCaseStatus.DISABLED,
            "disabled_at": disabled_at,
            "disabled_by": disabled_by,
            "disable_rationale": rationale,
        }
    )
    record.payload = updated.model_dump(mode="json")
    session.flush()
    return updated


def enable_rule_test_case(
    session: Session,
    *,
    rule_test_case_id: str,
    rationale: str,
) -> RuleTestCase:
    record = session.get(RuleTestCaseRecord, rule_test_case_id)
    if record is None:
        raise RuleTestCaseNotFoundError(rule_test_case_id)

    case = rule_test_case_from_record(record)
    if is_rule_test_case_active(case):
        raise RuleTestCaseAlreadyEnabledError(rule_test_case_id)

    updated = case.model_copy(
        update={
            "status": RuleTestCaseStatus.ACTIVE,
            "disabled_at": None,
            "disabled_by": None,
            "disable_rationale": None,
        }
    )
    record.payload = updated.model_dump(mode="json")
    session.flush()
    return updated


def edit_rule_test_case(
    session: Session,
    *,
    rule_test_case_id: str,
    edited_by: str,
    rationale: str,
    expense_fixture: ExpenseReportRow | None = None,
    expected_outcome: EvaluationOutcome | None = None,
) -> tuple[RuleTestCase, list[str]]:
    record = session.get(RuleTestCaseRecord, rule_test_case_id)
    if record is None:
        raise RuleTestCaseNotFoundError(rule_test_case_id)

    case = rule_test_case_from_record(record)
    if not is_rule_test_case_active(case):
        raise RuleTestCaseNotActiveError(rule_test_case_id)

    updates: dict[str, object] = {}
    updated_fields: list[str] = []

    if expense_fixture is not None and expense_fixture != case.expense_fixture:
        updates["expense_fixture"] = expense_fixture
        updated_fields.append("expense_fixture")
    if (
        expected_outcome is not None
        and expected_outcome != case.expected_outcome
    ):
        updates["expected_outcome"] = expected_outcome
        updated_fields.append("expected_outcome")

    if not updated_fields:
        raise RuleTestCaseNoChangesError(rule_test_case_id)

    edited_at = datetime.now(UTC)
    updated = case.model_copy(
        update={
            **updates,
            "edited_at": edited_at,
            "edited_by": edited_by,
            "edit_rationale": rationale,
        }
    )
    record.payload = updated.model_dump(mode="json")
    session.flush()
    return updated, sorted(updated_fields)


def list_rule_test_cases_grouped(
    session: Session,
    *,
    compiled_rule_set_id: str,
    status_filter: RuleTestCaseStatus | None = None,
) -> RuleTestCaseListResponse:
    compiled_rule_set = get_compiled_rule_set(
        session,
        compiled_rule_set_id=compiled_rule_set_id,
    )
    if compiled_rule_set is None:
        raise CompiledRuleSetNotFoundError(compiled_rule_set_id)

    cases = list_rule_test_cases(session, compiled_rule_set_id=compiled_rule_set_id)
    active_count = sum(1 for case in cases if is_rule_test_case_active(case))
    disabled_count = len(cases) - active_count
    if status_filter is RuleTestCaseStatus.ACTIVE:
        filtered_cases = [case for case in cases if is_rule_test_case_active(case)]
    elif status_filter is RuleTestCaseStatus.DISABLED:
        filtered_cases = [
            case for case in cases if case.status is RuleTestCaseStatus.DISABLED
        ]
    else:
        filtered_cases = cases
    groups = group_rule_test_cases(compiled_rule_set, filtered_cases)
    return RuleTestCaseListResponse(
        compiled_rule_set_id=compiled_rule_set_id,
        groups=groups,
        total_count=len(cases),
        active_count=active_count,
        disabled_count=disabled_count,
    )


def rule_test_run_from_record(record: RuleTestRunRecord) -> RuleTestRun:
    executed_at = record.executed_at
    if executed_at.tzinfo is None:
        executed_at = executed_at.replace(tzinfo=UTC)
    else:
        executed_at = executed_at.astimezone(UTC)
    rule_test_run = RuleTestRun.model_validate(record.payload)
    return rule_test_run.model_copy(update={"executed_at": executed_at})


def rule_test_case_from_record(record: RuleTestCaseRecord) -> RuleTestCase:
    generated_at = record.generated_at
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=UTC)
    else:
        generated_at = generated_at.astimezone(UTC)
    rule_test_case = RuleTestCase.model_validate(record.payload)
    updates: dict[str, object] = {"generated_at": generated_at}
    if rule_test_case.disabled_at is not None:
        disabled_at = rule_test_case.disabled_at
        if disabled_at.tzinfo is None:
            disabled_at = disabled_at.replace(tzinfo=UTC)
        else:
            disabled_at = disabled_at.astimezone(UTC)
        updates["disabled_at"] = disabled_at
    if rule_test_case.edited_at is not None:
        edited_at = rule_test_case.edited_at
        if edited_at.tzinfo is None:
            edited_at = edited_at.replace(tzinfo=UTC)
        else:
            edited_at = edited_at.astimezone(UTC)
        updates["edited_at"] = edited_at
    return rule_test_case.model_copy(update=updates)


class CompiledRuleSetNotFoundError(Exception):
    def __init__(self, compiled_rule_set_id: str) -> None:
        self.compiled_rule_set_id = compiled_rule_set_id
        super().__init__(compiled_rule_set_id)


class NoEnforceableRulesError(Exception):
    def __init__(self, compiled_rule_set_id: str) -> None:
        self.compiled_rule_set_id = compiled_rule_set_id
        super().__init__(compiled_rule_set_id)


class UnsupportedRuleConditionError(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail
        super().__init__(detail)


class RuleTestCaseNotFoundError(Exception):
    def __init__(self, rule_test_case_id: str) -> None:
        self.rule_test_case_id = rule_test_case_id
        super().__init__(rule_test_case_id)


class RuleTestCaseAlreadyDisabledError(Exception):
    def __init__(self, rule_test_case_id: str) -> None:
        self.rule_test_case_id = rule_test_case_id
        super().__init__(rule_test_case_id)


class RuleTestCaseAlreadyEnabledError(Exception):
    def __init__(self, rule_test_case_id: str) -> None:
        self.rule_test_case_id = rule_test_case_id
        super().__init__(rule_test_case_id)


class RuleTestCaseNotActiveError(Exception):
    def __init__(self, rule_test_case_id: str) -> None:
        self.rule_test_case_id = rule_test_case_id
        super().__init__(rule_test_case_id)


class RuleTestCaseNoChangesError(Exception):
    def __init__(self, rule_test_case_id: str) -> None:
        self.rule_test_case_id = rule_test_case_id
        super().__init__(rule_test_case_id)
