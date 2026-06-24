from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from policy_pipeline.compliance_review.models import (
    ComplianceReviewDecision,
    ComplianceReviewResolutionType,
)
from policy_pipeline.compliance_review.records import ComplianceReviewDecisionRecord


def compliance_review_decision_from_record(
    record: ComplianceReviewDecisionRecord,
) -> ComplianceReviewDecision:
    recorded_at = record.recorded_at
    if recorded_at.tzinfo is None:
        recorded_at = recorded_at.replace(tzinfo=UTC)
    else:
        recorded_at = recorded_at.astimezone(UTC)
    decision = ComplianceReviewDecision.model_validate(record.payload)
    return decision.model_copy(update={"recorded_at": recorded_at})


def get_compliance_review_decision(
    session: Session,
    *,
    evaluation_outcome_id: str,
) -> ComplianceReviewDecision | None:
    record = session.scalars(
        select(ComplianceReviewDecisionRecord).where(
            ComplianceReviewDecisionRecord.evaluation_outcome_id == evaluation_outcome_id
        )
    ).first()
    if record is None:
        return None
    return compliance_review_decision_from_record(record)


def list_resolved_evaluation_outcome_ids(session: Session) -> set[str]:
    records = session.scalars(
        select(ComplianceReviewDecisionRecord.evaluation_outcome_id)
    ).all()
    return set(records)


def record_compliance_review_decision(
    session: Session,
    *,
    evaluation_outcome_id: str,
    compliance_evaluation_run_id: str,
    row_index: int,
    resolution_type: ComplianceReviewResolutionType,
    rationale: str,
    recorded_by: str,
) -> ComplianceReviewDecision:
    existing = get_compliance_review_decision(
        session,
        evaluation_outcome_id=evaluation_outcome_id,
    )
    if existing is not None:
        raise ComplianceReviewDecisionAlreadyRecordedError(evaluation_outcome_id)

    recorded_at = datetime.now(UTC)
    decision = ComplianceReviewDecision(
        compliance_review_decision_id=f"crd-{uuid4().hex}",
        evaluation_outcome_id=evaluation_outcome_id,
        compliance_evaluation_run_id=compliance_evaluation_run_id,
        row_index=row_index,
        resolution_type=resolution_type,
        rationale=rationale.strip(),
        recorded_by=recorded_by,
        recorded_at=recorded_at,
    )
    session.add(
        ComplianceReviewDecisionRecord(
            compliance_review_decision_id=decision.compliance_review_decision_id,
            evaluation_outcome_id=decision.evaluation_outcome_id,
            compliance_evaluation_run_id=decision.compliance_evaluation_run_id,
            row_index=decision.row_index,
            resolution_type=decision.resolution_type.value,
            rationale=decision.rationale,
            recorded_by=decision.recorded_by,
            payload=decision.model_dump(mode="json"),
            recorded_at=recorded_at,
        )
    )
    session.flush()
    return decision


class ComplianceReviewDecisionAlreadyRecordedError(Exception):
    def __init__(self, evaluation_outcome_id: str) -> None:
        self.evaluation_outcome_id = evaluation_outcome_id
        super().__init__(evaluation_outcome_id)
