export type ComplianceOutcome = "pass" | "violation";

export interface ComplianceEvaluationRowOutcome {
  row_index: number;
  employee_id: string;
  expense_date: string;
  outcome: ComplianceOutcome;
  rule_id: string | null;
  reason: string | null;
}

export interface ComplianceEvaluationRunSummary {
  total_count: number;
  pass_count: number;
  violation_count: number;
}

export interface ComplianceEvaluationRun {
  compliance_evaluation_run_id: string;
  expense_report_id: string;
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
  compiled_rule_set_id: string;
}
