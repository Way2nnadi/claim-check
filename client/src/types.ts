export type Role = "admin" | "approver" | "viewer";

export interface AuthenticatedPrincipal {
  subject: string;
  roles: Role[];
  auth_backend: string;
}

export interface PolicyDocumentSummary {
  document_id: string;
  latest_document_version_id: string;
  latest_uploaded_at: string;
  version_count: number;
  active_version_count: number;
  has_deleted_versions: boolean;
}

export interface PolicyDocumentListResponse {
  items: PolicyDocumentSummary[];
}

export interface DocumentVersion {
  document_id: string;
  document_version_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  deleted_at: string | null;
  deletion_reason: string | null;
}

export interface DocumentVersionListResponse {
  items: DocumentVersion[];
}

export interface DocumentSection {
  document_id: string;
  document_version_id: string;
  section_id: string;
  heading_path: string[];
  content: string;
  start_char: number;
  end_char: number;
}

export interface DocumentSectionListResponse {
  items: DocumentSection[];
}

export type ExtractionRunStatus = "completed" | "failed";

export interface ExtractionRun {
  extraction_run_id: string;
  document_id: string;
  document_version_id: string;
  prompt_template_id: string;
  prompt_template_version: string;
  model_configuration_id: string;
  model_configuration_version: string;
  candidate_rule_count: number;
  created_at: string;
  status: ExtractionRunStatus;
  failure_detail: string | null;
}

export interface ExtractionRunListResponse {
  items: ExtractionRun[];
}

export interface ExtractionRunFilters {
  documentId?: string;
  documentVersionId?: string;
}

export interface PromptTemplateSummary {
  prompt_template_id: string;
  version: string;
  description: string | null;
}

export interface PromptTemplateListResponse {
  items: PromptTemplateSummary[];
}

export interface ModelConfigurationSummary {
  model_configuration_id: string;
  version: string;
  model: string;
}

export interface ModelConfigurationListResponse {
  items: ModelConfigurationSummary[];
}

export interface ExtractionRunCreateRequest {
  extraction_run_id: string;
  prompt_template_id: string;
  prompt_template_version: string;
  model_configuration_id: string;
  model_configuration_version: string;
}

export interface ExtractionExecutionResult {
  extraction_run_id: string;
  document_version_id: string;
  prompt_template_id: string;
  prompt_template_version: string;
  model_configuration_id: string;
  model_configuration_version: string;
  attempt_count: number;
  candidate_rules: unknown[];
}

export interface PolicyVersionDiff {
  baseline_policy_version_id: string | null;
  added: unknown[];
  changed: unknown[];
  removed: unknown[];
  unchanged: unknown[];
}

export interface ReingestionRequest {
  extraction_run_id: string;
  prompt_template_id: string;
  prompt_template_version: string;
  model_configuration_id: string;
  model_configuration_version: string;
}

export interface ReingestionResult {
  document_version: DocumentVersion;
  extraction_run: ExtractionExecutionResult;
  diff: PolicyVersionDiff;
}

export interface PolicyVersionSummary {
  policy_version_id: string;
  published_by: string;
  change_summary: string;
  rule_count: number;
  created_at: string;
}

export interface PolicyVersionListResponse {
  items: PolicyVersionSummary[];
}

export interface PolicyVersionPublishRequest {
  policy_version_id: string;
  change_summary: string;
}

export interface PolicyVersionPublishResponse {
  policy_version_id: string;
  rule_count: number;
  status: string;
  published_by: string;
}

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

export interface PolicyVersionSnapshot {
  policy_version_id: string;
  change_summary: string;
  published_by: string;
  rules: Rule[];
}

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

export interface CandidateRuleReview {
  candidate_rule_id: string;
  lifecycle_state: LifecycleState;
  current_rule: CandidateRuleValue;
  extracted_rule: CandidateRuleValue;
  committed_rule: CandidateRuleValue | null;
  qa_flags: QAFlag[];
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

export interface CandidateRuleRejectionRequest {
  reason: string;
}

export interface CandidateRuleRejectionResponse {
  candidate_rule_id: string;
  status: string;
  recorded_by: string;
}
