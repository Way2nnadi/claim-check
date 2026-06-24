import { ApiError } from "../shared/api/client";
import {
  formatComplianceOutcome,
  complianceOutcomeTone,
} from "../compliance-evaluation-runs/format";
import type { ComplianceReviewQueueItem, ExpenseReportRow } from "./types";
import type { ComplianceOutcome } from "../compliance-evaluation-runs/types";

export { formatComplianceOutcome, complianceOutcomeTone };

export const COMPLIANCE_REVIEW_OUTCOME_TABS: {
  id: ComplianceOutcome | "all";
  label: string;
}[] = [
  { id: "all", label: "All" },
  { id: "violation", label: "Violations" },
  { id: "needs_review", label: "Needs review" },
  { id: "missing_evidence", label: "Missing evidence" },
];

export function describeComplianceReviewError(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return "Compliance Review item was not found.";
    }
    if (error.status === 409) {
      return "Compliance Review item was already resolved.";
    }
    if (error.status === 422) {
      return "Resolution rationale is required.";
    }
    if (error.status === 500) {
      return "Compliance Review queue failed to load. Ensure database migrations are up to date, then retry.";
    }
    if (typeof error.message === "string" && error.message.length > 0) {
      return error.message;
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

export function truncateReviewReason(value: string | null, maxLength = 96): string {
  if (!value || !value.trim()) {
    return "No automated rationale recorded.";
  }
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

export function summarizeReviewQueueItem(item: ComplianceReviewQueueItem): string {
  const parts = [
    item.employee_id,
    item.expense_date,
    formatComplianceOutcome(item.outcome),
  ];
  if (item.rule_id) {
    parts.push(item.rule_id);
  }
  return parts.join(" · ");
}

export function outcomeRowClassName(outcome: ComplianceOutcome): string {
  if (outcome === "violation") {
    return "outcome-violation";
  }
  if (outcome === "needs_review") {
    return "outcome-needs-review";
  }
  if (outcome === "missing_evidence") {
    return "outcome-missing-evidence";
  }
  return "outcome-pass";
}

export function formatQueueItemHeadline(item: ComplianceReviewQueueItem): string {
  return `${item.employee_id} · ${item.expense_date} · Row ${item.row_index + 1}`;
}

export function formatQueueItemSecondary(item: ComplianceReviewQueueItem): string {
  return truncateReviewReason(item.reason, 120);
}

export function formatExpenseRowSubtitle(row: ExpenseReportRow): string {
  const amount = formatExpenseRowValue(row.amount);
  const currency = formatExpenseRowValue(row.currency);
  const amountLabel =
    amount !== "—" && currency !== "—" ? `${amount} ${currency}` : amount;
  return [row.employee_id, row.expense_category, amountLabel, row.expense_date]
    .filter((part) => part && part !== "—")
    .join(" · ");
}

export function formatCitationDocumentLabel(documentId: string): string {
  const primary = documentId.split(" · ")[0]?.trim() ?? documentId;
  return primary.replace(/-/g, " ");
}

export function formatCitationSectionLabel(sectionId: string, maxLength = 72): string {
  const normalized = sectionId.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export interface ExpenseRowFieldGroup {
  title?: string;
  fields: { label: string; value: string; fullWidth?: boolean }[];
}

export function formatExpenseRowValue(value: string | boolean | number | null): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}

export function expenseRowFieldGroups(row: ExpenseReportRow): ExpenseRowFieldGroup[] {
  return [
    {
      title: "Transaction",
      fields: [
        { label: "Employee", value: formatExpenseRowValue(row.employee_id) },
        { label: "Date", value: formatExpenseRowValue(row.expense_date) },
        { label: "Category", value: formatExpenseRowValue(row.expense_category) },
        { label: "Amount", value: formatExpenseRowValue(row.amount) },
        { label: "Currency", value: formatExpenseRowValue(row.currency) },
      ],
    },
    {
      title: "Context",
      fields: [
        {
          label: "Business purpose",
          value: formatExpenseRowValue(row.business_purpose),
          fullWidth: true,
        },
        {
          label: "Attendees",
          value: formatExpenseRowValue(row.attendee_list),
          fullWidth: true,
        },
      ],
    },
    {
      title: "Compliance signals",
      fields: [
        {
          label: "Manager approval",
          value: formatExpenseRowValue(row.manager_approval),
        },
        {
          label: "Receipt attached",
          value: formatExpenseRowValue(row.receipt_attached),
        },
      ],
    },
    {
      title: "Trip",
      fields: [
        { label: "Country", value: formatExpenseRowValue(row.country) },
        { label: "Travel type", value: formatExpenseRowValue(row.travel_type) },
        { label: "Trip ID", value: formatExpenseRowValue(row.trip_id) },
        {
          label: "Submission days",
          value: formatExpenseRowValue(row.submission_days),
        },
      ],
    },
  ];
}

/** @deprecated Use expenseRowFieldGroups for grouped Notion-style layout. */
export function expenseRowFieldEntries(
  row: ExpenseReportRow,
): { label: string; value: string }[] {
  return expenseRowFieldGroups(row).flatMap((group) => group.fields);
}
