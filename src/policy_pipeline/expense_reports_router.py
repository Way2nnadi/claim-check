from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from policy_pipeline.auth.auth import require_roles
from policy_pipeline.auth.identity import AuthenticatedPrincipal, Role
from policy_pipeline.expense_reports import (
    ExpenseReport,
    ExpenseReportImportErrorResponse,
    ExpenseReportImportValidationError,
    ExpenseReportListResponse,
    import_expense_report,
    list_expense_reports,
    validate_expense_report_upload_filename,
)
from policy_pipeline.shared.database import get_session

router = APIRouter()


@router.get("/expense-reports", response_model=ExpenseReportListResponse)
def list_expense_report_catalog(
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> ExpenseReportListResponse:
    del principal
    return ExpenseReportListResponse(items=list_expense_reports(session))


@router.post(
    "/expense-reports",
    response_model=ExpenseReport,
    status_code=status.HTTP_201_CREATED,
)
async def upload_expense_report(
    file: Annotated[UploadFile, File()],
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
