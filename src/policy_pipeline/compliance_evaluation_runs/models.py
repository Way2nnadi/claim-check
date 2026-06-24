from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, Field, model_validator

from policy_pipeline.expense_reports import ExpenseInputFingerprint
from policy_pipeline.rules.models import AggregationPeriod, Citation


class ComplianceOutcome(StrEnum):
    PASS = "pass"
    VIOLATION = "violation"
    NEEDS_REVIEW = "needs_review"
    MISSING_EVIDENCE = "missing_evidence"


class ScopeMatchContext(BaseModel):
    matched_dimensions: dict[str, str] = Field(default_factory=dict)
    unavailable_dimensions: dict[str, str] = Field(default_factory=dict)


class CurrencyMatchStatus(StrEnum):
    MATCH = "match"
    MISMATCH = "mismatch"
    NOT_APPLICABLE = "not_applicable"


class CurrencyMatchContext(BaseModel):
    rule_currency: str | None = None
    expense_currency: str
    status: CurrencyMatchStatus
    conversion_supported: bool = False


class EffectiveDatePosition(StrEnum):
    BEFORE = "before"
    WITHIN = "within"
    AFTER = "after"


class EffectiveDateScopeContext(BaseModel):
    effective_start_date: str | None = None
    effective_end_date: str | None = None
    expense_date: str
    position: EffectiveDatePosition


class AggregationWindowRowRef(BaseModel):
    row_index: int = Field(ge=0)
    row_amount: str | None = None


class AggregationWindowContext(BaseModel):
    aggregation_period: AggregationPeriod
    included_rows: list[AggregationWindowRowRef] = Field(default_factory=list)
    aggregate_value: str = Field(min_length=1)
    policy_limit: str = Field(min_length=1)
    trip_id: str | None = None
    attendee_count: int | None = Field(default=None, ge=1)
    grouping_note: str | None = None


class ComplianceEvaluationRowOutcome(BaseModel):
    row_index: int = Field(ge=0)
    employee_id: str = Field(min_length=1)
    expense_date: date
    outcome: ComplianceOutcome
    rule_id: str | None = None
    matching_rule_ids: list[str] = Field(default_factory=list)
    reason: str | None = None
    policy_limit: str | None = None
    actual_value: str | None = None
    missing_evidence_fields: list[str] = Field(default_factory=list)
    evidence: list[Citation] = Field(default_factory=list)
    scope_context: ScopeMatchContext | None = None
    currency_context: CurrencyMatchContext | None = None
    effective_date_context: EffectiveDateScopeContext | None = None
    aggregation_context: AggregationWindowContext | None = None


class ComplianceEvaluationRunSummary(BaseModel):
    total_count: int = Field(ge=0)
    pass_count: int = Field(ge=0)
    violation_count: int = Field(ge=0)
    needs_review_count: int = Field(default=0, ge=0)
    missing_evidence_count: int = Field(default=0, ge=0)


class ComplianceEvaluationRun(BaseModel):
    compliance_evaluation_run_id: str = Field(min_length=1)
    expense_report_id: str = Field(min_length=1)
    expense_input_fingerprint: ExpenseInputFingerprint | None = None
    compiled_rule_set_id: str = Field(min_length=1)
    policy_version_id: str = Field(min_length=1)
    executed_by: str = Field(min_length=1)
    executed_at: datetime
    summary: ComplianceEvaluationRunSummary
    row_outcomes: list[ComplianceEvaluationRowOutcome] = Field(default_factory=list)


class ComplianceEvaluationRunStartRequest(BaseModel):
    compiled_rule_set_id: str | None = Field(default=None, min_length=1)
    policy_version_id: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def require_evaluation_target(self) -> ComplianceEvaluationRunStartRequest:
        if not self.compiled_rule_set_id and not self.policy_version_id:
            raise ValueError(
                "Either compiled_rule_set_id or policy_version_id is required."
            )
        return self


class ComplianceEvaluationRunListResponse(BaseModel):
    expense_report_id: str = Field(min_length=1)
    items: list[ComplianceEvaluationRun] = Field(default_factory=list)
