import type {
  AuthenticatedPrincipal,
  CandidateRuleFilters,
  CandidateRuleReview,
  CandidateRuleReviewListResponse,
  CandidateRuleReviewUpdateRequest,
  DocumentSectionListResponse,
  DocumentVersion,
  DocumentVersionListResponse,
  ExtractionExecutionResult,
  ExtractionRunCreateRequest,
  ExtractionRunFilters,
  ExtractionRunListResponse,
  ManualRuleCreateRequest,
  ModelConfigurationListResponse,
  PolicyVersionListResponse,
  PolicyVersionPublishRequest,
  PolicyVersionPublishResponse,
  PolicyVersionSnapshot,
  PolicyDocumentListResponse,
  PromptTemplateListResponse,
  ReingestionRequest,
  ReingestionResult,
  Rule,
} from "./types";

export const SESSION_STORAGE_TOKEN_KEY = "policy-pipeline.auth.token";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getStoredToken(): string | null {
  return window.sessionStorage.getItem(SESSION_STORAGE_TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  window.sessionStorage.removeItem(SESSION_STORAGE_TOKEN_KEY);
}

function shouldSetJsonContentType(body: BodyInit | null | undefined): body is string {
  return typeof body === "string";
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  token: string | null = getStoredToken(),
): Promise<T> {
  const headers = new Headers(init.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (shouldSetJsonContentType(init.body) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }

  return (await response.json()) as T;
}

async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let detail = `Request failed with status ${response.status}.`;
  try {
    const payload = (await response.json()) as {
      detail?: string | Array<{ loc?: Array<string | number>; msg?: string }>;
    };
    if (typeof payload.detail === "string" && payload.detail) {
      detail = payload.detail;
    } else if (Array.isArray(payload.detail) && payload.detail.length > 0) {
      detail = payload.detail
        .map((item) => {
          const message = item.msg?.replace(/^Value error,\s*/u, "").trim();
          const path = item.loc
            ?.filter((segment) => segment !== "body")
            .join(".");
          if (path && message) {
            return `${path}: ${message}`;
          }
          return message || detail;
        })
        .join(" ");
    }
  } catch {
    // Leave the default error message when the response is not JSON.
  }
  return new ApiError(detail, response.status);
}

export function fetchMe(token: string): Promise<AuthenticatedPrincipal> {
  return apiRequest<AuthenticatedPrincipal>("/api/me", { method: "GET" }, token);
}

export function fetchPolicyVersions(): Promise<PolicyVersionListResponse> {
  return apiRequest<PolicyVersionListResponse>("/api/policy-versions");
}

export function fetchPolicyVersion(
  policyVersionId: string,
): Promise<PolicyVersionSnapshot> {
  return apiRequest<PolicyVersionSnapshot>(
    `/api/policy-versions/${encodeURIComponent(policyVersionId)}`,
  );
}

export function publishPolicyVersion(
  request: PolicyVersionPublishRequest,
): Promise<PolicyVersionPublishResponse> {
  return apiRequest<PolicyVersionPublishResponse>("/api/policy-versions", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function createManualRule(request: ManualRuleCreateRequest): Promise<Rule> {
  return apiRequest<Rule>("/api/rules/manual", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function fetchPolicyDocuments(
  includeDeleted = false,
): Promise<PolicyDocumentListResponse> {
  const params = includeDeleted ? "?include_deleted=true" : "";
  return apiRequest<PolicyDocumentListResponse>(`/api/policy-documents${params}`);
}

export function fetchDocumentVersions(
  documentId: string,
  includeDeleted = false,
): Promise<DocumentVersionListResponse> {
  const params = includeDeleted ? "?include_deleted=true" : "";
  return apiRequest<DocumentVersionListResponse>(
    `/api/policy-documents/${encodeURIComponent(documentId)}/versions${params}`,
  );
}

export function uploadDocumentVersion(
  documentId: string,
  file: File,
): Promise<DocumentVersion> {
  const formData = new FormData();
  formData.append("file", file);
  return apiRequest<DocumentVersion>(
    `/api/policy-documents/${encodeURIComponent(documentId)}/versions`,
    {
      method: "POST",
      body: formData,
    },
  );
}

export function deleteDocumentVersion(
  documentId: string,
  documentVersionId: string,
  reason: string,
): Promise<DocumentVersion> {
  return apiRequest<DocumentVersion>(
    `/api/policy-documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(documentVersionId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ reason }),
    },
  );
}

export async function downloadDocumentVersion(
  documentId: string,
  documentVersionId: string,
  filename: string,
): Promise<void> {
  await downloadAttachment(
    `/api/policy-documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(documentVersionId)}`,
    filename,
  );
}

export async function downloadPolicyVersionSnapshot(
  policyVersionId: string,
): Promise<void> {
  await downloadAttachment(
    `/api/policy-versions/${encodeURIComponent(policyVersionId)}/snapshot`,
    buildSnapshotFilename(policyVersionId),
  );
}

function buildSnapshotFilename(policyVersionId: string): string {
  const safeStem = policyVersionId.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "");
  return `${safeStem || "policy-version"}.json`;
}

async function downloadAttachment(path: string, filename: string): Promise<void> {
  const token = getStoredToken();
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, { headers });

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

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

export function fetchDocumentSections(
  documentId: string,
  documentVersionId: string,
): Promise<DocumentSectionListResponse> {
  return apiRequest<DocumentSectionListResponse>(
    `/api/policy-documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(documentVersionId)}/sections`,
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

function buildCandidateRuleQuery(filters: CandidateRuleFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.lifecycleStates) {
    for (const state of filters.lifecycleStates) {
      params.append("lifecycle_state", state);
    }
  }
  if (filters.documentId) {
    params.set("document_id", filters.documentId);
  }
  if (filters.documentVersionId) {
    params.set("document_version_id", filters.documentVersionId);
  }
  if (filters.extractionRunId) {
    params.set("extraction_run_id", filters.extractionRunId);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function fetchCandidateRules(
  filters: CandidateRuleFilters = {},
): Promise<CandidateRuleReviewListResponse> {
  return apiRequest<CandidateRuleReviewListResponse>(
    `/api/candidate-rules${buildCandidateRuleQuery(filters)}`,
  );
}

export function fetchCandidateRule(candidateRuleId: string): Promise<CandidateRuleReview> {
  return apiRequest<CandidateRuleReview>(
    `/api/candidate-rules/${encodeURIComponent(candidateRuleId)}`,
  );
}

export function updateCandidateRule(
  candidateRuleId: string,
  request: CandidateRuleReviewUpdateRequest,
): Promise<CandidateRuleReview> {
  return apiRequest<CandidateRuleReview>(
    `/api/candidate-rules/${encodeURIComponent(candidateRuleId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(request),
    },
  );
}

export function reingestDocument(
  documentId: string,
  file: File,
  request: ReingestionRequest,
): Promise<ReingestionResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("extraction_run_id", request.extraction_run_id);
  formData.append("prompt_template_id", request.prompt_template_id);
  formData.append("prompt_template_version", request.prompt_template_version);
  formData.append("model_configuration_id", request.model_configuration_id);
  formData.append("model_configuration_version", request.model_configuration_version);
  return apiRequest<ReingestionResult>(
    `/api/policy-documents/${encodeURIComponent(documentId)}/reingestions`,
    {
      method: "POST",
      body: formData,
    },
  );
}
