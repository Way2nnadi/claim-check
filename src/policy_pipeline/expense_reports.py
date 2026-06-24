from __future__ import annotations

import csv
import hashlib
import json
import re
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from io import StringIO
from pathlib import PurePosixPath
from uuid import uuid4

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from policy_pipeline.shared.database import ExpenseReportRecord

_REQUIRED_COLUMNS = (
    "employee_id",
    "expense_date",
    "expense_category",
    "amount",
    "currency",
)
_OPTIONAL_COLUMNS = (
    "country",
    "travel_type",
    "business_purpose",
    "attendee_list",
    "manager_approval",
    "receipt_attached",
    "trip_id",
    "submission_days",
)
REQUIRED_CSV_COLUMNS = _REQUIRED_COLUMNS
OPTIONAL_CSV_COLUMNS = _OPTIONAL_COLUMNS
_ALLOWED_COLUMNS = frozenset((*_REQUIRED_COLUMNS, *_OPTIONAL_COLUMNS))
_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
_TRUE_VALUES = {"true", "yes", "1"}
_FALSE_VALUES = {"false", "no", "0"}


class ExpenseInputFingerprint(BaseModel):
    """Stable hash of normalized row content for Compliance Evaluation replay."""

    source_filename: str = Field(
        min_length=1,
        description="Original CSV filename at import time (metadata only; not hashed).",
    )
    row_count: int = Field(ge=0, description="Number of normalized rows.")
    content_hash: str = Field(
        min_length=64,
        max_length=64,
        description="SHA-256 of normalized row JSON (sorted keys, compact separators).",
    )


class ExpenseReportRow(BaseModel):
    """Normalized v1 Expense Report row used by the Compliance Evaluator."""

    employee_id: str = Field(min_length=1, description="Employee identifier.")
    expense_date: date = Field(description="Expense date in ISO YYYY-MM-DD format.")
    expense_category: str = Field(min_length=1, description="Expense category.")
    amount: str = Field(
        min_length=1,
        description="Decimal amount stored as a normalized string.",
    )
    currency: str = Field(
        min_length=3,
        max_length=3,
        pattern=r"^[A-Z]{3}$",
        description="Uppercase ISO 4217 currency code.",
    )
    country: str | None = Field(
        default=None,
        description="Optional country or region scope value.",
    )
    travel_type: str | None = Field(
        default=None,
        description="Optional travel type scope value.",
    )
    business_purpose: str | None = Field(
        default=None,
        description="Optional business purpose for subjective Rules.",
    )
    attendee_list: str | None = Field(
        default=None,
        description="Optional attendee list for per-attendee aggregation.",
    )
    manager_approval: bool | None = Field(
        default=None,
        description="Optional manager approval flag.",
    )
    receipt_attached: bool | None = Field(
        default=None,
        description="Optional receipt attachment flag.",
    )
    trip_id: str | None = Field(
        default=None,
        description="Optional trip identifier for per-trip aggregation.",
    )
    submission_days: int | None = Field(
        default=None,
        ge=0,
        description="Optional days since submission for timeliness Rules.",
    )


class ExpenseReportSummary(BaseModel):
    expense_report_id: str = Field(min_length=1)
    imported_by: str = Field(min_length=1)
    source_filename: str = Field(min_length=1)
    row_count: int = Field(ge=0)
    created_at: datetime


class ExpenseReport(BaseModel):
    expense_report_id: str = Field(min_length=1)
    imported_by: str = Field(min_length=1)
    source_filename: str = Field(min_length=1)
    row_count: int = Field(ge=0)
    rows: list[ExpenseReportRow] = Field(default_factory=list)
    created_at: datetime
    input_fingerprint: ExpenseInputFingerprint | None = Field(
        default=None,
        description=(
            "Computed fingerprint of normalized row content. "
            "Compliance Evaluation Runs pin the same hash at execution time."
        ),
    )


class ExpenseReportListResponse(BaseModel):
    items: list[ExpenseReportSummary]


class ExpenseReportImportRowError(BaseModel):
    row_number: int = Field(ge=2)
    errors: list[str] = Field(default_factory=list)


class ExpenseReportImportErrorResponse(BaseModel):
    """422 response when CSV validation fails. Nothing is persisted."""

    detail: str = "Expense Report import rejected."
    file_errors: list[str] = Field(
        default_factory=list,
        description="File-level issues such as missing headers or unknown columns.",
    )
    row_errors: list[ExpenseReportImportRowError] = Field(
        default_factory=list,
        description="Per-row validation issues keyed by 1-based CSV row number.",
    )


class ExpenseReportImportValidationError(Exception):
    def __init__(
        self,
        *,
        file_errors: list[str] | None = None,
        row_errors: list[ExpenseReportImportRowError] | None = None,
    ) -> None:
        self.file_errors = list(file_errors or [])
        self.row_errors = list(row_errors or [])
        super().__init__("Expense Report import rejected.")


