import { ApiError } from "../shared/api/client";
import type {
  AggregationPeriod,
  AggregationWindowContext,
  ComplianceEvaluationRunSummary,
  ComplianceOutcome,
  CurrencyMatchContext,
  EffectiveDateScopeContext,
  ScopeMatchContext,
} from "./types";

export function formatComplianceOutcome(outcome: ComplianceOutcome): string {
  switch (outcome) {
    case "pass":
      return "Pass";
    case "violation":
      return "Violation";
    case "needs_review":
      return "Needs review";
    case "missing_evidence":
      return "Missing evidence";
  }
}

export function formatMatchingRuleIds(
  primaryRuleId: string | null,
  matchingRuleIds: string[],
): string | null {
  if (matchingRuleIds.length <= 1) {
    return null;
  }
  const secondaryRuleIds = matchingRuleIds.filter((ruleId) => ruleId !== primaryRuleId);
  if (secondaryRuleIds.length === 0) {
    return null;
  }
  return `Also matched: ${secondaryRuleIds.join(", ")}`;
}

export function formatMissingEvidenceFields(fields: string[]): string | null {
  if (fields.length === 0) {
    return null;
  }
  return `Missing evidence: ${fields.join(", ")}`;
}

const SCOPE_DIMENSION_LABELS: Record<string, string> = {
  expense_category: "Category",
  country: "Country",
  travel_type: "Travel type",
  effective_start_date: "Effective from",
  effective_end_date: "Effective until",
  employee_group: "Employee group",
  department: "Department",
  role: "Role",
  seniority: "Seniority",
  state: "State",
  city: "City",
  region: "Region",
};

function formatScopeDimensionLabel(dimension: string): string {
  return SCOPE_DIMENSION_LABELS[dimension] ?? dimension.replaceAll("_", " ");
}

function formatScopeDimensionEntries(
  dimensions: Record<string, string>,
): string {
  return Object.entries(dimensions)
    .map(
      ([dimension, value]) =>
        `${formatScopeDimensionLabel(dimension)}: ${value}`,
    )
    .join(" · ");
}

