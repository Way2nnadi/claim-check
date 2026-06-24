from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from policy_pipeline.audit.events import record_audit_event
from policy_pipeline.auth.auth import require_roles
from policy_pipeline.auth.identity import AuthenticatedPrincipal, Role
from policy_pipeline.rule_test_cases.evaluator import UnsupportedRuleEvaluationError
from policy_pipeline.rule_test_cases.models import (
    RuleTestCase,
    RuleTestCaseDisableRequest,
    RuleTestCaseEditRequest,
    RuleTestCaseEnableRequest,
    RuleTestCaseGenerateResponse,
    RuleTestCaseListResponse,
    RuleTestCaseStatus,
    RuleTestRun,
    RuleTestRunListResponse,
)
from policy_pipeline.rule_test_cases.runner import (
    NoRuleTestCasesError,
    RuleNotCompiledError,
    execute_rule_test_run,
    get_rule_test_run,
    list_rule_test_runs,
)
from policy_pipeline.rule_test_cases.store import (
    CompiledRuleSetNotFoundError,
    NoEnforceableRulesError,
    RuleTestCaseAlreadyDisabledError,
    RuleTestCaseAlreadyEnabledError,
    RuleTestCaseNoChangesError,
    RuleTestCaseNotActiveError,
    RuleTestCaseNotFoundError,
    UnsupportedRuleConditionError,
    disable_rule_test_case,
    edit_rule_test_case,
    enable_rule_test_case,
    generate_rule_test_cases_for_compiled_rule_set,
    list_rule_test_cases_grouped,
)
from policy_pipeline.shared.database import get_session

router = APIRouter()


def _rule_test_run_report_filename(rule_test_run_id: str) -> str:
    safe_stem = "".join(
        char if char.isalnum() or char in "._-" else "_"
        for char in rule_test_run_id
    ).strip("._-")
    return f"{safe_stem or 'rule-test-run'}.json"


@router.post(
    "/compiled-rule-sets/{compiled_rule_set_id}/rule-test-cases/generate",
    response_model=RuleTestCaseGenerateResponse,
)
def generate_rule_test_cases_endpoint(
    compiled_rule_set_id: str,
    response: Response,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> RuleTestCaseGenerateResponse:
    try:
        cases, created = generate_rule_test_cases_for_compiled_rule_set(
            session,
            compiled_rule_set_id=compiled_rule_set_id,
            generated_by=principal.subject,
        )
    except CompiledRuleSetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compiled Rule Set was not found.",
        ) from exc
    except NoEnforceableRulesError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Compiled Rule Set has no enforceable Rules to generate test cases for.",
        ) from exc
    except UnsupportedRuleConditionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unable to generate Rule Test Cases: {exc.detail}",
        ) from exc

    grouped = list_rule_test_cases_grouped(
        session,
        compiled_rule_set_id=compiled_rule_set_id,
    )

    if created:
        record_audit_event(
            session,
            action="rule_test_case.generated",
            actor_subject=principal.subject,
            actor_roles=[role.value for role in principal.roles],
            entity_type="compiled_rule_set",
            entity_id=compiled_rule_set_id,
            payload={
                "generated_count": len(cases),
                "rule_count": len(grouped.groups),
            },
            commit=False,
        )
        response.status_code = status.HTTP_201_CREATED
    else:
        response.status_code = status.HTTP_200_OK

    session.commit()
    return RuleTestCaseGenerateResponse(
        compiled_rule_set_id=compiled_rule_set_id,
        groups=grouped.groups,
        generated_count=len(cases),
        created=created,
    )


@router.get(
    "/compiled-rule-sets/{compiled_rule_set_id}/rule-test-cases",
    response_model=RuleTestCaseListResponse,
)
def list_rule_test_cases_endpoint(
    compiled_rule_set_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
    status: Annotated[
        RuleTestCaseStatus | None,
        Query(description="Filter cases by status: active or disabled."),
    ] = None,
) -> RuleTestCaseListResponse:
    del principal
    try:
        return list_rule_test_cases_grouped(
            session,
            compiled_rule_set_id=compiled_rule_set_id,
            status_filter=status,
        )
    except CompiledRuleSetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compiled Rule Set was not found.",
        ) from exc


@router.post(
    "/rule-test-cases/{rule_test_case_id}/disable",
    response_model=RuleTestCase,
)
def disable_rule_test_case_endpoint(
    rule_test_case_id: str,
    disable_request: RuleTestCaseDisableRequest,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.APPROVER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> RuleTestCase:
    try:
        rule_test_case = disable_rule_test_case(
            session,
            rule_test_case_id=rule_test_case_id,
            disabled_by=principal.subject,
            rationale=disable_request.rationale,
        )
    except RuleTestCaseNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rule Test Case was not found.",
        ) from exc
    except RuleTestCaseAlreadyDisabledError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Rule Test Case is already disabled.",
        ) from exc

    record_audit_event(
        session,
        action="rule_test_case.disabled",
        actor_subject=principal.subject,
        actor_roles=[role.value for role in principal.roles],
        entity_type="rule_test_case",
        entity_id=rule_test_case_id,
        payload={
            "rule_test_case_id": rule_test_case_id,
            "rationale": disable_request.rationale,
            "compiled_rule_set_id": rule_test_case.compiled_rule_set_id,
            "rule_id": rule_test_case.rule_id,
        },
        commit=False,
    )
    session.commit()
    return rule_test_case


