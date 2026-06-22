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
  | "archive"
  | "approved"
  | "published"
  | "closed"
  | "all"
  | "custom";

export const PRIMARY_REVIEW_TABS: { id: LifecycleTabId; label: string }[] = [
  { id: "queue", label: "Queue" },
  { id: "flagged", label: "Flagged" },
  { id: "archive", label: "Archive" },
  { id: "all", label: "All" },
];

/** @deprecated Use PRIMARY_REVIEW_TABS for visible navigation. */
export const LIFECYCLE_TABS = PRIMARY_REVIEW_TABS;

export function lifecycleStatesForTab(
  tab: LifecycleTabId,
  customSelection: readonly LifecycleState[] = REVIEW_QUEUE_LIFECYCLE_STATES,
): LifecycleState[] | undefined {
  switch (tab) {
    case "queue":
    case "flagged":
      return [...REVIEW_QUEUE_LIFECYCLE_STATES];
    case "archive":
      return ["approved", "published", "rejected", "withdrawn", "superseded"];
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
    case "archive":
      return "No approved, published, or closed Candidate Rules in this scope.";
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
  return tab === "queue" || tab === "all" || tab === "flagged" || tab === "archive";
}

export function countActiveReviewFilters(
  scopeFilterCount: number,
  lifecycleTab: LifecycleTabId,
  customSelection: readonly LifecycleState[],
): number {
  let count = scopeFilterCount;
  if (lifecycleTab === "all") {
    count += 1;
  } else if (lifecycleTab === "custom" && !isDefaultCustomSelection(customSelection)) {
    count += 1;
  }
  return count;
}

export interface ReviewEmptyContext {
  lifecycleTab: LifecycleTabId;
  reviews: readonly CandidateRuleReview[];
  displayedReviews: readonly CandidateRuleReview[];
  scopeFilterCount: number;
  extractionRunId: string | null;
  hasNonDefaultLifecycleFilters: boolean;
}

export function resolveReviewEmptyMessage(context: ReviewEmptyContext): string {
  const {
    lifecycleTab,
    reviews,
    displayedReviews,
    scopeFilterCount,
    extractionRunId,
    hasNonDefaultLifecycleFilters,
  } = context;

  if (scopeFilterCount > 0) {
    return "No Candidate Rules match the current scope filters.";
  }

  if (extractionRunId && reviews.length === 0) {
    return "This Extraction Run produced no Candidate Rules.";
  }

  if (reviews.length > 0 && displayedReviews.length === 0) {
    if (lifecycleTab === "queue") {
      return "No Candidate Rules are waiting in the queue for this scope.";
    }
    return emptyMessageForLifecycleTab(lifecycleTab, hasNonDefaultLifecycleFilters);
  }

  return emptyMessageForLifecycleTab(lifecycleTab, hasNonDefaultLifecycleFilters);
}

export function resolveReviewEmptyHint(context: ReviewEmptyContext): string | null {
  if (!showEmptyStateHint(context.lifecycleTab)) {
    return null;
  }

  if (context.reviews.length > 0 && context.displayedReviews.length === 0) {
    return "Rules exist in this scope under other lifecycle tabs — try All to see them.";
  }

  if (context.scopeFilterCount > 0 || context.extractionRunId) {
    return "Adjust scope filters or choose Show all rules if you expected to see pending work.";
  }

  return "Extracted Rules appear here after an Extraction Run completes.";
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
