from __future__ import annotations

from datetime import date

from policy_pipeline.compliance_evaluation_runs.models import ComplianceEvaluationRun
from policy_pipeline.expense_reports import (
    ExpenseReportRow,
    compute_expense_input_fingerprint,
)


def test_compute_expense_input_fingerprint_is_stable_for_identical_rows() -> None:
    rows = [
        ExpenseReportRow(
            employee_id="emp-001",
            expense_date=date(2026, 6, 21),
            expense_category="meals",
            amount="100.00",
            currency="USD",
        )
    ]
    first = compute_expense_input_fingerprint(
        source_filename="expenses.csv",
        rows=rows,
    )
    second = compute_expense_input_fingerprint(
        source_filename="expenses.csv",
        rows=rows,
    )

    assert first == second
    assert first.source_filename == "expenses.csv"
    assert first.row_count == 1
    assert len(first.content_hash) == 64


def test_compute_expense_input_fingerprint_changes_when_row_content_changes() -> None:
    base_rows = [
        ExpenseReportRow(
            employee_id="emp-001",
            expense_date=date(2026, 6, 21),
            expense_category="meals",
            amount="100.00",
            currency="USD",
        )
    ]
    changed_rows = [
        ExpenseReportRow(
            employee_id="emp-001",
            expense_date=date(2026, 6, 21),
            expense_category="meals",
            amount="101.00",
            currency="USD",
        )
    ]

    base = compute_expense_input_fingerprint(
        source_filename="expenses.csv",
        rows=base_rows,
    )
    changed = compute_expense_input_fingerprint(
        source_filename="expenses.csv",
        rows=changed_rows,
    )

    assert base.content_hash != changed.content_hash
    assert base.row_count == changed.row_count


def test_compute_expense_input_fingerprint_content_hash_is_independent_of_filename() -> None:
    rows = [
        ExpenseReportRow(
            employee_id="emp-001",
            expense_date=date(2026, 6, 21),
            expense_category="meals",
            amount="100.00",
            currency="USD",
        )
    ]
    first = compute_expense_input_fingerprint(
        source_filename="expenses-june.csv",
        rows=rows,
    )
    second = compute_expense_input_fingerprint(
        source_filename="expenses-renamed.csv",
        rows=rows,
    )

    assert first.content_hash == second.content_hash
    assert first.source_filename != second.source_filename


def test_compliance_evaluation_run_includes_expense_input_fingerprint_field() -> None:
    run = ComplianceEvaluationRun.model_validate(
        {
            "compliance_evaluation_run_id": "cer-abc",
            "expense_report_id": "expense-report-1",
            "expense_input_fingerprint": {
                "source_filename": "expenses.csv",
                "row_count": 2,
                "content_hash": "a" * 64,
            },
            "compiled_rule_set_id": "compiled-rule-set-1",
            "policy_version_id": "policy-v1",
            "executed_by": "admin-user",
            "executed_at": "2026-06-21T12:00:00Z",
            "summary": {
                "total_count": 2,
                "pass_count": 2,
                "violation_count": 0,
            },
            "row_outcomes": [],
        }
    )

    assert run.expense_input_fingerprint is not None
    assert run.expense_input_fingerprint.source_filename == "expenses.csv"
