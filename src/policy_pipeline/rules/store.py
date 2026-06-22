from __future__ import annotations

from copy import deepcopy

from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from policy_pipeline.extraction.records import ExtractionRunRecord
from policy_pipeline.policy_documents.records import DocumentVersionRecord
from policy_pipeline.policy_documents.citations import (
    CitationMatchKind,
    resolve_citation_anchor_with_fallback,
)
from policy_pipeline.rules.models import (
    CandidateRule,
    CandidateRuleReview,
    CandidateRuleValue,
    Citation,
    LifecycleState,
    QAFlag,
    QAFlagCode,
    ReingestionDiffCategory,
    Rule,
    RuleOriginType,
)
from policy_pipeline.shared.database import RuleRecord


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


class BulkCandidateRuleApprovalFailure(BaseModel):
    candidate_rule_id: str
    detail: str


class BulkCandidateRuleApprovalResult(BaseModel):
    approved_reviews: list[CandidateRuleReview]
    failures: list[BulkCandidateRuleApprovalFailure]


_CANDIDATE_RULE_METADATA_FIELDS = {"qa_flags", "extracted_rule", "committed_rule"}
_EDITABLE_REVIEW_STATES = {LifecycleState.EXTRACTED, LifecycleState.IN_REVIEW}
_REINGESTION_DIFF_CATEGORY_FIELD = "reingestion_diff_category"


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


class CandidateRuleReviewListResponse(BaseModel):
    items: list[CandidateRuleReview]


def list_candidate_rule_reviews(
    session: Session,
    *,
    lifecycle_states: set[LifecycleState] | None = None,
    document_id: str | None = None,
    document_version_id: str | None = None,
    extraction_run_id: str | None = None,
) -> list[CandidateRuleReview]:
    statement = (
        select(RuleRecord)
        .where(RuleRecord.origin_source_type == RuleOriginType.EXTRACTED.value)
        .order_by(RuleRecord.rule_id)
    )
    reviews: list[CandidateRuleReview] = []
    for record in session.scalars(statement).all():
        review = _build_candidate_rule_review(record)
        if lifecycle_states is not None and review.lifecycle_state not in lifecycle_states:
            continue
        citation = review.current_rule.citation
        if document_id is not None and (
            citation is None or citation.document_id != document_id
        ):
            continue
        if document_version_id is not None and (
            citation is None or citation.document_version_id != document_version_id
        ):
            continue
        if extraction_run_id is not None and (
            review.current_rule.origin.extraction_run_id != extraction_run_id
        ):
            continue
        reviews.append(review)
    return reviews


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
    next_rule, qa_flags = _reconcile_citation_and_qa_flags(
        session,
        record=record,
        rule=next_rule,
    )
    _persist_candidate_rule_review(
        record,
        current_rule=next_rule,
        committed_rule=next_rule,
        qa_flags=qa_flags,
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
) -> BulkCandidateRuleApprovalResult:
    unique_candidate_rule_ids = list(dict.fromkeys(candidate_rule_ids))
    records = session.scalars(
        select(RuleRecord).where(RuleRecord.rule_id.in_(unique_candidate_rule_ids))
    ).all()
    record_by_id = {record.rule_id: record for record in records}
    approved_records: list[RuleRecord] = []
    failures: list[BulkCandidateRuleApprovalFailure] = []

    for candidate_rule_id in unique_candidate_rule_ids:
        record = record_by_id.get(candidate_rule_id)
        if record is None or record.origin_source_type != "extracted":
            failures.append(
                BulkCandidateRuleApprovalFailure(
                    candidate_rule_id=candidate_rule_id,
                    detail="Candidate Rule was not found.",
                )
            )
            continue
        try:
            _approve_candidate_rule_record(record)
        except InvalidCandidateRuleTransitionError as exc:
            failures.append(
                BulkCandidateRuleApprovalFailure(
                    candidate_rule_id=candidate_rule_id,
                    detail=(
                        "Candidate Rule cannot transition from "
                        f"{exc.current_state.value} to {exc.target_state.value}."
                    ),
                )
            )
            continue
        except InvalidCandidateRuleApprovalError as exc:
            failures.append(
                BulkCandidateRuleApprovalFailure(
                    candidate_rule_id=candidate_rule_id,
                    detail=exc.detail,
                )
            )
            continue
        approved_records.append(record)

    session.flush()
    if commit:
        session.commit()
        for record in approved_records:
            session.refresh(record)
    return BulkCandidateRuleApprovalResult(
        approved_reviews=[_build_candidate_rule_review(record) for record in approved_records],
        failures=failures,
    )


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
        reingestion_diff_category=_reingestion_diff_category(record),
    )


def _current_candidate_rule_value(record: RuleRecord) -> CandidateRuleValue:
    return CandidateRuleValue.model_validate(record.payload)


