from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from policy_pipeline.audit.events import record_audit_event
from policy_pipeline.auth.auth import require_roles
from policy_pipeline.auth.identity import AuthenticatedPrincipal, Role
from policy_pipeline.compliance_evaluation_runs.models import ComplianceOutcome
from policy_pipeline.compliance_evaluation_runs.runner import get_compliance_evaluation_run
from policy_pipeline.compliance_review.models import (
    ComplianceReviewDecision,
    ComplianceReviewDecisionRequest,
    ComplianceReviewDecisionResponse,
    ComplianceReviewDetail,
    ComplianceReviewListResponse,
)
from policy_pipeline.compliance_review.service import (
    ComplianceReviewAlreadyResolvedError,
    ComplianceReviewNotFoundError,
    ComplianceReviewRationaleRequiredError,
    get_compliance_review,
    list_compliance_reviews,
    resolve_compliance_review,
)
from policy_pipeline.compliance_review.store import (
    ComplianceReviewDecisionAlreadyRecordedError,
)
from policy_pipeline.shared.database import get_session

router = APIRouter()


@router.get(
    "/compliance-reviews",
    response_model=ComplianceReviewListResponse,
)
def list_compliance_reviews_endpoint(
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
    compliance_evaluation_run_id: Annotated[str | None, Query()] = None,
    include_violations: Annotated[bool, Query()] = True,
    outcome: Annotated[list[ComplianceOutcome] | None, Query()] = None,
) -> ComplianceReviewListResponse:
    del principal
    items = list_compliance_reviews(
        session,
        compliance_evaluation_run_id=compliance_evaluation_run_id,
        include_violations=include_violations,
        outcomes=outcome,
    )
    return ComplianceReviewListResponse(
        items=items,
        compliance_evaluation_run_id=compliance_evaluation_run_id,
        include_violations=include_violations,
    )


@router.get(
    "/compliance-reviews/{compliance_review_id}",
    response_model=ComplianceReviewDetail,
)
def get_compliance_review_endpoint(
    compliance_review_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> ComplianceReviewDetail:
    del principal
    review = get_compliance_review(
        session,
        compliance_review_id=compliance_review_id,
    )
    if review is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compliance Review item was not found.",
        )
    return review


@router.post(
    "/compliance-reviews/{compliance_review_id}/decisions",
    response_model=ComplianceReviewDecisionResponse,
    status_code=status.HTTP_201_CREATED,
)
def resolve_compliance_review_endpoint(
    compliance_review_id: str,
    decision_request: ComplianceReviewDecisionRequest,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.APPROVER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> ComplianceReviewDecisionResponse:
    try:
        decision = resolve_compliance_review(
            session,
            compliance_review_id=compliance_review_id,
            resolution_type=decision_request.resolution_type,
            rationale=decision_request.rationale,
            recorded_by=principal.subject,
        )
    except ComplianceReviewNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compliance Review item was not found.",
        ) from exc
    except (
        ComplianceReviewAlreadyResolvedError,
        ComplianceReviewDecisionAlreadyRecordedError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Compliance Review item was already resolved.",
        ) from exc
    except ComplianceReviewRationaleRequiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Resolution rationale is required.",
        ) from exc

    row_context = _audit_row_context_for_decision(session, decision=decision)

    record_audit_event(
        session,
        action="compliance_review.resolved",
        actor_subject=principal.subject,
        actor_roles=[role.value for role in principal.roles],
        entity_type="compliance_review",
        entity_id=compliance_review_id,
        payload={
            "compliance_review_decision_id": decision.compliance_review_decision_id,
            "evaluation_outcome_id": decision.evaluation_outcome_id,
            "compliance_evaluation_run_id": decision.compliance_evaluation_run_id,
            "expense_report_id": _expense_report_id_for_decision(
                session,
                decision=decision,
            ),
            "row_index": row_context["row_index"],
            "employee_id": row_context["employee_id"],
            "expense_date": row_context["expense_date"],
            "policy_version_id": row_context.get("policy_version_id"),
            "compiled_rule_set_id": row_context.get("compiled_rule_set_id"),
            "currency_context": row_context.get("currency_context"),
            "effective_date_context": row_context.get("effective_date_context"),
            "resolution_type": decision.resolution_type.value,
            "rationale": decision.rationale,
        },
        commit=False,
    )
    session.commit()
    return ComplianceReviewDecisionResponse(decision=decision)


def _expense_report_id_for_decision(
    session: Session,
    *,
    decision: ComplianceReviewDecision,
) -> str | None:
    compliance_run = get_compliance_evaluation_run(
        session,
        compliance_evaluation_run_id=decision.compliance_evaluation_run_id,
    )
    if compliance_run is None:
        return None
    return compliance_run.expense_report_id


def _audit_row_context_for_decision(
    session: Session,
    *,
    decision: ComplianceReviewDecision,
) -> dict[str, object]:
    compliance_run = get_compliance_evaluation_run(
        session,
        compliance_evaluation_run_id=decision.compliance_evaluation_run_id,
    )
    if compliance_run is None:
        return {
            "row_index": decision.row_index,
            "employee_id": "",
            "expense_date": "",
        }

    for row_outcome in compliance_run.row_outcomes:
        if row_outcome.row_index == decision.row_index:
            return {
                "row_index": decision.row_index,
                "employee_id": row_outcome.employee_id,
                "expense_date": row_outcome.expense_date.isoformat(),
                "policy_version_id": compliance_run.policy_version_id,
                "compiled_rule_set_id": compliance_run.compiled_rule_set_id,
                "currency_context": (
                    row_outcome.currency_context.model_dump(mode="json")
                    if row_outcome.currency_context is not None
                    else None
                ),
                "effective_date_context": (
                    row_outcome.effective_date_context.model_dump(mode="json")
                    if row_outcome.effective_date_context is not None
                    else None
                ),
            }

    return {
        "row_index": decision.row_index,
        "employee_id": "",
        "expense_date": "",
        "policy_version_id": compliance_run.policy_version_id,
        "compiled_rule_set_id": compliance_run.compiled_rule_set_id,
        "currency_context": None,
        "effective_date_context": None,
    }