@router.post(
    "/rule-test-cases/{rule_test_case_id}/enable",
    response_model=RuleTestCase,
)
def enable_rule_test_case_endpoint(
    rule_test_case_id: str,
    enable_request: RuleTestCaseEnableRequest,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.APPROVER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> RuleTestCase:
    try:
        rule_test_case = enable_rule_test_case(
            session,
            rule_test_case_id=rule_test_case_id,
            rationale=enable_request.rationale,
        )
    except RuleTestCaseNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rule Test Case was not found.",
        ) from exc
    except RuleTestCaseAlreadyEnabledError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Rule Test Case is already active.",
        ) from exc

    record_audit_event(
        session,
        action="rule_test_case.enabled",
        actor_subject=principal.subject,
        actor_roles=[role.value for role in principal.roles],
        entity_type="rule_test_case",
        entity_id=rule_test_case_id,
        payload={
            "rule_test_case_id": rule_test_case_id,
            "rationale": enable_request.rationale,
            "compiled_rule_set_id": rule_test_case.compiled_rule_set_id,
            "rule_id": rule_test_case.rule_id,
        },
        commit=False,
    )
    session.commit()
    return rule_test_case


@router.patch(
    "/rule-test-cases/{rule_test_case_id}",
    response_model=RuleTestCase,
)
def edit_rule_test_case_endpoint(
    rule_test_case_id: str,
    edit_request: RuleTestCaseEditRequest,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.APPROVER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> RuleTestCase:
    try:
        rule_test_case, updated_fields = edit_rule_test_case(
            session,
            rule_test_case_id=rule_test_case_id,
            edited_by=principal.subject,
            rationale=edit_request.rationale,
            expense_fixture=edit_request.expense_fixture,
            expected_outcome=edit_request.expected_outcome,
        )
    except RuleTestCaseNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rule Test Case was not found.",
        ) from exc
    except RuleTestCaseNotActiveError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Rule Test Case must be active to edit.",
        ) from exc
    except RuleTestCaseNoChangesError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No changes were provided for the Rule Test Case.",
        ) from exc

    record_audit_event(
        session,
        action="rule_test_case.edited",
        actor_subject=principal.subject,
        actor_roles=[role.value for role in principal.roles],
        entity_type="rule_test_case",
        entity_id=rule_test_case_id,
        payload={
            "rule_test_case_id": rule_test_case_id,
            "rationale": edit_request.rationale,
            "fields": updated_fields,
            "compiled_rule_set_id": rule_test_case.compiled_rule_set_id,
            "rule_id": rule_test_case.rule_id,
        },
        commit=False,
    )
    session.commit()
    return rule_test_case


@router.post(
    "/compiled-rule-sets/{compiled_rule_set_id}/rule-test-runs",
    response_model=RuleTestRun,
    status_code=status.HTTP_201_CREATED,
)
def execute_rule_test_run_endpoint(
    compiled_rule_set_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> RuleTestRun:
    try:
        rule_test_run = execute_rule_test_run(
            session,
            compiled_rule_set_id=compiled_rule_set_id,
            executed_by=principal.subject,
        )
    except CompiledRuleSetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compiled Rule Set was not found.",
        ) from exc
    except NoRuleTestCasesError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No active Rule Test Cases exist for this Compiled Rule Set.",
        ) from exc
    except RuleNotCompiledError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Rule {exc.rule_id} is not compiled in this Compiled Rule Set.",
        ) from exc
    except UnsupportedRuleEvaluationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unable to execute Rule Test Run: {exc.detail}",
        ) from exc

    record_audit_event(
        session,
        action="rule_test_run.executed",
        actor_subject=principal.subject,
        actor_roles=[role.value for role in principal.roles],
        entity_type="compiled_rule_set",
        entity_id=compiled_rule_set_id,
        payload={
            "rule_test_run_id": rule_test_run.rule_test_run_id,
            "passed_count": rule_test_run.summary.passed_count,
            "failed_count": rule_test_run.summary.failed_count,
            "overall_passed": rule_test_run.summary.overall_passed,
        },
        commit=False,
    )
    session.commit()
    return rule_test_run


@router.get(
    "/compiled-rule-sets/{compiled_rule_set_id}/rule-test-runs",
    response_model=RuleTestRunListResponse,
)
def list_rule_test_runs_endpoint(
    compiled_rule_set_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> RuleTestRunListResponse:
    del principal
    from policy_pipeline.compiled_rule_sets.store import get_compiled_rule_set

    if get_compiled_rule_set(session, compiled_rule_set_id=compiled_rule_set_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compiled Rule Set was not found.",
        )
    items = list_rule_test_runs(
        session,
        compiled_rule_set_id=compiled_rule_set_id,
    )
    return RuleTestRunListResponse(
        compiled_rule_set_id=compiled_rule_set_id,
        items=items,
    )


@router.get(
    "/rule-test-runs/{rule_test_run_id}",
    response_model=RuleTestRun,
)
def get_rule_test_run_endpoint(
    rule_test_run_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> RuleTestRun:
    del principal
    rule_test_run = get_rule_test_run(
        session,
        rule_test_run_id=rule_test_run_id,
    )
    if rule_test_run is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rule Test Run was not found.",
        )
    return rule_test_run


@router.get("/rule-test-runs/{rule_test_run_id}/report")
def export_rule_test_run_report(
    rule_test_run_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> JSONResponse:
    del principal
    rule_test_run = get_rule_test_run(
        session,
        rule_test_run_id=rule_test_run_id,
    )
    if rule_test_run is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rule Test Run was not found.",
        )
    return JSONResponse(
        content=rule_test_run.model_dump(mode="json"),
        headers={
            "Content-Disposition": (
                f'attachment; filename="{_rule_test_run_report_filename(rule_test_run_id)}"'
            )
        },
    )
