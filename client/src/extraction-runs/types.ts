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