def compute_expense_input_fingerprint(
    *,
    source_filename: str,
    rows: list[ExpenseReportRow],
) -> ExpenseInputFingerprint:
    normalized_rows = [row.model_dump(mode="json") for row in rows]
    content_payload = json.dumps(
        normalized_rows,
        sort_keys=True,
        separators=(",", ":"),
    )
    content_hash = hashlib.sha256(content_payload.encode("utf-8")).hexdigest()
    return ExpenseInputFingerprint(
        source_filename=source_filename,
        row_count=len(rows),
        content_hash=content_hash,
    )


def validate_expense_report_upload_filename(filename: str | None) -> str:
    safe_filename = PurePosixPath(filename or "").name
    if PurePosixPath(safe_filename).suffix.lower() != ".csv":
        raise ValueError("Expense Report imports require a .csv file.")
    return safe_filename


def import_expense_report(
    session: Session,
    *,
    source_filename: str,
    csv_bytes: bytes,
    imported_by: str,
) -> ExpenseReport:
    rows = _parse_expense_report_rows(csv_bytes)
    report = ExpenseReport(
        expense_report_id=f"expense-report-{uuid4().hex}",
        imported_by=imported_by,
        source_filename=source_filename,
        row_count=len(rows),
        rows=rows,
        created_at=datetime.now(UTC),
    )
    session.add(
        ExpenseReportRecord(
            expense_report_id=report.expense_report_id,
            imported_by=report.imported_by,
            source_filename=report.source_filename,
            row_count=report.row_count,
            rows=[row.model_dump(mode="json") for row in report.rows],
            created_at=report.created_at,
        )
    )
    session.flush()
    return report.model_copy(
        update={
            "input_fingerprint": compute_expense_input_fingerprint(
                source_filename=source_filename,
                rows=rows,
            ),
        },
    )


def list_expense_reports(session: Session) -> list[ExpenseReportSummary]:
    records = session.scalars(
        select(ExpenseReportRecord).order_by(
            ExpenseReportRecord.created_at.desc(),
            ExpenseReportRecord.expense_report_id.desc(),
        )
    ).all()
    return [expense_report_summary_from_record(record) for record in records]


def get_expense_report(session: Session, *, expense_report_id: str) -> ExpenseReport | None:
    record = session.scalar(
        select(ExpenseReportRecord).where(
            ExpenseReportRecord.expense_report_id == expense_report_id
        )
    )
    if record is None:
        return None
    return expense_report_from_record(record)


def expense_report_summary_from_record(record: ExpenseReportRecord) -> ExpenseReportSummary:
    return ExpenseReportSummary(
        expense_report_id=record.expense_report_id,
        imported_by=record.imported_by,
        source_filename=record.source_filename,
        row_count=record.row_count,
        created_at=_normalize_created_at(record.created_at),
    )


def expense_report_from_record(record: ExpenseReportRecord) -> ExpenseReport:
    rows = [ExpenseReportRow.model_validate(row) for row in record.rows]
    return ExpenseReport(
        expense_report_id=record.expense_report_id,
        imported_by=record.imported_by,
        source_filename=record.source_filename,
        row_count=record.row_count,
        rows=rows,
        created_at=_normalize_created_at(record.created_at),
        input_fingerprint=compute_expense_input_fingerprint(
            source_filename=record.source_filename,
            rows=rows,
        ),
    )


def _normalize_created_at(created_at: datetime) -> datetime:
    if created_at.tzinfo is None:
        return created_at.replace(tzinfo=UTC)
    return created_at.astimezone(UTC)


