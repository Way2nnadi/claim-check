from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from policy_pipeline.audit.events import record_audit_event
from policy_pipeline.auth.auth import require_roles
from policy_pipeline.auth.identity import AuthenticatedPrincipal, Role
from policy_pipeline.rules.models import (
    Applicability,
    CandidateRuleReview,
    Citation,
    EnforceabilityClass,
    LifecycleState,
    RuleCondition,
    RuleException,
    Scope,
)
from policy_pipeline.rules.store import (
    CandidateRuleNotFoundError,
    CandidateRuleReviewListResponse,
    InvalidCandidateRuleApprovalError,
    InvalidCandidateRuleReviewError,
    InvalidCandidateRuleTransitionError,
    approve_candidate_rule_review,
    bulk_approve_candidate_rule_reviews,
    get_candidate_rule_review,
    list_candidate_rule_reviews,
    reject_candidate_rule_review,
    update_candidate_rule_review,
)
from policy_pipeline.shared.database import get_session

router = APIRouter()


class CandidateRuleApprovalRequest(BaseModel):
    rationale: str = Field(min_length=1)


class CandidateRuleApprovalResponse(BaseModel):
    candidate_rule_id: str
    status: str
    recorded_by: str


class BulkCandidateRuleApprovalRequest(BaseModel):
    candidate_rule_ids: list[str] = Field(min_length=1)
    rationale: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_candidate_rule_ids(self) -> "BulkCandidateRuleApprovalRequest":
        if any(not candidate_rule_id for candidate_rule_id in self.candidate_rule_ids):
            raise ValueError("Bulk approval requires non-empty Candidate Rule ids.")
        return self


class BulkCandidateRuleApprovalResponse(BaseModel):
    approved_candidate_rule_ids: list[str]
    failed_candidate_rules: list[dict[str, str]] = Field(default_factory=list)
    status: str
    recorded_by: str


class CandidateRuleReviewUpdateRequest(BaseModel):
    statement: str | None = Field(default=None, min_length=1)
    enforceability_class: EnforceabilityClass | None = None
    scope: Scope | None = None
    citation: Citation | None = None
    condition: RuleCondition | None = None
    applicability: Applicability | None = None
    exceptions: list[RuleException] | None = None

    @model_validator(mode="after")
    def validate_requested_fields(self) -> "CandidateRuleReviewUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("Candidate Rule review update requires at least one field.")
        return self


class CandidateRuleRejectionRequest(BaseModel):
    reason: str = Field(min_length=1)


class CandidateRuleRejectionResponse(BaseModel):
    candidate_rule_id: str
    status: str
    recorded_by: str


@router.get(
    "/candidate-rules",
    response_model=CandidateRuleReviewListResponse,
)
def list_candidate_rules(
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
    lifecycle_state: Annotated[list[LifecycleState] | None, Query()] = None,
    document_id: Annotated[str | None, Query()] = None,
    document_version_id: Annotated[str | None, Query()] = None,
    extraction_run_id: Annotated[str | None, Query()] = None,
) -> CandidateRuleReviewListResponse:
    del principal
    lifecycle_states = set(lifecycle_state) if lifecycle_state else None
    return CandidateRuleReviewListResponse(
        items=list_candidate_rule_reviews(
            session,
            lifecycle_states=lifecycle_states,
            document_id=document_id,
            document_version_id=document_version_id,
            extraction_run_id=extraction_run_id,
        )
    )


@router.post(
    "/candidate-rules/{candidate_rule_id}/approvals",
    response_model=CandidateRuleApprovalResponse,
    status_code=status.HTTP_201_CREATED,
)
def approve_candidate_rule_endpoint(
    candidate_rule_id: str,
    approval: CandidateRuleApprovalRequest,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> CandidateRuleApprovalResponse:
    try:
        approve_candidate_rule_review(
            session,
            candidate_rule_id=candidate_rule_id,
            commit=False,
        )
    except CandidateRuleNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Candidate Rule was not found.",
        ) from exc
    except InvalidCandidateRuleTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Candidate Rule cannot transition from "
                f"{exc.current_state.value} to {exc.target_state.value}."
            ),
        ) from exc
    except InvalidCandidateRuleApprovalError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=exc.detail,
        ) from exc
    record_audit_event(
        session,
        action="candidate_rule.approved",
        actor_subject=principal.subject,
        actor_roles=[role.value for role in principal.roles],
        entity_type="candidate_rule",
        entity_id=candidate_rule_id,
        payload={"rationale": approval.rationale},
        commit=False,
    )
    session.commit()
    return CandidateRuleApprovalResponse(
        candidate_rule_id=candidate_rule_id,
        status="approved",
        recorded_by=principal.subject,
    )


