import type { BulkCandidateRuleApprovalRequest, BulkCandidateRuleApprovalResponse, CandidateRuleApprovalRequest, CandidateRuleApprovalResponse, CandidateRuleFilters, CandidateRuleRejectionRequest, CandidateRuleRejectionResponse, CandidateRuleReview, CandidateRuleReviewListResponse, CandidateRuleReviewUpdateRequest } from "./types";
import { apiRequest } from "../shared/api/client";

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

export function approveCandidateRule(
  candidateRuleId: string,
  request: CandidateRuleApprovalRequest,
): Promise<CandidateRuleApprovalResponse> {
  return apiRequest<CandidateRuleApprovalResponse>(
    `/api/candidate-rules/${encodeURIComponent(candidateRuleId)}/approvals`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}

export function approveCandidateRulesBulk(
  request: BulkCandidateRuleApprovalRequest,
): Promise<BulkCandidateRuleApprovalResponse> {
  return apiRequest<BulkCandidateRuleApprovalResponse>(
    "/api/candidate-rules/approvals/bulk",
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}

export function rejectCandidateRule(
  candidateRuleId: string,
  request: CandidateRuleRejectionRequest,
): Promise<CandidateRuleRejectionResponse> {
  return apiRequest<CandidateRuleRejectionResponse>(
    `/api/candidate-rules/${encodeURIComponent(candidateRuleId)}/rejections`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}
