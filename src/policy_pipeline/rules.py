from enum import StrEnum

from pydantic import BaseModel, Field, model_validator


class RuleOriginType(StrEnum):
    EXTRACTED = "extracted"
    MANUAL = "manual"


class EnforceabilityClass(StrEnum):
    ENFORCEABLE = "enforceable"
    GUIDANCE = "guidance"
    SUBJECTIVE = "subjective"


class LifecycleState(StrEnum):
    EXTRACTED = "extracted"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    PUBLISHED = "published"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    SUPERSEDED = "superseded"


class AggregationPeriod(StrEnum):
    PER_TRANSACTION = "per_transaction"
    PER_DAY = "per_day"
    PER_TRIP = "per_trip"
    PER_NIGHT = "per_night"
    PER_ATTENDEE = "per_attendee"


class QAFlagCode(StrEnum):
    MISSING_THRESHOLD = "missing_threshold"
    INVALID_ENUM = "invalid_enum"
    MISSING_APPLICABILITY = "missing_applicability"
    UNRESOLVABLE_CITATION = "unresolvable_citation"
    LOW_EXTRACTION_CONFIDENCE = "low_extraction_confidence"


class RuleOrigin(BaseModel):
    source_type: RuleOriginType
    extraction_run_id: str | None = None
    rationale: str | None = None

    @model_validator(mode="after")
    def validate_origin(self) -> "RuleOrigin":
        if self.source_type is RuleOriginType.EXTRACTED and not self.extraction_run_id:
            raise ValueError("Extracted origin requires extraction_run_id.")
        if self.source_type is RuleOriginType.MANUAL and not self.rationale:
            raise ValueError("Manual origin requires rationale.")
        return self


class Citation(BaseModel):
    document_id: str = Field(min_length=1)
    document_version_id: str = Field(min_length=1)
    section_id: str = Field(min_length=1)
    quote: str = Field(min_length=1)
    start_char: int = Field(ge=0)
    end_char: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_offsets(self) -> "Citation":
        if self.end_char <= self.start_char:
            raise ValueError("Citation end_char must be greater than start_char.")
        return self


class Scope(BaseModel):
    country: str | None = None
    expense_category: str | None = None
    travel_type: str | None = None
    employee_group: str | None = None
    effective_start_date: str | None = None
    effective_end_date: str | None = None


class Applicability(BaseModel):
    aggregation_period: AggregationPeriod
    unit: str = Field(min_length=1)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    limit_basis: str | None = None


class RuleException(BaseModel):
    description: str = Field(min_length=1)
    required_evidence: list[str] = Field(default_factory=list)


class RuleCondition(BaseModel):
    field: str = Field(min_length=1)
    operator: str = Field(min_length=1)
    value: str = Field(min_length=1)


class QAFlag(BaseModel):
    code: QAFlagCode
    detail: str = Field(min_length=1)


class _RulePayload(BaseModel):
    rule_id: str = Field(min_length=1)
    statement: str = Field(min_length=1)
    enforceability_class: EnforceabilityClass
    lifecycle_state: LifecycleState
    origin: RuleOrigin
    scope: Scope
    citation: Citation | None = None
    condition: RuleCondition | None = None
    applicability: Applicability | None = None
    exceptions: list[RuleException] = Field(default_factory=list)


class CandidateRuleValue(_RulePayload):
    @model_validator(mode="after")
    def validate_candidate_rule_value(self) -> "CandidateRuleValue":
        if (
            self.enforceability_class is not EnforceabilityClass.ENFORCEABLE
            and self.condition is not None
        ):
            raise ValueError(
                "Guidance and subjective Candidate Rules must not include "
                "a machine-checkable condition."
            )
        return self


class CandidateRule(CandidateRuleValue):
    qa_flags: list[QAFlag] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_candidate_rule(self) -> "CandidateRule":
        if self.lifecycle_state not in {LifecycleState.EXTRACTED, LifecycleState.IN_REVIEW}:
            raise ValueError("Candidate Rule lifecycle_state must be extracted or in_review.")
        return self


class Rule(_RulePayload):

    @model_validator(mode="after")
    def validate_rule(self) -> "Rule":
        if self.origin.source_type is RuleOriginType.EXTRACTED and self.citation is None:
            raise ValueError("Extracted Rule requires a Citation.")
        if self.enforceability_class is EnforceabilityClass.ENFORCEABLE and self.condition is None:
            raise ValueError("Enforceable Rule requires a machine-checkable condition.")
        if (
            self.enforceability_class is not EnforceabilityClass.ENFORCEABLE
            and self.condition is not None
        ):
            raise ValueError(
                "Guidance and subjective Rules must not include a machine-checkable condition."
            )
        return self


class PolicyVersionSnapshot(BaseModel):
    policy_version_id: str = Field(min_length=1)
    change_summary: str = Field(min_length=1)
    published_by: str = Field(min_length=1)
    rules: list[Rule] = Field(default_factory=list)


class CandidateRuleReview(BaseModel):
    candidate_rule_id: str = Field(min_length=1)
    lifecycle_state: LifecycleState
    current_rule: CandidateRuleValue
    extracted_rule: CandidateRuleValue
    committed_rule: CandidateRuleValue | None = None
    qa_flags: list[QAFlag] = Field(default_factory=list)