@router.post(
    "/candidate-rules/approvals/bulk",
    response_model=BulkCandidateRuleApprovalResponse,
)
def bulk_approve_candidate_rules_endpoint(
    approval: BulkCandidateRuleApprovalRequest,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> BulkCandidateRuleApprovalResponse:
    result = bulk_approve_candidate_rule_reviews(
        session,
        candidate_rule_ids=approval.candidate_rule_ids,
        commit=False,
    )

    approved_candidate_rule_ids = [
        review.candidate_rule_id for review in result.approved_reviews
    ]
    for candidate_rule_id in approved_candidate_rule_ids:
        record_audit_event(
            session,
            action="candidate_rule.approved",
            actor_subject=principal.subject,
            actor_roles=[role.value for role in principal.roles],
            entity_type="candidate_rule",
            entity_id=candidate_rule_id,
            payload={"rationale": approval.rationale},
            commit=False,
        )
    session.commit()
    return BulkCandidateRuleApprovalResponse(
        approved_candidate_rule_ids=approved_candidate_rule_ids,
        failed_candidate_rules=[
            failure.model_dump(mode="json") for failure in result.failures
        ],
        status=(
            "approved"
            if not result.failures
            else "partial"
            if approved_candidate_rule_ids
            else "failed"
        ),
        recorded_by=principal.subject,
    )


@router.get(
    "/candidate-rules/{candidate_rule_id}",
    response_model=CandidateRuleReview,
)
def get_candidate_rule(
    candidate_rule_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> CandidateRuleReview:
    del principal
    try:
        return get_candidate_rule_review(
            session,
            candidate_rule_id=candidate_rule_id,
        )
    except CandidateRuleNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Candidate Rule was not found.",
        ) from exc


@router.patch(
    "/candidate-rules/{candidate_rule_id}",
    response_model=CandidateRuleReview,
)
def update_candidate_rule(
    candidate_rule_id: str,
    request: CandidateRuleReviewUpdateRequest,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> CandidateRuleReview:
    updated_fields = sorted(request.model_fields_set)
    try:
        review = update_candidate_rule_review(
            session,
            candidate_rule_id=candidate_rule_id,
            updates=request.model_dump(mode="json", exclude_unset=True),
            commit=False,
        )
    except CandidateRuleNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Candidate Rule was not found.",
        ) from exc
    except InvalidCandidateRuleTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Candidate Rule cannot transition from "
                f"{exc.current_state.value} to {exc.target_state.value}."
            ),
        ) from exc
    except InvalidCandidateRuleReviewError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=exc.detail,
        ) from exc
    record_audit_event(
        session,
        action="candidate_rule.edited",
        actor_subject=principal.subject,
        actor_roles=[role.value for role in principal.roles],
        entity_type="candidate_rule",
        entity_id=candidate_rule_id,
        payload={
            "fields": updated_fields,
            "to_lifecycle_state": review.lifecycle_state.value,
        },
        commit=False,
    )
    session.commit()
    return review


@router.post(
    "/candidate-rules/{candidate_rule_id}/rejections",
    response_model=CandidateRuleRejectionResponse,
)
def reject_candidate_rule(
    candidate_rule_id: str,
    rejection: CandidateRuleRejectionRequest,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> CandidateRuleRejectionResponse:
    try:
        reject_candidate_rule_review(
            session,
            candidate_rule_id=candidate_rule_id,
            commit=False,
        )
    except CandidateRuleNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Candidate Rule was not found.",
        ) from exc
    except InvalidCandidateRuleTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Candidate Rule cannot transition from "
                f"{exc.current_state.value} to {exc.target_state.value}."
            ),
        ) from exc
    record_audit_event(
        session,
        action="candidate_rule.rejected",
        actor_subject=principal.subject,
        actor_roles=[role.value for role in principal.roles],
        entity_type="candidate_rule",
        entity_id=candidate_rule_id,
        payload={"reason": rejection.reason},
        commit=False,
    )
    session.commit()
    return CandidateRuleRejectionResponse(
        candidate_rule_id=candidate_rule_id,
        status="rejected",
        recorded_by=principal.subject,
    )
