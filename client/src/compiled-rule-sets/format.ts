import type { CompileStatus } from "./types";
import { ApiError } from "../shared/api/client";

export function formatCompileStatus(status: CompileStatus): string {
  if (status === "compiled") {
    return "Compiled";
  }
  if (status === "skipped_non_enforceable") {
    return "Skipped";
  }
  return "Compile error";
}

export function compileStatusVariant(
  status: CompileStatus,
): "success" | "warning" | "danger" {
  if (status === "compiled") {
    return "success";
  }
  if (status === "skipped_non_enforceable") {
    return "warning";
  }
  return "danger";
}

export function summarizeCompileCounts(summary: {
  compiled: number;
  skipped_non_enforceable: number;
  compile_error: number;
}): string {
  const parts = [
    `${summary.compiled} compiled`,
    `${summary.skipped_non_enforceable} skipped`,
  ];
  if (summary.compile_error > 0) {
    parts.push(`${summary.compile_error} error${summary.compile_error === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

export function describeCompiledRuleSetError(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof ApiError) {
    if (typeof error.message === "string" && error.message.length > 0) {
      return error.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}
