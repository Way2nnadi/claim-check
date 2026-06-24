import type { RuleTestCaseGroup, RuleTestRun, RuleTestRunCaseResult } from "./types";

export type RuleRunReadinessStatus = "passed" | "failed" | "not_run" | "no_run";

export interface RuleReadinessRow {
  rule_id: string;
  statement: string;
  positive_count: number;
  negative_count: number;
  boundary_count: number;
  exception_count: number;
  active_count: number;
  disabled_count: number;
  edited_count: number;
  run_status: RuleRunReadinessStatus;
  failed_count: number;
  passed_count: number;
}

export function resolveRuleRunStatus(
  ruleId: string,
  latestRun: RuleTestRun | null,
  activeCaseCount: number,
): RuleRunReadinessStatus {
  if (latestRun === null) {
    return "no_run";
  }
  if (activeCaseCount === 0) {
    return "not_run";
  }
  const ruleResults = latestRun.case_results.filter((result) => result.rule_id === ruleId);
  if (ruleResults.length === 0) {
    return "not_run";
  }
  if (ruleResults.some((result) => !result.passed)) {
    return "failed";
  }
  return "passed";
}

export function buildRuleReadinessRows(
  groups: RuleTestCaseGroup[],
  latestRun: RuleTestRun | null,
): RuleReadinessRow[] {
  return groups.map((group) => {
    const activeCount = group.cases.filter((testCase) => testCase.status === "active").length;
    const disabledCount = group.cases.length - activeCount;
    const editedCount = group.cases.filter((testCase) => testCase.edited_at != null).length;
    const ruleResults = latestRun
      ? latestRun.case_results.filter((result) => result.rule_id === group.rule_id)
      : [];
    const failedCount = ruleResults.filter((result) => !result.passed).length;
    const passedCount = ruleResults.filter((result) => result.passed).length;

    return {
      rule_id: group.rule_id,
      statement: group.statement,
      positive_count: group.positive_count,
      negative_count: group.negative_count,
      boundary_count: group.boundary_count,
      exception_count: group.exception_count,
      active_count: activeCount,
      disabled_count: disabledCount,
      edited_count: editedCount,
      run_status: resolveRuleRunStatus(group.rule_id, latestRun, activeCount),
      failed_count: failedCount,
      passed_count: passedCount,
    };
  });
}

export function getFailedRuleTestRunResults(
  latestRun: RuleTestRun | null,
): RuleTestRunCaseResult[] {
  if (latestRun === null) {
    return [];
  }
  return latestRun.case_results.filter((result) => !result.passed);
}

export function formatRuleRunReadinessStatus(status: RuleRunReadinessStatus): string {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failures";
    case "not_run":
      return "Not run";
    case "no_run":
      return "No run yet";
  }
}

export function ruleRunReadinessTone(
  status: RuleRunReadinessStatus,
): "success" | "danger" | "warning" | "neutral" {
  switch (status) {
    case "passed":
      return "success";
    case "failed":
      return "danger";
    case "not_run":
      return "warning";
    case "no_run":
      return "neutral";
  }
}

export function summarizeRuleCaseCounts(
  activeCount: number,
  disabledCount: number,
  editedCount: number,
): string {
  const parts = [`${activeCount} active`];
  if (disabledCount > 0) {
    parts.push(`${disabledCount} disabled`);
  }
  if (editedCount > 0) {
    parts.push(`${editedCount} edited`);
  }
  return parts.join(" · ");
}
