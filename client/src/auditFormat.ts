import { ApiError } from "./api";
import { formatPinningLabel, shortenId } from "./extractionRunFormat";
import type { AuditEvent, AuditEventFilters } from "./types";

export const AUDIT_ENTITY_TYPE_OPTIONS = [
  { value: "", label: "All entity types" },
  { value: "candidate_rule", label: "Candidate Rule" },
  { value: "document_version", label: "Document Version" },
  { value: "extraction_run", label: "Extraction Run" },
  { value: "policy_version", label: "Policy Version" },
  { value: "rule", label: "Rule" },
] as const;

const ENTITY_LABELS: Record<string, string> = {
  candidate_rule: "Candidate Rule",
  document_version: "Document Version",
  extraction_run: "Extraction Run",
  policy_version: "Policy Version",
  rule: "Rule",
};

export function formatAuditTimestamp(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function formatAuditEntityType(entityType: string): string {
  return (
    ENTITY_LABELS[entityType] ??
    entityType
      .split("_")
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(" ")
  );
}

export function formatAuditAction(action: string): string {
  const [, verb = action] = action.split(".");
  return verb
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function describeAuditError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    if (error instanceof Error) {
      return error.message;
    }
    return "Unable to load audit events.";
  }

  if (error.status === 401) {
    return "Sign in to browse audit events.";
  }
  if (error.status === 403) {
    return "Your role cannot access the audit trail.";
  }

  return error.message || "Unable to load audit events.";
}

export function summarizeAuditPayload(event: AuditEvent): string {
  const payload = event.payload;

  if (typeof payload.rationale === "string" && payload.rationale) {
    return payload.rationale;
  }
  if (typeof payload.reason === "string" && payload.reason) {
    return payload.reason;
  }
  if (typeof payload.change_summary === "string" && payload.change_summary) {
    return payload.change_summary;
  }
  if (typeof payload.failure_detail === "string" && payload.failure_detail) {
    return payload.failure_detail;
  }

  if (Array.isArray(payload.fields) && payload.fields.length > 0) {
    const editedFields = payload.fields.filter(
      (field): field is string => typeof field === "string" && field.length > 0,
    );
    const nextState =
      typeof payload.to_lifecycle_state === "string"
        ? ` · ${payload.to_lifecycle_state.replaceAll("_", " ")}`
        : "";
    if (editedFields.length > 0) {
      return `Edited ${editedFields.join(", ")}${nextState}`;
    }
  }

  const parts: string[] = [];

  if (typeof payload.document_id === "string" && payload.document_id) {
    parts.push(payload.document_id);
  }
  if (typeof payload.filename === "string" && payload.filename) {
    parts.push(payload.filename);
  }
  if (
    typeof payload.prompt_template_id === "string" &&
    typeof payload.prompt_template_version === "string"
  ) {
    parts.push(
      `Prompt ${formatPinningLabel(
        payload.prompt_template_id,
        payload.prompt_template_version,
      )}`,
    );
  }
  if (
    typeof payload.model_configuration_id === "string" &&
    typeof payload.model_configuration_version === "string"
  ) {
    parts.push(
      `Model ${formatPinningLabel(
        payload.model_configuration_id,
        payload.model_configuration_version,
      )}`,
    );
  }
  if (typeof payload.document_version_id === "string" && payload.document_version_id) {
    parts.push(`Version ${shortenId(payload.document_version_id)}`);
  }
  if (typeof payload.rule_count === "number") {
    parts.push(`${payload.rule_count} Rule${payload.rule_count === 1 ? "" : "s"}`);
  }
  if (typeof payload.candidate_rule_count === "number") {
    parts.push(
      `${payload.candidate_rule_count} Candidate Rule${payload.candidate_rule_count === 1 ? "" : "s"}`,
    );
  }
  if (typeof payload.origin === "string") {
    parts.push(`Origin ${payload.origin}`);
  }
  if (typeof payload.has_citation === "boolean") {
    parts.push(payload.has_citation ? "Citation attached" : "No Citation");
  }

  if (parts.length > 0) {
    return parts.join(" · ");
  }

  return "No additional payload detail recorded.";
}

export function resolveAuditEmptyMessage(filters: AuditEventFilters): string {
  if (filters.entityType || filters.entityId) {
    return "No audit events match the current scope.";
  }
  return "No audit events have been recorded yet.";
}

export function resolveAuditEmptyHint(filters: AuditEventFilters): string {
  if (filters.entityType || filters.entityId) {
    return "Clear the scope or adjust the entity filters if you expected a matching event.";
  }
  return "Events appear here after uploads, review decisions, Manual Rules, and Policy Version publication.";
}
