import type { ExtractionExecutionResult, ExtractionRunCreateRequest, ExtractionRunFilters, ExtractionRunListResponse, ModelConfigurationListResponse, PromptTemplateListResponse } from "./types";
import { apiRequest } from "../shared/api/client";

function buildExtractionRunQuery(filters: ExtractionRunFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.documentId) {
    params.set("document_id", filters.documentId);
  }
  if (filters.documentVersionId) {
    params.set("document_version_id", filters.documentVersionId);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function fetchExtractionRuns(
  filters: ExtractionRunFilters = {},
): Promise<ExtractionRunListResponse> {
  return apiRequest<ExtractionRunListResponse>(
    `/api/extraction-runs${buildExtractionRunQuery(filters)}`,
  );
}

export function fetchDocumentVersionExtractionRuns(
  documentId: string,
  documentVersionId: string,
): Promise<ExtractionRunListResponse> {
  return apiRequest<ExtractionRunListResponse>(
    `/api/policy-documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(documentVersionId)}/extraction-runs`,
  );
}

export function fetchPromptTemplates(): Promise<PromptTemplateListResponse> {
  return apiRequest<PromptTemplateListResponse>("/api/prompt-templates");
}

export function fetchModelConfigurations(): Promise<ModelConfigurationListResponse> {
  return apiRequest<ModelConfigurationListResponse>("/api/model-configurations");
}

export function createExtractionRun(
  documentId: string,
  documentVersionId: string,
  request: ExtractionRunCreateRequest,
): Promise<ExtractionExecutionResult> {
  return apiRequest<ExtractionExecutionResult>(
    `/api/policy-documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(documentVersionId)}/extraction-runs`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}
