import { ApiError } from "./api";
import {
  formatEnforceabilityClass,
  formatLifecycleState,
} from "./candidateRuleFormat";
import type {
  Applicability,
  PolicyVersionSummary,
  Role,
  Rule,
  Scope,
} from "./types";

export { formatEnforceabilityClass, formatLifecycleState };

export function formatPolicyVersionDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function formatRuleCount(count: number): string {
  return `${count} Rule${count === 1 ? "" : "s"}`;
}

export function describePolicyVersionError(
  error: unknown,
  fallback: string,
): string {
  if (!(error instanceof ApiError)) {
    if (error instanceof Error) {
      return error.message;
    }
    return fallback;
  }

  if (error.status === 401) {
    return "Sign in to browse published Policy Versions.";
  }
  if (error.status === 403) {
    return "Your role cannot access published Policy Versions.";
  }
  if (error.status === 404) {
    return "Policy Version was not found.";
  }

  return error.message || fallback;
}

export function summarizeRuleScope(scope: Scope): string {
  const segments = [
    scope.expense_category,
    scope.travel_type,
    scope.country,
    scope.employee_group,
  ].filter(Boolean);

  if (segments.length === 0) {
    return "Global scope";
  }

  return segments.join(" · ");
}

export function formatEffectiveWindow(scope: Scope): string {
  if (scope.effective_start_date && scope.effective_end_date) {
    return `${scope.effective_start_date} to ${scope.effective_end_date}`;
  }
  if (scope.effective_start_date) {
    return `From ${scope.effective_start_date}`;
  }
  if (scope.effective_end_date) {
    return `Until ${scope.effective_end_date}`;
  }
  return "No effective window";
}

export function summarizeApplicability(applicability: Applicability | null): string {
  if (!applicability) {
    return "Not machine-checkable";
  }

  const pieces = [
    applicability.aggregation_period.replaceAll("_", " "),
    applicability.unit,
    applicability.currency,
    applicability.limit_basis,
  ].filter(Boolean);

  return pieces.join(" · ");
}

export function describeRuleOrigin(rule: Rule): string {
  if (rule.origin.source_type === "manual") {
    return "Manual Rule";
  }
  return `Extracted · ${rule.origin.extraction_run_id}`;
}

export function policyVersionClearanceBlurb(role: Role): string {
  if (role === "viewer") {
    return "Viewer clearance can inspect immutable snapshots and export the signed JSON attachment.";
  }
  if (role === "approver") {
    return "Approver clearance can inspect immutable snapshots before planning the next publication.";
  }
  return "Admin clearance can audit immutable snapshots alongside the broader system ledger.";
}

export function latestPolicyVersionId(
  versions: readonly PolicyVersionSummary[],
): string | null {
  return versions[0]?.policy_version_id ?? null;
}
