import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import RuleTestCoverageReadinessView from "./RuleTestCoverageReadinessView";
import type { RuleTestCaseGroup, RuleTestRun } from "./types";

const sampleGroups: RuleTestCaseGroup[] = [
  {
    rule_id: "rule-meal-cap-domestic",
    statement: "Domestic meals are capped at $75 per day.",
    positive_count: 1,
    negative_count: 1,
    boundary_count: 1,
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
          country: "domestic",
        },
        expected_outcome: "pass",
        generated_by: "admin-user",
        generated_at: "2026-06-22T12:00:00Z",
        status: "active",
        edited_at: "2026-06-23T12:00:00Z",
        edited_by: "approver-user",
        edit_rationale: "Adjusted amount to match policy examples.",
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
          country: "domestic",
        },
        expected_outcome: "violation",
        generated_by: "admin-user",
        generated_at: "2026-06-22T12:00:00Z",
        status: "disabled",
        disable_rationale: "Outdated fixture.",
      },
    ],
  },
];

const passingRun: RuleTestRun = {
  rule_test_run_id: "run-pass-001",
  compiled_rule_set_id: "compiled-set-1",
  executed_by: "admin-user",
  executed_at: "2026-06-24T10:00:00Z",
  summary: {
    total_count: 1,
    passed_count: 1,
    failed_count: 0,
    overall_passed: true,
  },
  case_results: [
    {
      rule_test_case_id: "rtc-positive-001",
      rule_id: "rule-meal-cap-domestic",
      variant: "positive",
      expected_outcome: "pass",
      actual_outcome: "pass",
      passed: true,
    },
  ],
};

const failingRun: RuleTestRun = {
  ...passingRun,
  rule_test_run_id: "run-fail-001",
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

function buildProps(
  overrides: Partial<React.ComponentProps<typeof RuleTestCoverageReadinessView>> = {},
) {
  return {
    activeCaseCount: 1,
    groups: sampleGroups,
    latestRuleTestRun: passingRun,
    ruleTestRunStatus: "ready" as const,
    isDownloadingReport: false,
    onDownloadReport: vi.fn(),
    ...overrides,
  };
}

describe("RuleTestCoverageReadinessView", () => {
  it("summarizes per-rule variant coverage", () => {
    render(<RuleTestCoverageReadinessView {...buildProps()} />);

    expect(
      screen.getByRole("table", { name: "Rule Test Coverage by rule" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 positive · 1 negative · 1 boundary · 0 exception")).toBeInTheDocument();
    expect(screen.getByText("Domestic meals are capped at $75 per day.")).toBeInTheDocument();
  });

  it("shows disabled and edited case counts per rule", () => {
    render(<RuleTestCoverageReadinessView {...buildProps()} />);

    expect(screen.getByText("1 active · 1 disabled · 1 edited")).toBeInTheDocument();
  });

  it("shows latest run gate status when a passing run exists", () => {
    render(<RuleTestCoverageReadinessView {...buildProps()} />);

    expect(screen.getByText("Rule Test gate open")).toBeInTheDocument();
    expect(screen.getByText(/All passed · 1\/1 passed/)).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
  });

  it("shows missing run gate status when active cases exist but no run was executed", () => {
    render(
      <RuleTestCoverageReadinessView
        {...buildProps({ latestRuleTestRun: null, ruleTestRunStatus: "ready" })}
      />,
    );

    expect(screen.getByText("Rule Test gate closed")).toBeInTheDocument();
    expect(screen.getByText("No run yet")).toBeInTheDocument();
  });

  it("shows failed cases with expected versus actual outcomes", () => {
    render(
      <RuleTestCoverageReadinessView
        {...buildProps({ latestRuleTestRun: failingRun })}
      />,
    );

    expect(screen.getByText("Rule Test gate closed")).toBeInTheDocument();
    expect(screen.getByText("Failures")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Failed Rule Test Run results" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Failed cases — expected vs actual")).toBeInTheDocument();

    const failureTable = screen.getByRole("table", {
      name: "Failed Rule Test Run results",
    });
    expect(failureTable).toHaveTextContent("Violation");
    expect(failureTable).toHaveTextContent("Pass");
    expect(failureTable).toHaveTextContent("Fail");
  });

  it("requests downloadable evidence for the latest run", async () => {
    const user = userEvent.setup();
    const onDownloadReport = vi.fn();

    render(
      <RuleTestCoverageReadinessView
        {...buildProps({ onDownloadReport })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Download evidence" }));
    expect(onDownloadReport).toHaveBeenCalledTimes(1);
  });
});
