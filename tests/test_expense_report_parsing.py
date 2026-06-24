from __future__ import annotations

import pytest

from policy_pipeline.expense_reports import (
    ExpenseReportImportValidationError,
    _parse_expense_report_rows,
    validate_expense_report_upload_filename,
)


def test_validate_expense_report_upload_filename_requires_csv_suffix() -> None:
    with pytest.raises(ValueError, match=r"\.csv"):
        validate_expense_report_upload_filename("expenses.txt")

    assert validate_expense_report_upload_filename("expenses.csv") == "expenses.csv"


def test_parse_expense_report_rows_normalizes_optional_fields() -> None:
    csv_bytes = (
        "employee_id,expense_date,expense_category,amount,currency,country,"
        "travel_type,business_purpose,attendee_list,manager_approval,"
        "receipt_attached,trip_id,submission_days\n"
        ' emp-001 ,2026-06-21,meals,42,usd, us , domestic ,Team dinner,'
        " Alice; Bob , YES , 0 , trip-7 , 14 \n"
    ).encode("utf-8")

    rows = _parse_expense_report_rows(csv_bytes)

    assert len(rows) == 1
    row = rows[0]
    assert row.employee_id == "emp-001"
    assert row.amount == "42"
    assert row.currency == "USD"
    assert row.country == "us"
    assert row.travel_type == "domestic"
    assert row.business_purpose == "Team dinner"
    assert row.attendee_list == "Alice; Bob"
    assert row.manager_approval is True
    assert row.receipt_attached is False
    assert row.trip_id == "trip-7"
    assert row.submission_days == 14


def test_parse_expense_report_rows_treats_blank_optional_fields_as_null() -> None:
    csv_bytes = (
        "employee_id,expense_date,expense_category,amount,currency,country,"
        "submission_days\n"
        "emp-001,2026-06-21,meals,42.00,USD,,\n"
    ).encode("utf-8")

    rows = _parse_expense_report_rows(csv_bytes)

    assert rows[0].country is None
    assert rows[0].submission_days is None


def test_parse_expense_report_rows_rejects_invalid_submission_days() -> None:
    csv_bytes = (
        "employee_id,expense_date,expense_category,amount,currency,submission_days\n"
        "emp-001,2026-06-21,meals,42.00,USD,-1\n"
    ).encode("utf-8")

    with pytest.raises(ExpenseReportImportValidationError) as exc_info:
        _parse_expense_report_rows(csv_bytes)

    assert exc_info.value.row_errors[0].row_number == 2
    assert "submission_days must be zero or greater." in exc_info.value.row_errors[0].errors


def test_parse_expense_report_rows_rejects_non_utf8_encoding() -> None:
    with pytest.raises(ExpenseReportImportValidationError) as exc_info:
        _parse_expense_report_rows(b"\xff\xfe")

    assert exc_info.value.file_errors == ["Expense Report CSV must be UTF-8 encoded."]


def test_parse_expense_report_rows_rejects_empty_data_rows() -> None:
    csv_bytes = (
        "employee_id,expense_date,expense_category,amount,currency\n"
    ).encode("utf-8")

    with pytest.raises(ExpenseReportImportValidationError) as exc_info:
        _parse_expense_report_rows(csv_bytes)

    assert exc_info.value.file_errors == [
        "Expense Report CSV must include at least one data row.",
    ]
