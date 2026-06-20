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


class Rule(BaseModel):
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

    @model_validator(mode="after")
    def validate_rule(self) -> "Rule":
        if self.citation is None:
            raise ValueError("Rule requires a Citation.")
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
