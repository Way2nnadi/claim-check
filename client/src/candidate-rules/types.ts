import type {
  Applicability,
  CandidateRuleValue,
  EnforceabilityClass,
  LifecycleState,
  QAFlag,
  ReingestionDiffCategory,
  RuleCondition,
  RuleException,
  Scope,
} from "../rules/types";

export interface CandidateRuleReview {
  candidate_rule_id: string;
  lifecycle_state: LifecycleState;
  current_rule: CandidateRuleValue;
  extracted_rule: CandidateRuleValue;
  committed_rule: CandidateRuleValue | null;
  qa_flags: QAFlag[];
  reingestion_diff_category?: ReingestionDiffCategory | null;
}

export interface CandidateRuleReviewListResponse {
  items: CandidateRuleReview[];
}

export interface CandidateRuleFilters {
  lifecycleStates?: LifecycleState[];
  documentId?: string;
  documentVersionId?: string;
  extractionRunId?: string;
}

export interface CandidateRuleReviewUpdateRequest {
  statement?: string;
  enforceability_class?: EnforceabilityClass;
  scope?: Scope;
  condition?: RuleCondition | null;
  applicability?: Applicability | null;
  exceptions?: RuleException[];
}

export interface CandidateRuleApprovalRequest {
  rationale: string;
}

export interface CandidateRuleApprovalResponse {
  candidate_rule_id: string;
  status: string;
  recorded_by: string;
}

export interface BulkCandidateRuleApprovalRequest {
  candidate_rule_ids: string[];
  rationale: string;
}

export interface BulkCandidateRuleApprovalFailure {
  candidate_rule_id: string;
  detail: string;
}

export interface BulkCandidateRuleApprovalResponse {
  approved_candidate_rule_ids: string[];
  failed_candidate_rules: BulkCandidateRuleApprovalFailure[];
  status: string;
  recorded_by: string;
}

export interface CandidateRuleRejectionRequest {
  reason: string;
}

export interface CandidateRuleRejectionResponse {
  candidate_rule_id: string;
  status: string;
  recorded_by: string;
}
