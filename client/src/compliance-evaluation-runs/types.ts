export type ComplianceOutcome =
  | "pass"
  | "violation"
  | "needs_review"
  | "missing_evidence";

export interface Citation {
  document_id: string;
  document_version_id: string;
  section_id: string;
  quote: string;
  start_char: number;
  end_char: number;
}

export interface ScopeMatchContext {
  matched_dimensions: Record<string, string>;
  unavailable_dimensions: Record<string, string>;
}

export type CurrencyMatchStatus = "match" | "mismatch" | "not_applicable";

export interface CurrencyMatchContext {
  rule_currency: string | null;
  expense_currency: string;
  status: CurrencyMatchStatus;
  conversion_supported: boolean;
}

export type EffectiveDatePosition = "before" | "within" | "after";

export interface EffectiveDateScopeContext {
  effective_start_date: string | null;
  effective_end_date: string | null;
  expense_date: string;
  position: EffectiveDatePosition;
}

export type AggregationPeriod =
  | "per_transaction"
  | "per_day"
  | "per_trip"
  | "per_night"
  | "per_attendee";

export interface AggregationWindowRowRef {
  row_index: number;
  row_amount: string | null;
}

export interface AggregationWindowContext {
  aggregation_period: AggregationPeriod;
  included_rows: AggregationWindowRowRef[];
  aggregate_value: string;
  policy_limit: string;
  trip_id: string | null;
  attendee_count: number | null;
  grouping_note: string | null;
}

export interface ComplianceEvaluationRowOutcome {
  row_index: number;
  employee_id: string;
  expense_date: string;
  outcome: ComplianceOutcome;
  rule_id: string | null;
  matching_rule_ids: string[];
  reason: string | null;
  policy_limit: string | null;
  actual_value: string | null;
  missing_evidence_fields: string[];
  evidence: Citation[];
  scope_context: ScopeMatchContext | null;
  currency_context: CurrencyMatchContext | null;
  effective_date_context: EffectiveDateScopeContext | null;
  aggregation_context: AggregationWindowContext | null;
}

export interface ComplianceEvaluationRunSummary {
  total_count: number;
  pass_count: number;
  violation_count: number;
  needs_review_count: number;
  missing_evidence_count: number;
}

export interface ExpenseInputFingerprint {
  source_filename: string;
  row_count: number;
  content_hash: string;
}

export interface ComplianceEvaluationRun {
  compliance_evaluation_run_id: string;
  expense_report_id: string;
  expense_input_fingerprint: ExpenseInputFingerprint | null;
  compiled_rule_set_id: string;
  policy_version_id: string;
  executed_by: string;
  executed_at: string;
  summary: ComplianceEvaluationRunSummary;
  row_outcomes: ComplianceEvaluationRowOutcome[];
}

export interface ComplianceEvaluationRunListResponse {
  expense_report_id: string;
  items: ComplianceEvaluationRun[];
}

export interface ComplianceEvaluationRunStartRequest {
  compiled_rule_set_id?: string;
  policy_version_id?: string;
}
