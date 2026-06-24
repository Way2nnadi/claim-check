from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from policy_pipeline.auth.auth import require_roles
from policy_pipeline.auth.identity import AuthenticatedPrincipal, Role
from policy_pipeline.expense_reports import (
    OPTIONAL_CSV_COLUMNS,
    REQUIRED_CSV_COLUMNS,
    ExpenseReport,
    ExpenseReportImportErrorResponse,
    ExpenseReportImportValidationError,
    ExpenseReportListResponse,
    get_expense_report,
    import_expense_report,
    list_expense_reports,
    validate_expense_report_upload_filename,
)
from policy_pipeline.shared.database import get_session

router = APIRouter()

_EXPENSE_REPORT_CONTRACT = (
    "Imported Expense Reports are immutable append-only records. "
    f"Required CSV columns: {', '.join(REQUIRED_CSV_COLUMNS)}. "
    f"Optional CSV columns: {', '.join(OPTIONAL_CSV_COLUMNS)}. "
    "CSV import is all-or-nothing: file-level and row-level validation errors "
    "return 422 and nothing is saved."
)


@router.get(
    "/expense-reports",
    response_model=ExpenseReportListResponse,
    summary="List imported Expense Reports",
    description=_EXPENSE_REPORT_CONTRACT,
)
def list_expense_report_catalog(
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> ExpenseReportListResponse:
    del principal
    return ExpenseReportListResponse(items=list_expense_reports(session))


@router.get(
    "/expense-reports/{expense_report_id}",
    response_model=ExpenseReport,
    summary="Get an immutable Expense Report with normalized rows",
    description=(
        f"{_EXPENSE_REPORT_CONTRACT} "
        "The response includes a computed input_fingerprint for traceability; "
        "Compliance Evaluation Runs pin the same fingerprint at execution time."
    ),
)
def get_expense_report_detail(
    expense_report_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> ExpenseReport:
    del principal
    expense_report = get_expense_report(session, expense_report_id=expense_report_id)
    if expense_report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense Report was not found.",
        )
    return expense_report


@router.post(
    "/expense-reports",
    response_model=ExpenseReport,
    status_code=status.HTTP_201_CREATED,
    summary="Import a UTF-8 CSV Expense Report",
    description=(
        f"{_EXPENSE_REPORT_CONTRACT} "
        "Uploads must use a .csv filename. Booleans accept true/false, yes/no, "
        "or 1/0. Currency codes are uppercased. Amounts are normalized to decimal strings."
    ),
    responses={
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "model": ExpenseReportImportErrorResponse,
            "description": "Validation failed; no Expense Report was created.",
        },
        status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: {
            "description": "Upload filename must end with .csv.",
        },
    },
)
async def upload_expense_report(
    file: Annotated[UploadFile, File(description="UTF-8 CSV with a header row.")],
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> ExpenseReport | JSONResponse:
    try:
        source_filename = validate_expense_report_upload_filename(file.filename)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=str(exc),
        ) from exc

    csv_bytes = await file.read()
    try:
        expense_report = import_expense_report(
            session,
            source_filename=source_filename,
            csv_bytes=csv_bytes,
            imported_by=principal.subject,
        )
    except ExpenseReportImportValidationError as exc:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content=ExpenseReportImportErrorResponse(
                file_errors=exc.file_errors,
                row_errors=exc.row_errors,
            ).model_dump(mode="json"),
        )

    session.commit()
    return expense_report
