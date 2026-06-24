from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from policy_pipeline.compliance_evaluation_runs.models import (
    ComplianceEvaluationRowOutcome,
    ComplianceOutcome,
)
from policy_pipeline.expense_reports import ExpenseReportRow
from policy_pipeline.rules.models import Citation


class ComplianceReviewResolutionType(StrEnum):
    UPHELD = "upheld"
    OVERRIDDEN_PASS = "overridden_pass"
    ESCALATED = "escalated"


class ComplianceReviewDecision(BaseModel):
    compliance_review_decision_id: str = Field(min_length=1)
    evaluation_outcome_id: str = Field(min_length=1)
    compliance_evaluation_run_id: str = Field(min_length=1)
    row_index: int = Field(ge=0)
    resolution_type: ComplianceReviewResolutionType
    rationale: str = Field(min_length=1)
    recorded_by: str = Field(min_length=1)
    recorded_at: datetime


class ComplianceReviewQueueItem(BaseModel):
    compliance_review_id: str = Field(min_length=1)
    compliance_evaluation_run_id: str = Field(min_length=1)
    expense_report_id: str = Field(min_length=1)
    row_index: int = Field(ge=0)
    outcome: ComplianceOutcome
    rule_id: str | None = None
    employee_id: str = Field(min_length=1)
    expense_date: date
    reason: str | None = None
    executed_at: datetime


class ComplianceReviewListResponse(BaseModel):
    items: list[ComplianceReviewQueueItem] = Field(default_factory=list)
    compliance_evaluation_run_id: str | None = None
    include_violations: bool = True


class ComplianceReviewDetail(BaseModel):
    compliance_review_id: str = Field(min_length=1)
    compliance_evaluation_run_id: str = Field(min_length=1)
    expense_report_id: str = Field(min_length=1)
    policy_version_id: str = Field(min_length=1)
    compiled_rule_set_id: str = Field(min_length=1)
    executed_at: datetime
    expense_row: ExpenseReportRow
    row_outcome: ComplianceEvaluationRowOutcome
    rule_statement: str | None = None
    citation: Citation | None = None
    decision: ComplianceReviewDecision | None = None


class ComplianceReviewDecisionRequest(BaseModel):
    resolution_type: ComplianceReviewResolutionType
    rationale: str = Field(min_length=1)


class ComplianceReviewDecisionResponse(BaseModel):
    decision: ComplianceReviewDecision