def _parse_expense_report_rows(csv_bytes: bytes) -> list[ExpenseReportRow]:
    try:
        decoded = csv_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ExpenseReportImportValidationError(
            file_errors=["Expense Report CSV must be UTF-8 encoded."],
        ) from exc

    reader = csv.DictReader(StringIO(decoded))
    headers = reader.fieldnames
    if headers is None:
        raise ExpenseReportImportValidationError(
            file_errors=["Expense Report CSV must include a header row."],
        )

    normalized_headers = [header.strip() if header is not None else "" for header in headers]
    file_errors: list[str] = []
    if any(not header for header in normalized_headers):
        file_errors.append("Header row contains an empty column name.")

    missing_required = sorted(set(_REQUIRED_COLUMNS) - set(normalized_headers))
    unknown_columns = sorted(set(normalized_headers) - _ALLOWED_COLUMNS)
    if missing_required:
        file_errors.append(
            "Missing required columns: " + ", ".join(missing_required) + "."
        )
    if unknown_columns:
        file_errors.append("Unknown columns: " + ", ".join(unknown_columns) + ".")
    if file_errors:
        raise ExpenseReportImportValidationError(file_errors=file_errors)

    reader.fieldnames = normalized_headers
    parsed_rows: list[ExpenseReportRow] = []
    row_errors: list[ExpenseReportImportRowError] = []

    for row_number, raw_row in enumerate(reader, start=2):
        current_row_errors: list[str] = []
        if None in raw_row and raw_row[None]:
            current_row_errors.append(
                "Row contains more values than there are header columns."
            )

        payload = {
            "employee_id": _parse_required_string(raw_row, "employee_id", current_row_errors),
            "expense_date": _parse_date(raw_row, "expense_date", current_row_errors),
            "expense_category": _parse_required_string(
                raw_row,
                "expense_category",
                current_row_errors,
            ),
            "amount": _parse_amount(raw_row, "amount", current_row_errors),
            "currency": _parse_currency(raw_row, "currency", current_row_errors),
            "country": _parse_optional_string(raw_row, "country"),
            "travel_type": _parse_optional_string(raw_row, "travel_type"),
            "business_purpose": _parse_optional_string(raw_row, "business_purpose"),
            "attendee_list": _parse_optional_string(raw_row, "attendee_list"),
            "manager_approval": _parse_optional_boolean(
                raw_row,
                "manager_approval",
                current_row_errors,
            ),
            "receipt_attached": _parse_optional_boolean(
                raw_row,
                "receipt_attached",
                current_row_errors,
            ),
            "trip_id": _parse_optional_string(raw_row, "trip_id"),
            "submission_days": _parse_optional_integer(
                raw_row,
                "submission_days",
                current_row_errors,
            ),
        }

        if current_row_errors:
            row_errors.append(
                ExpenseReportImportRowError(
                    row_number=row_number,
                    errors=current_row_errors,
                )
            )
            continue

        parsed_rows.append(ExpenseReportRow.model_validate(payload))

    if not parsed_rows and not row_errors:
        raise ExpenseReportImportValidationError(
            file_errors=["Expense Report CSV must include at least one data row."],
        )

    if row_errors:
        raise ExpenseReportImportValidationError(row_errors=row_errors)

    return parsed_rows


def _parse_required_string(
    raw_row: dict[str | None, str | None],
    field_name: str,
    errors: list[str],
) -> str | None:
    value = _normalize_optional_string(raw_row.get(field_name))
    if value is None:
        errors.append(f"{field_name} is required.")
        return None
    return value


def _parse_optional_string(
    raw_row: dict[str | None, str | None],
    field_name: str,
) -> str | None:
    return _normalize_optional_string(raw_row.get(field_name))


def _parse_date(
    raw_row: dict[str | None, str | None],
    field_name: str,
    errors: list[str],
) -> date | None:
    value = _normalize_optional_string(raw_row.get(field_name))
    if value is None:
        errors.append(f"{field_name} is required.")
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        errors.append(f"{field_name} must be a valid date in YYYY-MM-DD format.")
        return None


def _parse_amount(
    raw_row: dict[str | None, str | None],
    field_name: str,
    errors: list[str],
) -> str | None:
    value = _normalize_optional_string(raw_row.get(field_name))
    if value is None:
        errors.append(f"{field_name} is required.")
        return None
    try:
        decimal_value = Decimal(value)
    except InvalidOperation:
        errors.append(f"{field_name} must be a valid decimal amount.")
        return None
    if not decimal_value.is_finite():
        errors.append(f"{field_name} must be a valid decimal amount.")
        return None
    return format(decimal_value, "f")


def _parse_currency(
    raw_row: dict[str | None, str | None],
    field_name: str,
    errors: list[str],
) -> str | None:
    value = _normalize_optional_string(raw_row.get(field_name))
    if value is None:
        errors.append(f"{field_name} is required.")
        return None
    normalized = value.upper()
    if not _CURRENCY_RE.fullmatch(normalized):
        errors.append(f"{field_name} must be a 3-letter ISO currency code.")
        return None
    return normalized


def _parse_optional_boolean(
    raw_row: dict[str | None, str | None],
    field_name: str,
    errors: list[str],
) -> bool | None:
    value = _normalize_optional_string(raw_row.get(field_name))
    if value is None:
        return None
    normalized = value.lower()
    if normalized in _TRUE_VALUES:
        return True
    if normalized in _FALSE_VALUES:
        return False
    errors.append(
        f"{field_name} must be a boolean value (true/false, yes/no, 1/0)."
    )
    return None


def _parse_optional_integer(
    raw_row: dict[str | None, str | None],
    field_name: str,
    errors: list[str],
) -> int | None:
    value = _normalize_optional_string(raw_row.get(field_name))
    if value is None:
        return None
    try:
        integer_value = int(value)
    except ValueError:
        errors.append(f"{field_name} must be a whole number.")
        return None
    if integer_value < 0:
        errors.append(f"{field_name} must be zero or greater.")
        return None
    return integer_value


def _normalize_optional_string(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None
