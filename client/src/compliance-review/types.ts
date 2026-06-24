import type { Citation } from "../rules/types";
import type {
  ComplianceEvaluationRowOutcome,
  ComplianceOutcome,
} from "../compliance-evaluation-runs/types";

export interface ExpenseReportRow {
  employee_id: string;
  expense_date: string;
  expense_category: string;
  amount: string;
  currency: string;
  country: string | null;
  travel_type: string | null;
  business_purpose: string | null;
  attendee_list: string | null;
  manager_approval: boolean | null;
  receipt_attached: boolean | null;
  trip_id: string | null;
  submission_days: number | null;
}

export type ComplianceReviewResolutionType =
  | "upheld"
  | "overridden_pass"
  | "escalated";

export interface ComplianceReviewDecision {
  compliance_review_decision_id: string;
  evaluation_outcome_id: string;
  compliance_evaluation_run_id: string;
  row_index: number;
  resolution_type: ComplianceReviewResolutionType;
  rationale: string;
  recorded_by: string;
  recorded_at: string;
}

export interface ComplianceReviewQueueItem {
  compliance_review_id: string;
  compliance_evaluation_run_id: string;
  expense_report_id: string;
  row_index: number;
  outcome: ComplianceOutcome;
  rule_id: string | null;
  employee_id: string;
  expense_date: string;
  reason: string | null;
  executed_at: string;
}

export interface ComplianceReviewListResponse {
  items: ComplianceReviewQueueItem[];
  compliance_evaluation_run_id: string | null;
  include_violations: boolean;
}

export interface ComplianceReviewDetail {
  compliance_review_id: string;
  compliance_evaluation_run_id: string;
  expense_report_id: string;
  policy_version_id: string;
  compiled_rule_set_id: string;
  executed_at: string;
  expense_row: ExpenseReportRow;
  row_outcome: ComplianceEvaluationRowOutcome;
  rule_statement: string | null;
  citation: Citation | null;
  decision: ComplianceReviewDecision | null;
}

export interface ComplianceReviewDecisionRequest {
  resolution_type: ComplianceReviewResolutionType;
  rationale: string;
}

export type ComplianceReviewOutcomeFilter = ComplianceOutcome | "all";
