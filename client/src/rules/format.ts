import type { EnforceabilityClass, LifecycleState } from "./types";

export function formatEnforceabilityClass(value: EnforceabilityClass): string {
  switch (value) {
    case "enforceable":
      return "Enforceable";
    case "guidance":
      return "Guidance";
    case "subjective":
      return "Subjective";
  }
}

export function formatLifecycleState(value: LifecycleState): string {
  switch (value) {
    case "extracted":
      return "Extracted";
    case "in_review":
      return "In review";
    case "approved":
      return "Approved";
    case "published":
      return "Published";
    case "rejected":
      return "Rejected";
    case "withdrawn":
      return "Withdrawn";
    case "superseded":
      return "Superseded";
  }
}
