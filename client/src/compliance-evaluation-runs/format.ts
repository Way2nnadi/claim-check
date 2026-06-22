import { ApiError } from "../shared/api/client";
import type { ComplianceEvaluationRunSummary, ComplianceOutcome } from "./types";

export function formatComplianceOutcome(outcome: ComplianceOutcome): string {
  return outcome === "pass" ? "Pass" : "Violation";
}

export function complianceOutcomeTone(
  outcome: ComplianceOutcome,
): "success" | "danger" {
  return outcome === "pass" ? "success" : "danger";
}

export function summarizeComplianceEvaluationRun(
  summary: ComplianceEvaluationRunSummary,
): string {
  return `${summary.pass_count} pass · ${summary.violation_count} violation · ${summary.total_count} total`;
}

export function describeComplianceEvaluationRunError(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      if (error.message.includes("Compiled Rule Set")) {
        return "Compiled Rule Set was not found. Compile a published Policy Version before running compliance checks.";
      }
      if (error.message.includes("Expense Report")) {
        return "Expense Report was not found. Refresh the page and try again.";
      }
    }
    if (error.status === 422) {
      if (error.message.includes("no enforceable Rules")) {
        return "Selected Compiled Rule Set has no enforceable rules. Compile a Policy Version with enforceable rules first.";
      }
      if (error.message.includes("Unable to execute")) {
        return error.message;
      }
    }
    if (error.status === 403) {
      return "Admin role required to execute Compliance Evaluation Runs.";
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
