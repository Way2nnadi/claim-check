import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RuleTestCasesSection from "./RuleTestCasesSection";
import type { AuthenticatedPrincipal } from "../shared/auth/types";
import type { RuleTestCaseGroup } from "./types";

const approverPrincipal: AuthenticatedPrincipal = {
  subject: "approver-user",
  roles: ["approver"],
  auth_backend: "local",
};

const viewerPrincipal: AuthenticatedPrincipal = {
  subject: "viewer-user",
  roles: ["viewer"],
  auth_backend: "local",
};

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

function buildSectionProps(
  principal: AuthenticatedPrincipal,
  overrides: Partial<React.ComponentProps<typeof RuleTestCasesSection>> = {},
) {
  const canEdit = principal.roles.includes("approver");
  const canDisable = canEdit;

  return {
    canGenerate: principal.roles.includes("admin"),
    canRun: principal.roles.includes("admin"),
    canDisable,
    canEdit,
    compiledCount: 1,
    ruleTestCaseGroups: sampleGroups,
    ruleTestCaseTotal: 2,
    ruleTestCaseActiveCount: 1,
    ruleTestCaseDisabledCount: 1,
    ruleTestCaseStatus: "ready" as const,
    ruleTestCaseError: null,
    isGenerating: false,
    isRunning: false,
    isDownloadingReport: false,
    latestRuleTestRun: null,
    ruleTestRunStatus: "idle" as const,
    ruleTestRunError: null,
    statusActionTarget: null,
    statusActionRationale: "",
    statusActionError: null,
    isStatusActionSubmitting: false,
    editTarget: null,
    editDraft: null,
    editError: null,
    isEditSubmitting: false,
    onGenerate: vi.fn(),
    onRun: vi.fn(),
    onDownloadReport: vi.fn(),
    onStatusActionRequest: vi.fn(),
    onStatusActionConfirm: vi.fn(),
    onStatusActionCancel: vi.fn(),
    onStatusActionRationaleChange: vi.fn(),
    onEditRequest: vi.fn(),
    onEditConfirm: vi.fn(),
    onEditCancel: vi.fn(),
    onEditDraftChange: vi.fn(),
    ...overrides,
  };
}

describe("RuleTestCasesSection edit controls", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows Edit for approvers on active cases only", () => {
    render(<RuleTestCasesSection {...buildSectionProps(approverPrincipal)} />);

    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Disable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
  });

  it("hides Edit and disable/enable actions for viewers", () => {
    render(<RuleTestCasesSection {...buildSectionProps(viewerPrincipal)} />);

    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable" })).not.toBeInTheDocument();
  });

  it("requests edit when the Edit action is clicked", async () => {
    const user = userEvent.setup();
    const onEditRequest = vi.fn();

    render(
      <RuleTestCasesSection
        {...buildSectionProps(approverPrincipal, { onEditRequest })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEditRequest).toHaveBeenCalledWith(sampleGroups[0].cases[0]);
  });

  it("opens the edit modal and requires rationale before save", async () => {
    const user = userEvent.setup();
    const onEditRequest = vi.fn();
    const onEditConfirm = vi.fn();

    render(
      <RuleTestCasesSection
        {...buildSectionProps(approverPrincipal, {
          onEditRequest,
          onEditConfirm,
          editTarget: sampleGroups[0].cases[0],
          editDraft: {
            amount: "50",
            expectedOutcome: "pass",
            businessPurpose: "",
            submissionDays: "",
            managerApproval: false,
            receiptAttached: false,
            rationale: "",
          },
        })}
      />,
    );

    const saveButton = screen.getByRole("button", { name: "Save edit" });
    expect(saveButton).toBeDisabled();

    await user.type(screen.getByLabelText("Rationale"), "Corrected generated amount.");
    expect(saveButton).toBeDisabled();
  });

  it("calls onEditConfirm when save is clicked with rationale", async () => {
    const user = userEvent.setup();
    const onEditConfirm = vi.fn();

    render(
      <RuleTestCasesSection
        {...buildSectionProps(approverPrincipal, {
          onEditConfirm,
          editTarget: sampleGroups[0].cases[0],
          editDraft: {
            amount: "60",
            expectedOutcome: "pass",
            businessPurpose: "",
            submissionDays: "",
            managerApproval: false,
            receiptAttached: false,
            rationale: "Corrected generated amount.",
          },
        })}
      />,
    );

    const saveButton = screen.getByRole("button", { name: "Save edit" });
    expect(saveButton).not.toBeDisabled();
    await user.click(saveButton);
    expect(onEditConfirm).toHaveBeenCalled();
  });
});

describe("RuleTestCasesSection readiness visibility", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows per-rule coverage summary in the readiness view", () => {
    render(<RuleTestCasesSection {...buildSectionProps(approverPrincipal)} />);

    const readinessRegion = screen.getByRole("region", { name: "Rule Test Coverage readiness" });
    expect(readinessRegion).toBeInTheDocument();
    expect(
      within(readinessRegion).getByRole("table", { name: "Rule Test Coverage by rule" }),
    ).toHaveTextContent("1 positive · 1 negative · 1 boundary · 0 exception");
  });

  it("keeps disabled cases visible with rationale in the case ledger", () => {
    render(<RuleTestCasesSection {...buildSectionProps(viewerPrincipal)} />);

    const caseLedger = screen.getByRole("table", { name: "Rule Test Cases" });
    expect(within(caseLedger).getByText("Outdated fixture.")).toBeInTheDocument();
    expect(within(caseLedger).getByText("Disabled")).toBeInTheDocument();
  });

  it("shows latest run failures with expected versus actual outcomes", () => {
    render(
      <RuleTestCasesSection
        {...buildSectionProps(viewerPrincipal, {
          latestRuleTestRun: {
            rule_test_run_id: "run-fail-001",
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
          },
          ruleTestRunStatus: "ready",
        })}
      />,
    );

    expect(screen.getByText("Rule Test gate closed")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Failed Rule Test Run results" }),
    ).toBeInTheDocument();
  });
});
