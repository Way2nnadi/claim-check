from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from policy_pipeline.audit.events import record_audit_event
from policy_pipeline.auth.auth import require_roles
from policy_pipeline.auth.identity import AuthenticatedPrincipal, Role
from policy_pipeline.compliance_evaluation_runs.models import (
    ComplianceEvaluationRun,
    ComplianceEvaluationRunListResponse,
    ComplianceEvaluationRunStartRequest,
)
from policy_pipeline.compliance_evaluation_runs.runner import (
    CompiledRuleSetNotFoundError,
    ExpenseReportNotFoundError,
    NoCompiledRulesError,
    execute_compliance_evaluation_run,
    get_compliance_evaluation_run,
    list_compliance_evaluation_runs,
)
from policy_pipeline.expense_reports import get_expense_report
from policy_pipeline.rule_test_cases.evaluator import UnsupportedRuleEvaluationError
from policy_pipeline.shared.database import get_session

router = APIRouter()


def _compliance_evaluation_run_report_filename(
    compliance_evaluation_run_id: str,
) -> str:
    safe_stem = "".join(
        char if char.isalnum() or char in "._-" else "_"
        for char in compliance_evaluation_run_id
    ).strip("._-")
    return f"{safe_stem or 'compliance-evaluation-run'}.json"


@router.post(
    "/expense-reports/{expense_report_id}/compliance-evaluation-runs",
    response_model=ComplianceEvaluationRun,
    status_code=status.HTTP_201_CREATED,
)
def execute_compliance_evaluation_run_endpoint(
    expense_report_id: str,
    start_request: ComplianceEvaluationRunStartRequest,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> ComplianceEvaluationRun:
    try:
        compliance_run = execute_compliance_evaluation_run(
            session,
            expense_report_id=expense_report_id,
            compiled_rule_set_id=start_request.compiled_rule_set_id,
            executed_by=principal.subject,
        )
    except ExpenseReportNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense Report was not found.",
        ) from exc
    except CompiledRuleSetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compiled Rule Set was not found.",
        ) from exc
    except NoCompiledRulesError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Compiled Rule Set has no enforceable Rules to evaluate.",
        ) from exc
    except UnsupportedRuleEvaluationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unable to execute Compliance Evaluation Run: {exc.detail}",
        ) from exc

    record_audit_event(
        session,
        action="compliance_evaluation_run.executed",
        actor_subject=principal.subject,
        actor_roles=[role.value for role in principal.roles],
        entity_type="expense_report",
        entity_id=expense_report_id,
        payload={
            "compliance_evaluation_run_id": compliance_run.compliance_evaluation_run_id,
            "compiled_rule_set_id": compliance_run.compiled_rule_set_id,
            "policy_version_id": compliance_run.policy_version_id,
            "pass_count": compliance_run.summary.pass_count,
            "violation_count": compliance_run.summary.violation_count,
        },
        commit=False,
    )
    session.commit()
    return compliance_run


@router.get(
    "/expense-reports/{expense_report_id}/compliance-evaluation-runs",
    response_model=ComplianceEvaluationRunListResponse,
)
def list_compliance_evaluation_runs_endpoint(
    expense_report_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> ComplianceEvaluationRunListResponse:
    del principal
    if get_expense_report(session, expense_report_id=expense_report_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense Report was not found.",
        )
    items = list_compliance_evaluation_runs(
        session,
        expense_report_id=expense_report_id,
    )
    return ComplianceEvaluationRunListResponse(
        expense_report_id=expense_report_id,
        items=items,
    )


@router.get(
    "/compliance-evaluation-runs/{compliance_evaluation_run_id}",
    response_model=ComplianceEvaluationRun,
)
def get_compliance_evaluation_run_endpoint(
    compliance_evaluation_run_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> ComplianceEvaluationRun:
    del principal
    compliance_run = get_compliance_evaluation_run(
        session,
        compliance_evaluation_run_id=compliance_evaluation_run_id,
    )
    if compliance_run is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compliance Evaluation Run was not found.",
        )
    return compliance_run


@router.get("/compliance-evaluation-runs/{compliance_evaluation_run_id}/report")
def export_compliance_evaluation_run_report(
    compliance_evaluation_run_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> JSONResponse:
    del principal
    compliance_run = get_compliance_evaluation_run(
        session,
        compliance_evaluation_run_id=compliance_evaluation_run_id,
    )
    if compliance_run is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compliance Evaluation Run was not found.",
        )
    return JSONResponse(
        content=compliance_run.model_dump(mode="json"),
        headers={
            "Content-Disposition": (
                'attachment; filename="'
                f"{_compliance_evaluation_run_report_filename(compliance_evaluation_run_id)}"
                '"'
            )
        },
    )
