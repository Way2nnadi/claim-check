from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from policy_pipeline.expense_reports import ExpenseReportRow


class RuleTestCaseVariant(StrEnum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    BOUNDARY = "boundary"
    EXCEPTION = "exception"


class EvaluationOutcome(StrEnum):
    PASS = "pass"
    VIOLATION = "violation"
    NEEDS_REVIEW = "needs_review"
    MISSING_EVIDENCE = "missing_evidence"


class RuleTestCaseStatus(StrEnum):
    ACTIVE = "active"
    DISABLED = "disabled"


class RuleTestCase(BaseModel):
    rule_test_case_id: str = Field(min_length=1)
    compiled_rule_set_id: str = Field(min_length=1)
    rule_id: str = Field(min_length=1)
    variant: RuleTestCaseVariant
    expense_fixture: ExpenseReportRow
    expected_outcome: EvaluationOutcome
    generated_by: str = Field(min_length=1)
    generated_at: datetime
    status: RuleTestCaseStatus = RuleTestCaseStatus.ACTIVE
    disabled_at: datetime | None = None
    disabled_by: str | None = None
    disable_rationale: str | None = None


class RuleTestCaseGroup(BaseModel):
    rule_id: str = Field(min_length=1)
    statement: str = Field(min_length=1)
    positive_count: int = Field(ge=0)
    negative_count: int = Field(ge=0)
    boundary_count: int = Field(ge=0)
    exception_count: int = Field(ge=0)
    cases: list[RuleTestCase] = Field(default_factory=list)


class RuleTestCaseListResponse(BaseModel):
    compiled_rule_set_id: str = Field(min_length=1)
    groups: list[RuleTestCaseGroup] = Field(default_factory=list)
    total_count: int = Field(ge=0)
    active_count: int = Field(ge=0)
    disabled_count: int = Field(ge=0)


class RuleTestCaseDisableRequest(BaseModel):
    rationale: str = Field(min_length=1)


class RuleTestCaseEnableRequest(BaseModel):
    rationale: str = Field(min_length=1)


class RuleTestCaseGenerateResponse(BaseModel):
    compiled_rule_set_id: str = Field(min_length=1)
    groups: list[RuleTestCaseGroup] = Field(default_factory=list)
    generated_count: int = Field(ge=0)
    created: bool


class RuleTestRunCaseResult(BaseModel):
    rule_test_case_id: str = Field(min_length=1)
    rule_id: str = Field(min_length=1)
    variant: RuleTestCaseVariant
    expected_outcome: EvaluationOutcome
    actual_outcome: EvaluationOutcome
    passed: bool


class RuleTestRunSummary(BaseModel):
    total_count: int = Field(ge=0)
    passed_count: int = Field(ge=0)
    failed_count: int = Field(ge=0)
    overall_passed: bool


class RuleTestRun(BaseModel):
    rule_test_run_id: str = Field(min_length=1)
    compiled_rule_set_id: str = Field(min_length=1)
    executed_by: str = Field(min_length=1)
    executed_at: datetime
    summary: RuleTestRunSummary
    case_results: list[RuleTestRunCaseResult] = Field(default_factory=list)


class RuleTestRunListResponse(BaseModel):
    compiled_rule_set_id: str = Field(min_length=1)
    items: list[RuleTestRun] = Field(default_factory=list)
