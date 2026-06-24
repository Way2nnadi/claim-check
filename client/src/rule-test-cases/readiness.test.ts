import { describe, expect, it } from "vitest";
import {
  buildRuleReadinessRows,
  getFailedRuleTestRunResults,
  resolveRuleRunStatus,
} from "./readiness";
import type { RuleTestCaseGroup, RuleTestRun } from "./types";

const sampleGroup: RuleTestCaseGroup = {
  rule_id: "rule-meal-cap-domestic",
  statement: "Domestic meals are capped at $75 per day.",
  positive_count: 1,
  negative_count: 1,
  boundary_count: 0,
  exception_count: 0,
  cases: [
    {
      rule_test_case_id: "rtc-positive-001",
      compiled_rule_set_id: "compiled-set-1",
      rule_id: "rule-meal-cap-domestic",
      variant: "positive",
      expense_fixture: {
        employee_id: "test-employee-001",
        expense_date: "2026-06-01",
        expense_category: "meals",
        amount: "50",
        currency: "USD",
      },
      expected_outcome: "pass",
      generated_by: "admin-user",
      generated_at: "2026-06-22T12:00:00Z",
      status: "active",
    },
    {
      rule_test_case_id: "rtc-negative-001",
      compiled_rule_set_id: "compiled-set-1",
      rule_id: "rule-meal-cap-domestic",
      variant: "negative",
      expense_fixture: {
        employee_id: "test-employee-001",
        expense_date: "2026-06-01",
        expense_category: "meals",
        amount: "100",
        currency: "USD",
      },
      expected_outcome: "violation",
      generated_by: "admin-user",
      generated_at: "2026-06-22T12:00:00Z",
      status: "disabled",
      disable_rationale: "Outdated fixture.",
    },
  ],
};

describe("rule test readiness helpers", () => {
  it("builds per-rule coverage rows with disabled counts", () => {
    const rows = buildRuleReadinessRows([sampleGroup], null);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      positive_count: 1,
      negative_count: 1,
      active_count: 1,
      disabled_count: 1,
      run_status: "no_run",
    });
  });

  it("resolves rule run status from latest run results", () => {
    const latestRun: RuleTestRun = {
      rule_test_run_id: "run-001",
      compiled_rule_set_id: "compiled-set-1",
      executed_by: "admin-user",
      executed_at: "2026-06-24T10:00:00Z",
      summary: {
        total_count: 1,
        passed_count: 0,
        failed_count: 1,
        overall_passed: false,
      },
      case_results: [
        {
          rule_test_case_id: "rtc-positive-001",
          rule_id: "rule-meal-cap-domestic",
          variant: "positive",
          expected_outcome: "pass",
          actual_outcome: "violation",
          passed: false,
        },
      ],
    };

    expect(resolveRuleRunStatus("rule-meal-cap-domestic", latestRun, 1)).toBe("failed");
    expect(getFailedRuleTestRunResults(latestRun)).toHaveLength(1);
  });
});
