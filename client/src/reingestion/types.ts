import type { DocumentVersion } from "../policy-documents/types";
import type { ExtractionExecutionResult } from "../extraction-runs/types";

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
