import { ApiError } from "./api";
import type { EnforceabilityClass, LifecycleState, QAFlagCode } from "./types";

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
