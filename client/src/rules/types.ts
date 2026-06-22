export type LifecycleState =
  | "extracted"
  | "in_review"
  | "approved"
  | "published"
  | "rejected"
  | "withdrawn"
  | "superseded";

export type EnforceabilityClass = "enforceable" | "guidance" | "subjective";

export type QAFlagCode =
  | "missing_threshold"
  | "invalid_enum"
  | "missing_applicability"
  | "unresolvable_citation"
  | "approximate_citation"
  | "low_extraction_confidence"
  | "ambiguous_scope"
  | "possible_contradiction"
  | "undefined_term";

export type ReingestionDiffCategory =
  | "added"
  | "changed"
  | "removed"
  | "unchanged";

export type AggregationPeriod =
  | "per_transaction"
  | "per_day"
  | "per_trip"
  | "per_night"
  | "per_attendee";

export type RuleOriginType = "extracted" | "manual";

export interface RuleOrigin {
  source_type: RuleOriginType;
  extraction_run_id: string | null;
  rationale: string | null;
}

export interface Citation {
  document_id: string;
  document_version_id: string;
  section_id: string;
  quote: string;
  start_char: number;
  end_char: number;
}

export interface Scope {
  country: string | null;
  expense_category: string | null;
  travel_type: string | null;
  employee_group: string | null;
  effective_start_date: string | null;
  effective_end_date: string | null;
}

export interface Applicability {
  aggregation_period: AggregationPeriod;
  unit: string;
  currency: string | null;
  limit_basis: string | null;
}

export interface RuleException {
  description: string;
  required_evidence: string[];
}

export interface RuleCondition {
  field: string;
  operator: string;
  value: string;
}

export interface QAFlag {
  code: QAFlagCode;
  detail: string;
}

export interface CandidateRuleValue {
  rule_id: string;
  statement: string;
  enforceability_class: EnforceabilityClass;
  lifecycle_state: LifecycleState;
  origin: RuleOrigin;
  scope: Scope;
  citation: Citation | null;
  condition: RuleCondition | null;
  applicability: Applicability | null;
  exceptions: RuleException[];
}

export interface Rule extends CandidateRuleValue {}

export interface ManualRuleCreateRequest {
  rule_id: string;
  statement: string;
  enforceability_class: EnforceabilityClass;
  rationale: string;
  scope: Scope;
  citation?: Citation;
  condition?: RuleCondition;
  applicability?: Applicability;
  exceptions: RuleException[];
}
