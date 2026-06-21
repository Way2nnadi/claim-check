import { ApiError } from "./api";
import type { CandidateRuleReview, EnforceabilityClass, LifecycleState, QAFlagCode } from "./types";

const CANDIDATE_RULE_ERROR_FALLBACK = "Unable to load Candidate Rules.";

export const REVIEW_QUEUE_LIFECYCLE_STATES: readonly LifecycleState[] = [
  "extracted",
  "in_review",
];

export const ALL_LIFECYCLE_STATES: readonly LifecycleState[] = [
  "extracted",
  "in_review",
  "approved",
  "published",
  "rejected",
  "withdrawn",
  "superseded",
];

export type LifecycleTabId =
  | "queue"
  | "flagged"
  | "approved"
  | "published"
  | "closed"
  | "all"
  | "custom";

export const LIFECYCLE_TABS: { id: LifecycleTabId; label: string }[] = [
  { id: "queue", label: "Queue" },
  { id: "flagged", label: "Flagged" },
  { id: "approved", label: "Approved" },
  { id: "published", label: "Published" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
  { id: "custom", label: "Custom" },
];

export function lifecycleStatesForTab(
  tab: LifecycleTabId,
  customSelection: readonly LifecycleState[] = REVIEW_QUEUE_LIFECYCLE_STATES,
): LifecycleState[] | undefined {
  switch (tab) {
    case "queue":
    case "flagged":
      return [...REVIEW_QUEUE_LIFECYCLE_STATES];
    case "approved":
      return ["approved"];
    case "published":
      return ["published"];
    case "closed":
      return ["rejected", "withdrawn", "superseded"];
    case "all":
      return undefined;
    case "custom": {
      if (customSelection.length === 0 || customSelection.length === ALL_LIFECYCLE_STATES.length) {
        return undefined;
      }
      return [...customSelection];
    }
  }
}

export function filterReviewsForTab(
  reviews: readonly CandidateRuleReview[],
  tab: LifecycleTabId,
  customSelection: readonly LifecycleState[] = REVIEW_QUEUE_LIFECYCLE_STATES,
): CandidateRuleReview[] {
  if (tab === "flagged") {
    return reviews.filter(
      (review) =>
        REVIEW_QUEUE_LIFECYCLE_STATES.includes(review.lifecycle_state) &&
        review.qa_flags.length > 0,
    );
  }

  const states = lifecycleStatesForTab(tab, customSelection);
  if (states === undefined) {
    return [...reviews];
  }

  return reviews.filter((review) => states.includes(review.lifecycle_state));
}

export function emptyMessageForLifecycleTab(
  tab: LifecycleTabId,
  hasNonDefaultFilters: boolean,
): string {
  if (hasNonDefaultFilters) {
    return "No Candidate Rules match the current filters.";
  }

  switch (tab) {
    case "queue":
      return "The review queue is empty — no extracted Rules are waiting for triage.";
    case "flagged":
      return "No flagged Candidate Rules in the current scope.";
    case "approved":
      return "No approved Candidate Rules are waiting to publish.";
    case "published":
      return "No Candidate Rules have been published yet.";
    case "closed":
      return "No rejected, withdrawn, or superseded Candidate Rules.";
    case "all":
      return "No Candidate Rules found.";
    case "custom":
      return "No Candidate Rules match the selected lifecycle states.";
  }
}

export function showEmptyStateHint(tab: LifecycleTabId): boolean {
  return tab === "queue" || tab === "all" || tab === "flagged";
}

export function isDefaultCustomSelection(selection: readonly LifecycleState[]): boolean {
  if (selection.length !== REVIEW_QUEUE_LIFECYCLE_STATES.length) {
    return false;
  }
  return REVIEW_QUEUE_LIFECYCLE_STATES.every((state) => selection.includes(state));
}

export function formatLifecycleState(state: LifecycleState): string {
  if (state === "in_review") {
    return "In review";
  }
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export function formatEnforceabilityClass(value: EnforceabilityClass): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatQAFlagCode(code: QAFlagCode): string {
  return code
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export type QAFlagDomain =
  | "citation"
  | "extraction"
  | "structure"
  | "scope"
  | "semantics";

const QA_FLAG_DOMAINS: Record<QAFlagCode, QAFlagDomain> = {
  unresolvable_citation: "citation",
  approximate_citation: "citation",
  low_extraction_confidence: "extraction",
  missing_threshold: "structure",
  missing_applicability: "structure",
  invalid_enum: "structure",
  ambiguous_scope: "scope",
  possible_contradiction: "semantics",
  undefined_term: "semantics",
};

export function qaFlagDomain(code: QAFlagCode): QAFlagDomain {
  return QA_FLAG_DOMAINS[code];
}

export function formatQAFlagDomain(domain: QAFlagDomain): string {
  switch (domain) {
    case "citation":
      return "Citation fidelity";
    case "extraction":
      return "Extraction confidence";
    case "structure":
      return "Rule structure";
    case "scope":
      return "Scope clarity";
    case "semantics":
      return "Semantic consistency";
  }
}

export function formatScopeField(label: string, value: string | null): string | null {
  if (!value) {
    return null;
  }
  return `${label}: ${value}`;
}

export function lifecycleStateClassName(state: LifecycleState): string {
  if (state === "extracted") {
    return "extracted";
  }
  if (state === "in_review") {
    return "in-review";
  }
  if (state === "approved" || state === "published") {
    return "approved";
  }
  if (state === "rejected" || state === "withdrawn" || state === "superseded") {
    return "closed";
  }
  return "neutral";
}

export function enforceabilityClassName(value: EnforceabilityClass): string {
  return value;
}

export function describeCandidateRuleError(error: unknown, fallback = CANDIDATE_RULE_ERROR_FALLBACK): string {
  if (!(error instanceof ApiError)) {
    if (error instanceof Error) {
      return error.message;
    }
    return fallback;
  }

  const { message, status } = error;

  if (status === 401) {
    return "Sign in to browse the Candidate Rule review queue.";
  }
  if (status === 403) {
    return "Your role cannot access Candidate Rules.";
  }
  if (status === 404) {
    return "Candidate Rule was not found.";
  }

  return message || fallback;
}

export function truncateStatement(statement: string, maxLength = 140): string {
  if (statement.length <= maxLength) {
    return statement;
  }
  return `${statement.slice(0, maxLength - 1).trimEnd()}…`;
}
