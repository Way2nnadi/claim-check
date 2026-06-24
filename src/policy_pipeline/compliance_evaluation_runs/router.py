from collections.abc import Sequence
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
from policy_pipeline.compliance_evaluation_runs.evaluation import (
    ComplianceEvaluationQualityComparison,
    ComplianceEvaluationQualityReport,
)
from policy_pipeline.compliance_evaluation_runs.quality_service import (
    CompiledRuleSetNotFoundError as QualityCompiledRuleSetNotFoundError,
    GoldenCorpusCaseNotFoundError,
    NoCompiledRulesError as QualityNoCompiledRulesError,
    PolicyVersionCompiledRuleSetMismatchError as QualityPolicyVersionCompiledRuleSetMismatchError,
    compare_quality_reports_for_compiled_rule_sets,
    generate_fixture_quality_report,
    generate_quality_report_for_compiled_rule_set,
)
from policy_pipeline.compliance_evaluation_runs.gate import RuleTestRunGateBlockedError
from policy_pipeline.compliance_evaluation_runs.runner import (
    CompiledRuleSetCompileErrorsError,
    CompiledRuleSetNotFoundError,
    ExpenseReportNotFoundError,
    NoCompiledRulesError,
    PolicyVersionCompiledRuleSetMismatchError,
    execute_compliance_evaluation_run,
    get_compliance_evaluation_run,
    list_compliance_evaluation_runs,
)
from policy_pipeline.compiled_rule_sets.store import PolicyVersionNotFoundError
from policy_pipeline.expense_reports import get_expense_report
from policy_pipeline.rule_test_cases.evaluator import UnsupportedRuleEvaluationError
from policy_pipeline.shared.database import get_session

router = APIRouter()


def _format_compile_errors_detail(
    policy_version_id: str,
    compile_errors: Sequence[tuple[str, str]],
) -> str:
    error_lines = "\n".join(
        f"• {rule_id}: {error_reason}"
        for rule_id, error_reason in compile_errors
    )
    return (
        f"Policy Version {policy_version_id} compilation blocked evaluation:\n"
        f"{error_lines}"
    )


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
        execution_result = execute_compliance_evaluation_run(
            session,
            expense_report_id=expense_report_id,
            compiled_rule_set_id=start_request.compiled_rule_set_id,
            policy_version_id=start_request.policy_version_id,
            executed_by=principal.subject,
        )
    except ExpenseReportNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense Report was not found.",
        ) from exc
    except PolicyVersionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Policy Version was not found.",
        ) from exc
    except CompiledRuleSetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compiled Rule Set was not found.",
        ) from exc
    except PolicyVersionCompiledRuleSetMismatchError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Compiled Rule Set does not belong to the requested Policy Version."
            ),
        ) from exc
    except CompiledRuleSetCompileErrorsError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=_format_compile_errors_detail(
                exc.policy_version_id,
                [
                    (error.rule_id, error.error_reason)
                    for error in exc.compile_errors
                ],
            ),
        ) from exc
    except NoCompiledRulesError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Compiled Rule Set has no enforceable Rules to evaluate.",
        ) from exc
    except RuleTestRunGateBlockedError as exc:
        if exc.reason == "missing":
            detail = (
                "Compliance Evaluation Run requires a passing Rule Test Run for this "
                "Compiled Rule Set. Generate Rule Test Cases and execute a green "
                "Rule Test Run first."
            )
        else:
            detail = (
                "The most recent Rule Test Run for this Compiled Rule Set did not pass. "
                "Fix failing Rule Test Cases and re-run tests before evaluating "
                "Expense Reports."
            )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail,
        ) from exc
    except UnsupportedRuleEvaluationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unable to execute Compliance Evaluation Run: {exc.detail}",
        ) from exc

    compliance_run = execution_result.run

    if execution_result.compiled_rule_set_created:
        record_audit_event(
            session,
            action="compiled_rule_set.created",
            actor_subject=principal.subject,
            actor_roles=[role.value for role in principal.roles],
            entity_type="compiled_rule_set",
            entity_id=compliance_run.compiled_rule_set_id,
            payload={
                "policy_version_id": compliance_run.policy_version_id,
                "summary": (
                    execution_result.compiled_rule_set_summary.model_dump(mode="json")
                    if execution_result.compiled_rule_set_summary is not None
                    else {}
                ),
                "source": "compliance_evaluation_run",
            },
            commit=False,
        )

    record_audit_event(
        session,
        action="compliance_evaluation_run.executed",
        actor_subject=principal.subject,
        actor_roles=[role.value for role in principal.roles],
        entity_type="compliance_evaluation_run",
        entity_id=compliance_run.compliance_evaluation_run_id,
        payload={
            "compliance_evaluation_run_id": compliance_run.compliance_evaluation_run_id,
            "expense_report_id": expense_report_id,
            "expense_input_fingerprint": (
                compliance_run.expense_input_fingerprint.model_dump(mode="json")
                if compliance_run.expense_input_fingerprint is not None
                else None
            ),
            "compiled_rule_set_id": compliance_run.compiled_rule_set_id,
            "policy_version_id": compliance_run.policy_version_id,
            "executed_by": compliance_run.executed_by,
            "executed_at": compliance_run.executed_at.isoformat().replace(
                "+00:00",
                "Z",
            ),
            "pass_count": compliance_run.summary.pass_count,
            "violation_count": compliance_run.summary.violation_count,
            "needs_review_count": compliance_run.summary.needs_review_count,
            "missing_evidence_count": compliance_run.summary.missing_evidence_count,
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


@router.get(
    "/compliance-evaluation-quality-report/golden-corpus",
    response_model=ComplianceEvaluationQualityReport,
)
def get_fixture_compliance_evaluation_quality_report(
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN)),
    ],
) -> ComplianceEvaluationQualityReport:
    del principal
    try:
        return generate_fixture_quality_report()
    except QualityNoCompiledRulesError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Compiled Rule Set has no enforceable Rules to evaluate.",
        ) from exc


