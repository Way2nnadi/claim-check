import type { AuditEvent, AuditEventFilters } from "./types";
import { shortenId } from "../shared/format/common";
import { ApiError } from "../shared/api/client";
import { formatPinningLabel } from "../extraction-runs/format";

export const AUDIT_ENTITY_TYPE_OPTIONS = [
  { value: "", label: "All entity types" },
  { value: "candidate_rule", label: "Candidate Rule" },
  { value: "compliance_evaluation_run", label: "Compliance Evaluation Run" },
  { value: "compliance_review", label: "Compliance Review" },
  { value: "document_version", label: "Document Version" },
  { value: "expense_report", label: "Expense Report" },
  { value: "extraction_run", label: "Extraction Run" },
  { value: "policy_version", label: "Policy Version" },
  { value: "rule", label: "Rule" },
  { value: "rule_test_case", label: "Rule Test Case" },
] as const;

const ENTITY_LABELS: Record<string, string> = {
  candidate_rule: "Candidate Rule",
  compliance_evaluation_run: "Compliance Evaluation Run",
  compliance_review: "Compliance Review",
  document_version: "Document Version",
  expense_report: "Expense Report",
  extraction_run: "Extraction Run",
  policy_version: "Policy Version",
  rule: "Rule",
  rule_test_case: "Rule Test Case",
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
  if (typeof payload.resolution_type === "string" && payload.resolution_type) {
    parts.push(payload.resolution_type.replaceAll("_", " "));
  }
  if (typeof payload.compliance_evaluation_run_id === "string") {
    parts.push(`Run ${shortenId(payload.compliance_evaluation_run_id)}`);
  }
  if (typeof payload.expense_report_id === "string") {
    parts.push(`Report ${shortenId(payload.expense_report_id)}`);
  }
  if (typeof payload.employee_id === "string" && payload.employee_id) {
    parts.push(`Employee ${payload.employee_id}`);
  }
  if (typeof payload.expense_date === "string" && payload.expense_date) {
    parts.push(`Date ${payload.expense_date}`);
  }
  if (typeof payload.row_index === "number") {
    parts.push(`Row ${payload.row_index}`);
  }
  if (
    typeof payload.expense_input_fingerprint === "object" &&
    payload.expense_input_fingerprint !== null &&
    typeof (payload.expense_input_fingerprint as { content_hash?: unknown }).content_hash ===
      "string"
  ) {
    const fingerprint = payload.expense_input_fingerprint as {
      source_filename?: string;
      content_hash?: string;
    };
    if (fingerprint.source_filename) {
      parts.push(fingerprint.source_filename);
    }
    if (fingerprint.content_hash) {
      parts.push(`Hash ${shortenId(fingerprint.content_hash, 12)}`);
    }
  }
  if (typeof payload.policy_version_id === "string") {
    parts.push(`Policy ${shortenId(payload.policy_version_id)}`);
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
  if (
    filters.entityType ||
    filters.entityId ||
    filters.complianceEvaluationRunId ||
    filters.employeeId ||
    filters.expenseDate ||
    filters.rowIndex !== undefined
  ) {
    return "No audit events match the current scope.";
  }
  return "No audit events have been recorded yet.";
}

export function resolveAuditEmptyHint(filters: AuditEventFilters): string {
  if (
    filters.entityType ||
    filters.entityId ||
    filters.complianceEvaluationRunId ||
    filters.employeeId ||
    filters.expenseDate ||
    filters.rowIndex !== undefined
  ) {
    return "Clear the scope or adjust the entity filters if you expected a matching event.";
  }
  return "Events appear here after uploads, review decisions, compliance runs, and Policy Version publication.";
}