def _persist_candidate_rule_review(
    record: RuleRecord,
    *,
    current_rule: CandidateRuleValue,
    committed_rule: CandidateRuleValue | None,
    qa_flags: list[QAFlag] | None = None,
) -> None:
    payload = deepcopy(record.payload)
    current_payload = current_rule.model_dump(mode="json")
    for field in _CANDIDATE_RULE_METADATA_FIELDS:
        current_payload.pop(field, None)
    payload.update(current_payload)
    if qa_flags is not None:
        payload["qa_flags"] = [flag.model_dump(mode="json") for flag in qa_flags]
    payload["extracted_rule"] = payload.get("extracted_rule") or _rule_value_payload(
        CandidateRuleValue.model_validate(record.payload)
    )
    payload["committed_rule"] = (
        committed_rule.model_dump(mode="json") if committed_rule is not None else None
    )
    record.payload = payload


def _reconcile_citation_and_qa_flags(
    session: Session,
    *,
    record: RuleRecord,
    rule: CandidateRuleValue,
) -> tuple[CandidateRuleValue, list[QAFlag]]:
    qa_flags = [
        QAFlag.model_validate(flag) for flag in record.payload.get("qa_flags", [])
    ]
    has_unresolvable = any(
        flag.code is QAFlagCode.UNRESOLVABLE_CITATION for flag in qa_flags
    )
    if rule.citation is not None and not has_unresolvable:
        return rule, qa_flags

    if rule.citation is not None:
        qa_flags = [
            flag
            for flag in qa_flags
            if flag.code is not QAFlagCode.UNRESOLVABLE_CITATION
        ]
        return rule, qa_flags

    extraction_run_id = rule.origin.extraction_run_id
    if extraction_run_id is None:
        return rule, qa_flags

    extraction_run = session.get(ExtractionRunRecord, extraction_run_id)
    if extraction_run is None:
        return rule, qa_flags

    document_version = session.get(
        DocumentVersionRecord,
        extraction_run.document_version_id,
    )
    if document_version is None:
        return rule, qa_flags

    resolution = resolve_citation_anchor_with_fallback(
        session,
        document_id=document_version.document_id,
        document_version_id=document_version.document_version_id,
        quote=rule.statement,
    )
    if resolution is None:
        if not has_unresolvable:
            qa_flags.append(
                QAFlag(
                    code=QAFlagCode.UNRESOLVABLE_CITATION,
                    detail=(
                        "Candidate Rule Citation quote could not be resolved: "
                        f"{rule.statement!r}."
                    ),
                )
            )
        return rule, qa_flags

    qa_flags = [
        flag
        for flag in qa_flags
        if flag.code
        not in {QAFlagCode.UNRESOLVABLE_CITATION, QAFlagCode.APPROXIMATE_CITATION}
    ]
    if resolution.match_kind is not CitationMatchKind.EXACT:
        qa_flags.append(
            QAFlag(
                code=QAFlagCode.APPROXIMATE_CITATION,
                detail=(
                    "Candidate Rule citation was resolved via "
                    f"{resolution.match_kind.value} matching. LLM quote "
                    f"{resolution.requested_quote!r} anchored to document text "
                    f"{resolution.anchor.quote!r}."
                ),
            )
        )

    anchor = resolution.anchor
    return (
        rule.model_copy(
            update={
                "citation": Citation(
                    document_id=anchor.document_id,
                    document_version_id=anchor.document_version_id,
                    section_id=anchor.section_id,
                    quote=anchor.quote,
                    start_char=anchor.start_char,
                    end_char=anchor.end_char,
                )
            }
        ),
        qa_flags,
    )


def _rule_value_payload(rule: CandidateRuleValue) -> dict[str, object]:
    return rule.model_dump(mode="json")


def clear_reingestion_diff_categories(session: Session, *, document_id: str) -> None:
    statement = select(RuleRecord).where(
        RuleRecord.origin_source_type == RuleOriginType.EXTRACTED.value
    )
    for record in session.scalars(statement).all():
        current_citation = record.payload.get("citation")
        extracted_citation = (record.payload.get("extracted_rule") or {}).get("citation")
        if not _payload_matches_document(
            current_citation,
            document_id,
        ) and not _payload_matches_document(extracted_citation, document_id):
            continue
        payload = deepcopy(record.payload)
        payload.pop(_REINGESTION_DIFF_CATEGORY_FIELD, None)
        record.payload = payload


def set_reingestion_diff_category(
    session: Session,
    *,
    candidate_rule_id: str,
    category: ReingestionDiffCategory,
) -> None:
    record = session.get(RuleRecord, candidate_rule_id)
    if record is None:
        return
    payload = deepcopy(record.payload)
    payload[_REINGESTION_DIFF_CATEGORY_FIELD] = category.value
    record.payload = payload


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


def _payload_matches_document(payload: object, document_id: str) -> bool:
    return isinstance(payload, dict) and payload.get("document_id") == document_id


def _reingestion_diff_category(record: RuleRecord) -> ReingestionDiffCategory | None:
    raw_value = record.payload.get(_REINGESTION_DIFF_CATEGORY_FIELD)
    if raw_value is None:
        return None
    return ReingestionDiffCategory(raw_value)
