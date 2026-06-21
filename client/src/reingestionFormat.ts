import { ApiError } from "./api";
import type { PolicyVersionDiff } from "./types";

const REINGESTION_ERROR_FALLBACK = "Re-ingestion could not be completed.";

export function describeReingestionError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    if (error instanceof Error) {
      return error.message;
    }
    return REINGESTION_ERROR_FALLBACK;
  }

  const { message, status } = error;

  if (status === 401) {
    return "Sign in as an admin to re-ingest Policy Documents.";
  }
  if (status === 403) {
    return "Only admins can re-ingest Policy Documents.";
  }
  if (status === 409) {
    return "An Extraction Run with this id already exists. Choose a different run id.";
  }
  if (status === 404) {
    return "Policy Document was not found.";
  }
  if (status === 410) {
    return "Cannot re-ingest against an archived Document Version.";
  }
  if (status === 422) {
    return message || "Quality gate or extraction validation failed.";
  }

  return message || REINGESTION_ERROR_FALLBACK;
}

export function defaultReingestionRunId(documentId: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
  return `reingest-${documentId}-${stamp}`;
}

export interface DiffCountSummary {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  total: number;
}

export function summarizeDiffCounts(diff: PolicyVersionDiff): DiffCountSummary {
  const added = diff.added.length;
  const changed = diff.changed.length;
  const removed = diff.removed.length;
  const unchanged = diff.unchanged.length;
  return {
    added,
    changed,
    removed,
    unchanged,
    total: added + changed + removed + unchanged,
  };
}

export function describeBaselinePolicyVersion(baselineId: string | null): string {
  if (!baselineId) {
    return "No published Policy Version exists yet — every extracted Rule counts as added.";
  }
  return `Compared against ${baselineId}.`;
}
