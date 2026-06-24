import { apiRequest } from "../shared/api/client";
import type {
  ComplianceReviewDecision,
  ComplianceReviewDecisionRequest,
  ComplianceReviewDetail,
  ComplianceReviewListResponse,
  ComplianceReviewOutcomeFilter,
  ComplianceReviewResolutionType,
} from "./types";
import type { ComplianceOutcome } from "../compliance-evaluation-runs/types";

export interface FetchComplianceReviewsOptions {
  complianceEvaluationRunId?: string | null;
  includeViolations?: boolean;
  outcome?: ComplianceReviewOutcomeFilter;
}

export function fetchComplianceReviews(
  options: FetchComplianceReviewsOptions = {},
): Promise<ComplianceReviewListResponse> {
  const params = new URLSearchParams();
  if (options.complianceEvaluationRunId) {
    params.set(
      "compliance_evaluation_run_id",
      options.complianceEvaluationRunId,
    );
  }
  if (options.includeViolations === false) {
    params.set("include_violations", "false");
  }
  if (options.outcome && options.outcome !== "all") {
    params.set("outcome", options.outcome);
  }
  const query = params.toString();
  return apiRequest<ComplianceReviewListResponse>(
    `/api/compliance-reviews${query ? `?${query}` : ""}`,
  );
}

export function fetchComplianceReview(
  complianceReviewId: string,
): Promise<ComplianceReviewDetail> {
  return apiRequest<ComplianceReviewDetail>(
    `/api/compliance-reviews/${encodeURIComponent(complianceReviewId)}`,
  );
}

export function resolveComplianceReview(
  complianceReviewId: string,
  request: ComplianceReviewDecisionRequest,
): Promise<{ decision: ComplianceReviewDecision }> {
  return apiRequest<{ decision: ComplianceReviewDecision }>(
    `/api/compliance-reviews/${encodeURIComponent(complianceReviewId)}/decisions`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}

export type {
  ComplianceOutcome,
  ComplianceReviewDecision,
  ComplianceReviewDecisionRequest,
  ComplianceReviewResolutionType,
};
