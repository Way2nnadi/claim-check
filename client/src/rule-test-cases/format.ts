import type {
  EvaluationOutcome,
  RuleTestCase,
  RuleTestCaseGroup,
  RuleTestCaseVariant,
} from "./types";

const VARIANT_LABELS: Record<RuleTestCaseVariant, string> = {
  positive: "Positive",
  negative: "Negative",
  boundary: "Boundary",
  exception: "Exception",
};

const VARIANT_TONES: Record<
  RuleTestCaseVariant,
  "success" | "danger" | "warning" | "neutral"
> = {
  positive: "success",
  negative: "danger",
  boundary: "warning",
  exception: "neutral",
};

export function formatRuleTestCaseVariant(variant: RuleTestCaseVariant): string {
  return VARIANT_LABELS[variant];
}

export function ruleTestCaseVariantTone(
  variant: RuleTestCaseVariant,
): "success" | "danger" | "warning" | "neutral" {
  return VARIANT_TONES[variant];
}

export function formatEvaluationOutcome(outcome: EvaluationOutcome): string {
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

export function evaluationOutcomeTone(
  outcome: EvaluationOutcome,
): "success" | "danger" | "warning" | "neutral" {
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

export function summarizeRuleTestCaseCoverage(
  positiveCount: number,
  negativeCount: number,
  boundaryCount: number,
  exceptionCount: number,
): string {
  const parts = [
    `${positiveCount} positive`,
    `${negativeCount} negative`,
    `${boundaryCount} boundary`,
    `${exceptionCount} exception`,
  ];
  return parts.join(" · ");
}

export function formatFixtureDetail(fixture: {
  amount: string;
  currency: string;
  business_purpose?: string | null;
  submission_days?: number | null;
  manager_approval?: boolean | null;
  receipt_attached?: boolean | null;
}): string {
  const details: string[] = [];
  if (fixture.business_purpose) {
    details.push(`purpose: ${fixture.business_purpose}`);
  }
  if (fixture.submission_days != null) {
    details.push(`submission: ${fixture.submission_days} days`);
  }
  if (fixture.manager_approval != null) {
    details.push(`manager approval: ${fixture.manager_approval ? "yes" : "no"}`);
  }
  if (fixture.receipt_attached != null) {
    details.push(`receipt: ${fixture.receipt_attached ? "yes" : "no"}`);
  }
  if (details.length > 0) {
    return details.join(" · ");
  }
  return `${fixture.amount} ${fixture.currency}`;
}

export function describeRuleTestCaseError(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

export function formatCasePassFail(passed: boolean): string {
  return passed ? "Pass" : "Fail";
}

export function casePassFailTone(passed: boolean): "success" | "danger" {
  return passed ? "success" : "danger";
}

export function summarizeRuleTestRun(summary: {
  passed_count: number;
  failed_count: number;
  total_count: number;
  overall_passed: boolean;
}): string {
  const status = summary.overall_passed ? "All passed" : "Failures detected";
  return `${status} · ${summary.passed_count}/${summary.total_count} passed`;
}

export function formatRuleTestCaseStatus(status: "active" | "disabled"): string {
  return status === "disabled" ? "Disabled" : "Active";
}

export function ruleTestCaseStatusTone(
  status: "active" | "disabled",
): "success" | "neutral" | "danger" {
  return status === "disabled" ? "danger" : "success";
}

export function summarizeRuleTestCaseStatusCounts(
  activeCount: number,
  disabledCount: number,
): string {
  const parts = [`${activeCount} active`];
  if (disabledCount > 0) {
    parts.push(`${disabledCount} disabled`);
  }
  return parts.join(" · ");
}

export type RuleTestCaseStatusFilter = "all" | "active" | "disabled";

function variantCounts(cases: RuleTestCase[]) {
  return {
    positive_count: cases.filter((testCase) => testCase.variant === "positive").length,
    negative_count: cases.filter((testCase) => testCase.variant === "negative").length,
    boundary_count: cases.filter((testCase) => testCase.variant === "boundary").length,
    exception_count: cases.filter((testCase) => testCase.variant === "exception").length,
  };
}

export function filterRuleTestCaseGroups(
  groups: RuleTestCaseGroup[],
  statusFilter: RuleTestCaseStatusFilter,
): RuleTestCaseGroup[] {
  if (statusFilter === "all") {
    return groups;
  }

  return groups
    .map((group) => {
      const cases = group.cases.filter((testCase) =>
        statusFilter === "active"
          ? testCase.status !== "disabled"
          : testCase.status === "disabled",
      );
      if (cases.length === 0) {
        return null;
      }
      return {
        ...group,
        ...variantCounts(cases),
        cases,
      };
    })
    .filter((group): group is RuleTestCaseGroup => group !== null);
}
