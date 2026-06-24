export type RuleTestCaseVariant = "positive" | "negative" | "boundary" | "exception";

export type EvaluationOutcome =
  | "pass"
  | "violation"
  | "needs_review"
  | "missing_evidence";

export interface ExpenseFixture {
  employee_id: string;
  expense_date: string;
  expense_category: string;
  amount: string;
  currency: string;
  country?: string | null;
  travel_type?: string | null;
  business_purpose?: string | null;
  attendee_list?: string | null;
  manager_approval?: boolean | null;
  receipt_attached?: boolean | null;
  trip_id?: string | null;
  submission_days?: number | null;
}

export type RuleTestCaseStatus = "active" | "disabled";

export interface RuleTestCase {
  rule_test_case_id: string;
  compiled_rule_set_id: string;
  rule_id: string;
  variant: RuleTestCaseVariant;
  expense_fixture: ExpenseFixture;
  expected_outcome: EvaluationOutcome;
  generated_by: string;
  generated_at: string;
  status: RuleTestCaseStatus;
  disabled_at?: string | null;
  disabled_by?: string | null;
  disable_rationale?: string | null;
  edited_at?: string | null;
  edited_by?: string | null;
  edit_rationale?: string | null;
}

export interface RuleTestCaseEditRequest {
  rationale: string;
  expense_fixture?: ExpenseFixture;
  expected_outcome?: EvaluationOutcome;
}

export interface RuleTestCaseDisableRequest {
  rationale: string;
}

export interface RuleTestCaseEnableRequest {
  rationale: string;
}

export interface RuleTestCaseGroup {
  rule_id: string;
  statement: string;
  positive_count: number;
  negative_count: number;
  boundary_count: number;
  exception_count: number;
  cases: RuleTestCase[];
}

export interface RuleTestCaseListResponse {
  compiled_rule_set_id: string;
  groups: RuleTestCaseGroup[];
  total_count: number;
  active_count: number;
  disabled_count: number;
}

export interface RuleTestCaseGenerateResponse {
  compiled_rule_set_id: string;
  groups: RuleTestCaseGroup[];
  generated_count: number;
  created: boolean;
}

export interface RuleTestRunCaseResult {
  rule_test_case_id: string;
  rule_id: string;
  variant: RuleTestCaseVariant;
  expected_outcome: EvaluationOutcome;
  actual_outcome: EvaluationOutcome;
  passed: boolean;
}

export interface RuleTestRunSummary {
  total_count: number;
  passed_count: number;
  failed_count: number;
  overall_passed: boolean;
}

export interface RuleTestRun {
  rule_test_run_id: string;
  compiled_rule_set_id: string;
  executed_by: string;
  executed_at: string;
  summary: RuleTestRunSummary;
  case_results: RuleTestRunCaseResult[];
}

export interface RuleTestRunListResponse {
  compiled_rule_set_id: string;
  items: RuleTestRun[];
}
