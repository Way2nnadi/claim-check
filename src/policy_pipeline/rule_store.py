from __future__ import annotations

from copy import deepcopy

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from policy_pipeline.database import RuleRecord
from policy_pipeline.rules import (
    CandidateRule,
    CandidateRuleReview,
    CandidateRuleValue,
    LifecycleState,
    QAFlag,
    Rule,
)


class CandidateRuleNotFoundError(Exception):
    pass


class InvalidCandidateRuleTransitionError(Exception):
    def __init__(self, *, current_state: LifecycleState, target_state: LifecycleState) -> None:
        super().__init__(f"{current_state.value}->{target_state.value}")
        self.current_state = current_state
        self.target_state = target_state


class InvalidCandidateRuleApprovalError(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class InvalidCandidateRuleReviewError(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


_CANDIDATE_RULE_METADATA_FIELDS = {"qa_flags", "extracted_rule", "committed_rule"}
_EDITABLE_REVIEW_STATES = {LifecycleState.EXTRACTED, LifecycleState.IN_REVIEW}


def create_rule(session: Session, *, rule: Rule | CandidateRule, commit: bool = True) -> RuleRecord:
    payload = rule.model_dump(mode="json")
    if isinstance(rule, CandidateRule):
        payload["extracted_rule"] = rule.model_dump(mode="json", exclude={"qa_flags"})
        payload["committed_rule"] = None
    record = RuleRecord(
        rule_id=rule.rule_id,
        origin_source_type=rule.origin.source_type.value,
        payload=payload,
    )
    session.add(record)
    session.flush()
    if commit:
        session.commit()
        session.refresh(record)
    return record


def get_candidate_rule_review(
    session: Session,
    *,
    candidate_rule_id: str,
) -> CandidateRuleReview:
    record = _get_candidate_rule_record(session, candidate_rule_id=candidate_rule_id)
    return _build_candidate_rule_review(record)


def update_candidate_rule_review(
    session: Session,
    *,
    candidate_rule_id: str,
    updates: dict[str, object],
    commit: bool = True,
) -> CandidateRuleReview:
    record = _get_candidate_rule_record(session, candidate_rule_id=candidate_rule_id)
    current_rule = _current_candidate_rule_value(record)
    _ensure_transition_allowed(
        current_state=current_rule.lifecycle_state,
        target_state=LifecycleState.IN_REVIEW,
    )
    try:
        next_rule = CandidateRuleValue.model_validate(
            {
                **current_rule.model_dump(mode="json"),
                **updates,
                "lifecycle_state": LifecycleState.IN_REVIEW.value,
            }
        )
    except ValidationError as exc:
        raise InvalidCandidateRuleReviewError(_first_validation_message(exc)) from exc
    _persist_candidate_rule_review(
        record,
        current_rule=next_rule,
        committed_rule=next_rule,
    )
    session.flush()
    if commit:
        session.commit()
        session.refresh(record)
    return _build_candidate_rule_review(record)


def approve_candidate_rule_review(
    session: Session,
    *,
    candidate_rule_id: str,
    commit: bool = True,
) -> CandidateRuleReview:
    record = _get_candidate_rule_record(session, candidate_rule_id=candidate_rule_id)
    _approve_candidate_rule_record(record)
    session.flush()
    if commit:
        session.commit()
        session.refresh(record)
    return _build_candidate_rule_review(record)


def bulk_approve_candidate_rule_reviews(
    session: Session,
    *,
    candidate_rule_ids: list[str],
    commit: bool = True,
) -> list[CandidateRuleReview]:
    unique_candidate_rule_ids = list(dict.fromkeys(candidate_rule_ids))
    records = session.scalars(
        select(RuleRecord)
        .where(RuleRecord.rule_id.in_(unique_candidate_rule_ids))
        .order_by(RuleRecord.rule_id)
    ).all()
    record_by_id = {record.rule_id: record for record in records}

    for candidate_rule_id in unique_candidate_rule_ids:
        record = record_by_id.get(candidate_rule_id)
        if record is None or record.origin_source_type != "extracted":
            raise CandidateRuleNotFoundError(candidate_rule_id)

    for candidate_rule_id in unique_candidate_rule_ids:
        _approve_candidate_rule_record(record_by_id[candidate_rule_id])

    session.flush()
    if commit:
        session.commit()
        for record in records:
            session.refresh(record)
    return [
        _build_candidate_rule_review(record_by_id[candidate_rule_id])
        for candidate_rule_id in unique_candidate_rule_ids
    ]


def reject_candidate_rule_review(
    session: Session,
    *,
    candidate_rule_id: str,
    commit: bool = True,
) -> CandidateRuleReview:
    record = _get_candidate_rule_record(session, candidate_rule_id=candidate_rule_id)
    current_rule = _current_candidate_rule_value(record)
    _ensure_transition_allowed(
        current_state=current_rule.lifecycle_state,
        target_state=LifecycleState.REJECTED,
    )
    rejected_rule = CandidateRuleValue.model_validate(
        {
            **current_rule.model_dump(mode="json"),
            "lifecycle_state": LifecycleState.REJECTED.value,
        }
    )
    _persist_candidate_rule_review(
        record,
        current_rule=rejected_rule,
        committed_rule=rejected_rule,
    )
    session.flush()
    if commit:
        session.commit()
        session.refresh(record)
    return _build_candidate_rule_review(record)


def _get_candidate_rule_record(session: Session, *, candidate_rule_id: str) -> RuleRecord:
    record = session.get(RuleRecord, candidate_rule_id)
    if record is None or record.origin_source_type != "extracted":
        raise CandidateRuleNotFoundError(candidate_rule_id)
    return record


def _approve_candidate_rule_record(record: RuleRecord) -> None:
    current_rule = _current_candidate_rule_value(record)
    _ensure_transition_allowed(
        current_state=current_rule.lifecycle_state,
        target_state=LifecycleState.APPROVED,
    )
    approved_payload = {
        **current_rule.model_dump(mode="json"),
        "lifecycle_state": LifecycleState.APPROVED.value,
    }
    try:
        approved_rule = Rule.model_validate(approved_payload)
    except ValidationError as exc:
        raise InvalidCandidateRuleApprovalError(_first_validation_message(exc)) from exc

    approved_value = CandidateRuleValue.model_validate(approved_rule.model_dump(mode="json"))
    _persist_candidate_rule_review(
        record,
        current_rule=approved_value,
        committed_rule=approved_value,
    )


def _build_candidate_rule_review(record: RuleRecord) -> CandidateRuleReview:
    current_rule = _current_candidate_rule_value(record)
    extracted_payload = record.payload.get("extracted_rule") or _rule_value_payload(current_rule)
    committed_payload = record.payload.get("committed_rule")
    return CandidateRuleReview(
        candidate_rule_id=record.rule_id,
        lifecycle_state=current_rule.lifecycle_state,
        current_rule=current_rule,
        extracted_rule=CandidateRuleValue.model_validate(extracted_payload),
        committed_rule=(
            CandidateRuleValue.model_validate(committed_payload)
            if committed_payload is not None
            else None
        ),
        qa_flags=[QAFlag.model_validate(flag) for flag in record.payload.get("qa_flags", [])],
    )


def _current_candidate_rule_value(record: RuleRecord) -> CandidateRuleValue:
    return CandidateRuleValue.model_validate(record.payload)


def _persist_candidate_rule_review(
    record: RuleRecord,
    *,
    current_rule: CandidateRuleValue,
    committed_rule: CandidateRuleValue | None,
) -> None:
    payload = deepcopy(record.payload)
    current_payload = current_rule.model_dump(mode="json")
    for field in _CANDIDATE_RULE_METADATA_FIELDS:
        current_payload.pop(field, None)
    payload.update(current_payload)
    payload["extracted_rule"] = payload.get("extracted_rule") or _rule_value_payload(
        CandidateRuleValue.model_validate(record.payload)
    )
    payload["committed_rule"] = (
        committed_rule.model_dump(mode="json") if committed_rule is not None else None
    )
    record.payload = payload


def _rule_value_payload(rule: CandidateRuleValue) -> dict[str, object]:
    return rule.model_dump(mode="json")


def _ensure_transition_allowed(
    *,
    current_state: LifecycleState,
    target_state: LifecycleState,
) -> None:
    if target_state is LifecycleState.IN_REVIEW and current_state in _EDITABLE_REVIEW_STATES:
        return
    if current_state in _EDITABLE_REVIEW_STATES and target_state in {
        LifecycleState.APPROVED,
        LifecycleState.REJECTED,
    }:
        return
    raise InvalidCandidateRuleTransitionError(
        current_state=current_state,
        target_state=target_state,
    )


def _first_validation_message(error: ValidationError) -> str:
    details = error.errors()
    if not details:
        return str(error)
    message = details[0].get("msg")
    return message if isinstance(message, str) else str(error)
