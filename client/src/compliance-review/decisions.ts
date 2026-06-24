import { resolveComplianceReview } from "./api";
import type { ComplianceReviewResolutionType } from "./types";
import { hasAnyRole } from "../shared/permissions";
import type { AuthenticatedPrincipal, Role } from "../shared/auth/types";

export const COMPLIANCE_REVIEW_RESOLVER_ROLES: readonly Role[] = ["approver"];

export const RESOLUTION_TYPE_OPTIONS: {
  value: ComplianceReviewResolutionType;
  label: string;
  description: string;
}[] = [
  {
    value: "upheld",
    label: "Uphold",
    description: "Confirm the automated Evaluation Outcome stands.",
  },
  {
    value: "overridden_pass",
    label: "Override to pass",
    description: "Accept the expense row despite the flagged outcome.",
  },
  {
    value: "escalated",
    label: "Escalate",
    description: "Send the item upstream for further review.",
  },
];

export function canResolveComplianceReviews(
  principal: AuthenticatedPrincipal,
): boolean {
  return hasAnyRole(principal, COMPLIANCE_REVIEW_RESOLVER_ROLES);
}

export function validateResolutionRationale(rationale: string): string | null {
  if (!rationale.trim()) {
    return "Rationale is required.";
  }
  return null;
}

export function formatResolutionType(
  resolutionType: ComplianceReviewResolutionType,
): string {
  const option = RESOLUTION_TYPE_OPTIONS.find(
    (entry) => entry.value === resolutionType,
  );
  return option?.label ?? resolutionType;
}

export async function submitComplianceReviewDecision(
  complianceReviewId: string,
  resolutionType: ComplianceReviewResolutionType,
  rationale: string,
) {
  const response = await resolveComplianceReview(complianceReviewId, {
    resolution_type: resolutionType,
    rationale: rationale.trim(),
  });
  return response.decision;
}