export function formatScopeMatchContext(
  context: ScopeMatchContext | null | undefined,
): string | null {
  if (!context) {
    return null;
  }
  const parts: string[] = [];
  if (Object.keys(context.matched_dimensions).length > 0) {
    parts.push(
      `Matched scope: ${formatScopeDimensionEntries(context.matched_dimensions)}`,
    );
  }
  if (Object.keys(context.unavailable_dimensions).length > 0) {
    parts.push(
      `Unavailable in v1: ${formatScopeDimensionEntries(context.unavailable_dimensions)}`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

const EFFECTIVE_DATE_POSITION_LABELS: Record<string, string> = {
  before: "Before effective window",
  within: "Within effective window",
  after: "After effective window",
};

export function formatCurrencyMatchContext(
  context: CurrencyMatchContext | null | undefined,
): string | null {
  if (!context) {
    return null;
  }
  if (context.status === "not_applicable") {
    return `Expense currency: ${context.expense_currency} · Rule currency not specified`;
  }
  if (context.status === "match") {
    return `Currency match: ${context.expense_currency}`;
  }
  return (
    `Currency mismatch: rule ${context.rule_currency ?? "unknown"} · ` +
    `expense ${context.expense_currency} · conversion not supported in v1`
  );
}

export function formatEffectiveDateScopeContext(
  context: EffectiveDateScopeContext | null | undefined,
): string | null {
  if (!context) {
    return null;
  }
  const windowParts: string[] = [];
  if (context.effective_start_date) {
    windowParts.push(`from ${context.effective_start_date}`);
  }
  if (context.effective_end_date) {
    windowParts.push(`until ${context.effective_end_date}`);
  }
  const windowLabel =
    windowParts.length > 0 ? windowParts.join(" ") : "open-ended window";
  const positionLabel =
    EFFECTIVE_DATE_POSITION_LABELS[context.position] ?? context.position;
  return (
    `Effective window ${windowLabel} · expense ${context.expense_date} · ` +
    `${positionLabel}`
  );
}

export function formatEvaluationEvidenceContext(input: {
  scope_context?: ScopeMatchContext | null;
  currency_context?: CurrencyMatchContext | null;
  effective_date_context?: EffectiveDateScopeContext | null;
}): string | null {
  const parts = [
    formatScopeMatchContext(input.scope_context),
    formatCurrencyMatchContext(input.currency_context),
    formatEffectiveDateScopeContext(input.effective_date_context),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function formatBooleanComparisonValue(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return "Yes";
  }
  if (normalized === "false") {
    return "No";
  }
  return value;
}

export function formatViolationComparison(
  policyLimit: string | null,
  actualValue: string | null,
): string | null {
  if (policyLimit === null || actualValue === null) {
    return null;
  }
  const limitIsBoolean =
    policyLimit.trim().toLowerCase() === "true" ||
    policyLimit.trim().toLowerCase() === "false";
  const actualIsBoolean =
    actualValue.trim().toLowerCase() === "true" ||
    actualValue.trim().toLowerCase() === "false";
  if (limitIsBoolean && actualIsBoolean) {
    return `Required ${formatBooleanComparisonValue(policyLimit)} · Actual ${formatBooleanComparisonValue(actualValue)}`;
  }
  return `Limit ${policyLimit} · Actual ${actualValue}`;
}

const AGGREGATION_PERIOD_LABELS: Record<AggregationPeriod, string> = {
  per_transaction: "Per transaction",
  per_day: "Per day",
  per_trip: "Per trip",
  per_night: "Per night",
  per_attendee: "Per attendee",
};

export function formatAggregationPeriod(
  period: AggregationPeriod,
): string {
  return AGGREGATION_PERIOD_LABELS[period] ?? period.replaceAll("_", " ");
}

export function formatAggregationWindowContext(
  context: AggregationWindowContext | null | undefined,
): string | null {
  if (!context) {
    return null;
  }
  const periodLabel = formatAggregationPeriod(context.aggregation_period);
  const includedRowLabels = context.included_rows
    .map((row) => {
      const rowNumber = row.row_index + 1;
      if (row.row_amount !== null && row.row_amount.trim() !== "") {
        return `Row ${rowNumber} (${row.row_amount})`;
      }
      return `Row ${rowNumber}`;
    })
    .join(", ");
  const parts = [
    `${periodLabel} window`,
    `Included: ${includedRowLabels}`,
    `Aggregate ${context.aggregate_value} vs limit ${context.policy_limit}`,
  ];
  if (context.trip_id) {
    parts.push(`Trip ${context.trip_id}`);
  }
  if (context.attendee_count !== null && context.attendee_count > 1) {
    parts.push(`${context.attendee_count} attendees`);
  }
  if (context.grouping_note) {
    parts.push(context.grouping_note);
  }
  return parts.join(" · ");
}

export function hasAggregationWindowContext(
  context: AggregationWindowContext | null | undefined,
): boolean {
  if (!context) {
    return false;
  }
  return context.aggregation_period !== "per_transaction";
}

export function normalizeOutcomeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function citationDuplicatesReason(
  reason: string | null,
  citationQuote: string | null,
): boolean {
  if (reason === null || citationQuote === null) {
    return false;
  }
  const normalizedReason = normalizeOutcomeText(reason);
  const normalizedCitation = normalizeOutcomeText(citationQuote);
  if (normalizedReason === normalizedCitation) {
    return true;
  }
  return normalizedReason.includes(normalizedCitation);
}

export function complianceOutcomeTone(
  outcome: ComplianceOutcome,
): "success" | "danger" | "warning" {
  switch (outcome) {
    case "pass":
      return "success";
    case "violation":
      return "danger";
    case "needs_review":
    case "missing_evidence":
      return "warning";
  }
}

export function summarizeComplianceEvaluationRun(
  summary: ComplianceEvaluationRunSummary,
): string {
  const parts = [
    `${summary.pass_count} pass`,
    `${summary.violation_count} violation`,
    `${summary.needs_review_count} needs review`,
    `${summary.missing_evidence_count} missing evidence`,
    `${summary.total_count} total`,
  ];
  return parts.join(" · ");
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
      if (error.message.includes("compilation blocked evaluation")) {
        return error.message;
      }
      if (error.message.includes("no enforceable Rules")) {
        return "Selected Compiled Rule Set has no enforceable rules. Compile a Policy Version with enforceable rules first.";
      }
      if (error.message.includes("passing Rule Test Run")) {
        return error.message;
      }
      if (error.message.includes("most recent Rule Test Run")) {
        return error.message;
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

export type RuleTestRunGateStatus =
  | "not_required"
  | "loading"
  | "open"
  | "missing_run"
  | "failed_run";

export function resolveRuleTestRunGateStatus(input: {
  enforceableRuleCount: number;
  latestRun: {
    summary: { overall_passed: boolean };
  } | null;
  status: "idle" | "loading" | "ready" | "error";
}): RuleTestRunGateStatus {
  if (input.enforceableRuleCount === 0) {
    return "not_required";
  }
  if (input.status === "loading" || input.status === "idle") {
    return "loading";
  }
  if (input.latestRun === null) {
    return "missing_run";
  }
  if (!input.latestRun.summary.overall_passed) {
    return "failed_run";
  }
  return "open";
}

export function describeRuleTestRunGate(input: {
  gateStatus: RuleTestRunGateStatus;
  latestRun: {
    rule_test_run_id: string;
    summary: {
      passed_count: number;
      failed_count: number;
      total_count: number;
      overall_passed: boolean;
    };
    executed_at: string;
  } | null;
  hasCompiledRuleSet?: boolean;
}): { title: string; detail: string } {
  const hasCompiledRuleSet = input.hasCompiledRuleSet ?? true;

  switch (input.gateStatus) {
    case "not_required":
      if (!hasCompiledRuleSet) {
        return {
          title: "Compile on run",
          detail:
            "This Policy Version has not been compiled yet. The compliance check will compile automatically before evaluation.",
        };
      }
      return {
        title: "Rule Test gate not required",
        detail:
          "This Policy Version has no enforceable rules with generated test cases.",
      };
    case "loading":
      return {
        title: "Checking Rule Test gate",
        detail: hasCompiledRuleSet
          ? "Loading the latest Rule Test Run for this Policy Version…"
          : "Checking whether this Policy Version has been compiled…",
      };
    case "open":
      return {
        title: "Rule Test gate open",
        detail: input.latestRun
          ? `Latest Rule Test Run passed · ${input.latestRun.summary.passed_count}/${input.latestRun.summary.total_count} cases · ${new Date(input.latestRun.executed_at).toLocaleString()}`
          : "Latest Rule Test Run passed.",
      };
    case "missing_run":
      return {
        title: "Rule Test gate closed",
        detail: hasCompiledRuleSet
          ? "Run Rule Test Cases against this Policy Version and get a green Rule Test Run before evaluating Expense Reports."
          : "After compile, run Rule Test Cases and get a green Rule Test Run before evaluating Expense Reports.",
      };
    case "failed_run":
      return {
        title: "Rule Test gate closed",
        detail: input.latestRun
          ? `Latest Rule Test Run failed · ${input.latestRun.summary.failed_count}/${input.latestRun.summary.total_count} failing · fix cases and re-run tests.`
          : "The most recent Rule Test Run did not pass.",
      };
  }
}
