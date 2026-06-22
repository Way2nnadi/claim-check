from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class ComplianceOutcome(StrEnum):
    PASS = "pass"
    VIOLATION = "violation"


class ComplianceEvaluationRowOutcome(BaseModel):
    row_index: int = Field(ge=0)
    employee_id: str = Field(min_length=1)
    expense_date: date
    outcome: ComplianceOutcome
    rule_id: str | None = None
    reason: str | None = None


class ComplianceEvaluationRunSummary(BaseModel):
    total_count: int = Field(ge=0)
    pass_count: int = Field(ge=0)
    violation_count: int = Field(ge=0)


class ComplianceEvaluationRun(BaseModel):
    compliance_evaluation_run_id: str = Field(min_length=1)
    expense_report_id: str = Field(min_length=1)
    compiled_rule_set_id: str = Field(min_length=1)
    policy_version_id: str = Field(min_length=1)
    executed_by: str = Field(min_length=1)
    executed_at: datetime
    summary: ComplianceEvaluationRunSummary
    row_outcomes: list[ComplianceEvaluationRowOutcome] = Field(default_factory=list)


class ComplianceEvaluationRunStartRequest(BaseModel):
    compiled_rule_set_id: str = Field(min_length=1)


class ComplianceEvaluationRunListResponse(BaseModel):
    expense_report_id: str = Field(min_length=1)
    items: list[ComplianceEvaluationRun] = Field(default_factory=list)
