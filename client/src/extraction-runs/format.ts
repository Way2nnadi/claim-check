import type { ExtractionRunStatus } from "./types";
import { ApiError } from "../shared/api/client";

export function formatExtractionRunStatus(status: ExtractionRunStatus): string {
  if (status === "failed") {
    return "Failed";
  }
  return "Completed";
}

export function formatPinningLabel(id: string, version: string): string {
  return `${id}@${version}`;
}

export function shortenId(value: string, maxLength = 32, visible = 8): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, visible)}…${value.slice(-visible)}`;
}

const EXTRACTION_ERROR_FALLBACK = "Extraction Run could not be started.";

export function describeExtractionTriggerError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    if (error instanceof Error) {
      return error.message;
    }
    return EXTRACTION_ERROR_FALLBACK;
  }

  const { message, status } = error;

  if (status === 401) {
    return "Sign in as an admin to trigger Extraction Runs.";
  }
  if (status === 403) {
    return "Only admins can trigger Extraction Runs.";
  }
  if (status === 409) {
    return "An Extraction Run with this id already exists. Choose a different run id.";
  }
  if (status === 404) {
    return "Document Version was not found.";
  }
  if (status === 410) {
    return "Cannot extract from an archived Document Version.";
  }

  return message || EXTRACTION_ERROR_FALLBACK;
}

export function defaultExtractionRunId(documentVersionId: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
  return `extract-${documentVersionId}-${stamp}`;
}

export function formatRegistryOptionLabel(id: string, version: string, detail?: string | null): string {
  const base = `${id}@${version}`;
  if (detail) {
    return `${base} · ${detail}`;
  }
  return base;
}

export function parseRegistrySelection(value: string): { id: string; version: string } | null {
  const separator = value.indexOf("|");
  if (separator <= 0) {
    return null;
  }
  const id = value.slice(0, separator);
  const version = value.slice(separator + 1);
  if (!id || !version) {
    return null;
  }
  return { id, version };
}

export function formatRegistrySelection(id: string, version: string): string {
  return `${id}|${version}`;
}