@router.get(
    (
        "/policy-versions/{policy_version_id}/compiled-rule-sets/"
        "{compiled_rule_set_id}/compliance-evaluation-quality-report"
    ),
    response_model=ComplianceEvaluationQualityReport,
)
def get_compiled_rule_set_compliance_evaluation_quality_report(
    policy_version_id: str,
    compiled_rule_set_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> ComplianceEvaluationQualityReport:
    del principal
    try:
        return generate_quality_report_for_compiled_rule_set(
            session,
            policy_version_id=policy_version_id,
            compiled_rule_set_id=compiled_rule_set_id,
        )
    except QualityCompiledRuleSetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compiled Rule Set was not found.",
        ) from exc
    except QualityPolicyVersionCompiledRuleSetMismatchError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Compiled Rule Set does not belong to the requested Policy Version."
            ),
        ) from exc
    except GoldenCorpusCaseNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "No golden expense corpus case is registered for this Policy Version."
            ),
        ) from exc
    except QualityNoCompiledRulesError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Compiled Rule Set has no enforceable Rules to evaluate.",
        ) from exc


@router.get(
    "/compliance-evaluation-quality-report/compare",
    response_model=ComplianceEvaluationQualityComparison,
)
def compare_compiled_rule_set_compliance_evaluation_quality_reports(
    baseline_compiled_rule_set_id: str,
    candidate_compiled_rule_set_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> ComplianceEvaluationQualityComparison:
    del principal
    try:
        return compare_quality_reports_for_compiled_rule_sets(
            session,
            baseline_compiled_rule_set_id=baseline_compiled_rule_set_id,
            candidate_compiled_rule_set_id=candidate_compiled_rule_set_id,
        )
    except QualityCompiledRuleSetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compiled Rule Set was not found.",
        ) from exc
    except GoldenCorpusCaseNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "No golden expense corpus case is registered for this Policy Version."
            ),
        ) from exc
    except QualityNoCompiledRulesError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Compiled Rule Set has no enforceable Rules to evaluate.",
        ) from exc


@router.get(
    "/compliance-evaluation-quality-report/golden-corpus/report",
)
def export_fixture_compliance_evaluation_quality_report(
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN)),
    ],
) -> JSONResponse:
    del principal
    try:
        report = generate_fixture_quality_report()
    except QualityNoCompiledRulesError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Compiled Rule Set has no enforceable Rules to evaluate.",
        ) from exc
    return JSONResponse(
        content=report.model_dump(mode="json"),
        headers={
            "Content-Disposition": (
                'attachment; filename="compliance-evaluation-quality-report.json"'
            )
        },
    )
