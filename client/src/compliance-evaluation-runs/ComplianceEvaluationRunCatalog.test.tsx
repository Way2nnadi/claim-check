import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ComplianceEvaluationRunCatalog from "./ComplianceEvaluationRunCatalog";
import ComplianceEvaluationSection from "./ComplianceEvaluationSection";
import type { AuthenticatedPrincipal } from "../shared/auth/types";

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => payload,
  });
}

function errorResponse(status: number, payload: unknown) {
  return Promise.resolve({
    ok: false,
    status,
    json: async () => payload,
  });
}

const adminPrincipal: AuthenticatedPrincipal = {
  subject: "admin-user",
  roles: ["admin"],
  auth_backend: "local",
};

const viewerPrincipal: AuthenticatedPrincipal = {
  subject: "viewer-user",
  roles: ["viewer"],
  auth_backend: "local",
};

const mealCapCitation = {
  document_id: "doc-expense-policy",
  document_version_id: "docv-2026-06-01",
  section_id: "meals#domestic-cap",
  quote: "Domestic meal expenses are limited to $75 per person per day.",
  start_char: 42,
  end_char: 98,
};

const sampleRun = {
  compliance_evaluation_run_id: "compliance-run-1",
  expense_report_id: "expense-report-1",
  compiled_rule_set_id: "compiled-set-1",
  policy_version_id: "policy-v1",
  executed_by: "admin-user",
  executed_at: "2026-06-22T12:00:00Z",
  summary: {
    total_count: 2,
    pass_count: 1,
    violation_count: 1,
    needs_review_count: 0,
    missing_evidence_count: 0,
  },
  row_outcomes: [
    {
      row_index: 0,
      employee_id: "emp-001",
      expense_date: "2026-06-21",
      outcome: "pass",
      rule_id: null,
      matching_rule_ids: [],
      reason: null,
      policy_limit: null,
      actual_value: null,
      evidence: [],
      missing_evidence_fields: [],
    },
    {
      row_index: 1,
      employee_id: "emp-002",
      expense_date: "2026-06-21",
      outcome: "violation",
      rule_id: "rule-meals-cap",
      matching_rule_ids: ["rule-meals-cap"],
      reason: "Amount exceeds meal cap.",
      policy_limit: "75",
      actual_value: "100",
      evidence: [mealCapCitation],
      missing_evidence_fields: [],
    },
  ],
};

function buildSampleRuns(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...sampleRun,
    compliance_evaluation_run_id: `run-${String(index + 1).padStart(2, "0")}-abcdef123456`,
    executed_at: `2026-06-22T${String(12 + Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00Z`,
  }));
}

function buildSampleRunWithOutcomes(outcomeCount: number) {
  return {
    ...sampleRun,
    summary: {
      total_count: outcomeCount,
      pass_count: 0,
      violation_count: outcomeCount,
      needs_review_count: 0,
      missing_evidence_count: 0,
    },
    row_outcomes: Array.from({ length: outcomeCount }, (_, index) => ({
      row_index: index,
      employee_id: "E1001",
      expense_date: "2026-05-01",
      outcome: "violation" as const,
      rule_id: "rule-meals-cap",
      matching_rule_ids: ["rule-meals-cap"],
      reason: "Amount exceeds meal cap.",
      policy_limit: "75",
      actual_value: "100",
      evidence: [mealCapCitation],
      missing_evidence_fields: [],
    })),
  };
}

const sampleRuleTestRun = {
  rule_test_run_id: "rtr-green-1",
  compiled_rule_set_id: "compiled-set-1",
  executed_by: "admin-user",
  executed_at: "2026-06-22T11:30:00Z",
  summary: {
    total_count: 3,
    passed_count: 3,
    failed_count: 0,
    overall_passed: true,
  },
  case_results: [],
};

const samplePolicyVersion = {
  policy_version_id: "policy-v1",
  published_by: "approver-user",
  change_summary: "Published snapshot",
  rule_count: 1,
  created_at: "2026-06-22T10:00:00Z",
};

const sampleCompiledRuleSetForPolicy = {
  compiled_rule_set_id: "compiled-set-1",
  policy_version_id: "policy-v1",
  compiled_by: "admin-user",
  compiled_at: "2026-06-22T11:00:00Z",
  entries: [],
  summary: {
    compiled: 1,
    skipped_non_enforceable: 0,
    compile_error: 0,
  },
};

describe("ComplianceEvaluationSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("executes a compliance evaluation run for admins", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/policy-versions") {
        return jsonResponse({ items: [samplePolicyVersion] });
      }
      if (url === "/api/policy-versions/policy-v1/compiled-rule-sets") {
        return jsonResponse({ items: [sampleCompiledRuleSetForPolicy] });
      }
      if (
        url ===
          "/api/expense-reports/expense-report-1/compliance-evaluation-runs" &&
        (!init?.method || init.method === "GET")
      ) {
        return jsonResponse({ expense_report_id: "expense-report-1", items: [] });
      }
      if (url === "/api/compiled-rule-sets/compiled-set-1/rule-test-runs") {
        return jsonResponse({
          compiled_rule_set_id: "compiled-set-1",
          items: [sampleRuleTestRun],
        });
      }
      if (
        url ===
          "/api/expense-reports/expense-report-1/compliance-evaluation-runs" &&
        init?.method === "POST"
      ) {
        return jsonResponse(sampleRun);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ComplianceEvaluationSection
        expenseReportId="expense-report-1"
        rowCount={2}
        principal={adminPrincipal}
      />,
    );

    expect(await screen.findByText("Rule Test gate open")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Run compliance check" }),
    ).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Run compliance check" }));

    expect(await screen.findByText("1 pass")).toBeInTheDocument();
    expect(screen.getByText("1 violation")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/expense-reports/expense-report-1/compliance-evaluation-runs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ policy_version_id: "policy-v1" }),
      }),
    );
  });

  it("allows execution before compile when no compiled rule set exists yet", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/policy-versions") {
        return jsonResponse({ items: [samplePolicyVersion] });
      }
      if (url === "/api/policy-versions/policy-v1/compiled-rule-sets") {
        return jsonResponse({ items: [] });
      }
      if (
        url ===
          "/api/expense-reports/expense-report-1/compliance-evaluation-runs" &&
        (!init?.method || init.method === "GET")
      ) {
        return jsonResponse({ expense_report_id: "expense-report-1", items: [] });
      }
      if (
        url ===
          "/api/expense-reports/expense-report-1/compliance-evaluation-runs" &&
        init?.method === "POST"
      ) {
        return jsonResponse(sampleRun);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ComplianceEvaluationSection
        expenseReportId="expense-report-1"
        rowCount={2}
        principal={adminPrincipal}
      />,
    );

    expect(await screen.findByText("Compile on run")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Run compliance check" }),
    ).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Run compliance check" }));

    expect(await screen.findByText("1 pass")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/expense-reports/expense-report-1/compliance-evaluation-runs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ policy_version_id: "policy-v1" }),
      }),
    );
  });

  it("blocks execution when the latest rule test run failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url === "/api/policy-versions") {
          return jsonResponse({ items: [samplePolicyVersion] });
        }
        if (url === "/api/policy-versions/policy-v1/compiled-rule-sets") {
          return jsonResponse({ items: [sampleCompiledRuleSetForPolicy] });
        }
        if (
          url ===
            "/api/expense-reports/expense-report-1/compliance-evaluation-runs" &&
          (!init?.method || init.method === "GET")
        ) {
          return jsonResponse({ expense_report_id: "expense-report-1", items: [] });
        }
        if (url === "/api/compiled-rule-sets/compiled-set-1/rule-test-runs") {
          return jsonResponse({
            compiled_rule_set_id: "compiled-set-1",
            items: [
              {
                ...sampleRuleTestRun,
                summary: {
                  total_count: 3,
                  passed_count: 2,
                  failed_count: 1,
                  overall_passed: false,
                },
              },
            ],
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(
      <ComplianceEvaluationSection
        expenseReportId="expense-report-1"
        rowCount={2}
        principal={adminPrincipal}
      />,
    );

    expect(await screen.findByText("Rule Test gate closed")).toBeInTheDocument();
    expect(
      await screen.findByText(/Latest Rule Test Run failed · 1\/3 failing/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run compliance check" })).toBeDisabled();
  });

  it("shows actionable errors when compile errors block evaluation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url === "/api/policy-versions") {
          return jsonResponse({ items: [samplePolicyVersion] });
        }
        if (url === "/api/policy-versions/policy-v1/compiled-rule-sets") {
          return jsonResponse({ items: [] });
        }
        if (
          url ===
            "/api/expense-reports/expense-report-1/compliance-evaluation-runs" &&
          (!init?.method || init.method === "GET")
        ) {
          return jsonResponse({ expense_report_id: "expense-report-1", items: [] });
        }
        if (
          url ===
            "/api/expense-reports/expense-report-1/compliance-evaluation-runs" &&
          init?.method === "POST"
        ) {
          return errorResponse(422, {
            detail:
              "Policy Version policy-v1 compilation blocked evaluation:\n• rule-meals-no-applicability: Enforceable rules require applicability metadata.",
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(
      <ComplianceEvaluationSection
        expenseReportId="expense-report-1"
        rowCount={2}
        principal={adminPrincipal}
      />,
    );

    expect(await screen.findByText("Compile on run")).toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole("button", { name: "Run compliance check" }),
    );

    expect(
      await screen.findByText(/rule-meals-no-applicability/),
    ).toBeInTheDocument();
  });

  it("paginates compliance evaluation runs on the expense report detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/policy-versions") {
          return jsonResponse({ items: [] });
        }
        if (
          url === "/api/expense-reports/expense-report-1/compliance-evaluation-runs"
        ) {
          return jsonResponse({
            expense_report_id: "expense-report-1",
            items: buildSampleRuns(15),
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(
      <ComplianceEvaluationSection
        expenseReportId="expense-report-1"
        rowCount={2}
        principal={viewerPrincipal}
      />,
    );

    expect(await screen.findByText("1–10 of 15 runs")).toBeInTheDocument();
    expect(screen.getByText("run-01-abcde…")).toBeInTheDocument();
    expect(screen.getByText("run-10-abcde…")).toBeInTheDocument();
    expect(screen.queryByText("run-11-abcde…")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next page of runs" }));

    expect(await screen.findByText("11–15 of 15 runs")).toBeInTheDocument();
    expect(screen.getByText("run-11-abcde…")).toBeInTheDocument();
  });

  it("keeps trigger controls hidden for viewers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/policy-versions") {
          return jsonResponse({ items: [] });
        }
        if (
          url === "/api/expense-reports/expense-report-1/compliance-evaluation-runs"
        ) {
          return jsonResponse({ expense_report_id: "expense-report-1", items: [] });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(
      <ComplianceEvaluationSection
        expenseReportId="expense-report-1"
        rowCount={2}
        principal={viewerPrincipal}
      />,
    );

    expect(
      await screen.findByText(
        "View-only — admin role required to execute Compliance Evaluation Runs.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run compliance check" }),
    ).not.toBeInTheDocument();
  });
});

describe("ComplianceEvaluationRunCatalog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders run detail with accessible pass and violation labels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/compliance-evaluation-runs/compliance-run-1") {
          return jsonResponse(sampleRun);
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(
      <ComplianceEvaluationRunCatalog
        principal={viewerPrincipal}
        initialRunId="compliance-run-1"
      />,
    );

    expect(await screen.findByText("Pass")).toBeInTheDocument();
    expect(screen.getByText("Violation")).toBeInTheDocument();
    const violationRow = screen.getByText("emp-002").closest("tr");
    expect(violationRow).not.toBeNull();
    expect(within(violationRow as HTMLElement).getByText("75")).toBeInTheDocument();
    expect(within(violationRow as HTMLElement).getByText("100")).toBeInTheDocument();
    expect(screen.getByText("Amount exceeds meal cap.")).toBeInTheDocument();
    expect(screen.getByText("Policy source")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Domestic meal expenses are limited to $75 per person per day.",
      ),
    ).toBeInTheDocument();
  });

  it("renders aggregation window context for cross-row violations", async () => {
    const aggregatedRun = {
      ...sampleRun,
      summary: {
        total_count: 2,
        pass_count: 0,
        violation_count: 2,
        needs_review_count: 0,
        missing_evidence_count: 0,
      },
      row_outcomes: [
        {
          row_index: 0,
          employee_id: "emp-001",
          expense_date: "2026-06-21",
          outcome: "violation" as const,
          rule_id: "rule-meals-cap",
          matching_rule_ids: ["rule-meals-cap"],
          reason: "Daily meal cap exceeded.",
          policy_limit: "75",
          actual_value: "80.00",
          evidence: [mealCapCitation],
          missing_evidence_fields: [],
          aggregation_context: {
            aggregation_period: "per_day" as const,
            included_rows: [
              { row_index: 0, row_amount: "40.00" },
              { row_index: 1, row_amount: "40.00" },
            ],
            aggregate_value: "80.00",
            policy_limit: "75",
            trip_id: "trip-1",
            attendee_count: null,
            grouping_note: null,
          },
        },
        {
          row_index: 1,
          employee_id: "emp-001",
          expense_date: "2026-06-21",
          outcome: "violation" as const,
          rule_id: "rule-meals-cap",
          matching_rule_ids: ["rule-meals-cap"],
          reason: "Daily meal cap exceeded.",
          policy_limit: "75",
          actual_value: "80.00",
          evidence: [mealCapCitation],
          missing_evidence_fields: [],
          aggregation_context: {
            aggregation_period: "per_day" as const,
            included_rows: [
              { row_index: 0, row_amount: "40.00" },
              { row_index: 1, row_amount: "40.00" },
            ],
            aggregate_value: "80.00",
            policy_limit: "75",
            trip_id: "trip-1",
            attendee_count: null,
            grouping_note: null,
          },
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/compliance-evaluation-runs/compliance-run-1") {
          return jsonResponse(aggregatedRun);
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(
      <ComplianceEvaluationRunCatalog
        principal={viewerPrincipal}
        initialRunId="compliance-run-1"
      />,
    );

    expect(await screen.findAllByText("Per day")).toHaveLength(2);
    expect(screen.getAllByText("Limit 75 · Actual 80.00")).toHaveLength(2);
    expect(screen.getAllByText(/Row 1/)).not.toHaveLength(0);
    expect(screen.getAllByText(/Row 2/)).not.toHaveLength(0);
    expect(screen.getAllByText("Policy source").length).toBeGreaterThan(0);
  });

  it("renders needs review outcomes with accessible warning styling", async () => {
    const needsReviewRun = {
      ...sampleRun,
      summary: {
        total_count: 1,
        pass_count: 0,
        violation_count: 0,
        needs_review_count: 1,
        missing_evidence_count: 0,
      },
      row_outcomes: [
        {
          row_index: 0,
          employee_id: "emp-001",
          expense_date: "2026-06-21",
          outcome: "needs_review" as const,
          rule_id: "rule-lodging-guidance",
          matching_rule_ids: ["rule-lodging-guidance"],
          reason:
            "Employees should prefer negotiated hotel blocks when available. Automated enforcement does not apply to guidance rules.",
          policy_limit: null,
          actual_value: null,
          evidence: [
            {
              document_id: "doc-expense-policy",
              document_version_id: "docv-2026-06-01",
              section_id: "lodging#preferred-blocks",
              quote: "Employees should prefer negotiated hotel blocks when available.",
              start_char: 10,
              end_char: 72,
            },
          ],
          missing_evidence_fields: [],
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/compliance-evaluation-runs/compliance-run-1") {
          return jsonResponse(needsReviewRun);
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(
      <ComplianceEvaluationRunCatalog
        principal={viewerPrincipal}
        initialRunId="compliance-run-1"
      />,
    );

    expect(await screen.findByText("Needs review")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Employees should prefer negotiated hotel blocks when available. Automated enforcement does not apply to guidance rules.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Policy source")).not.toBeInTheDocument();
    expect(screen.getByTitle("rule-lodging-guidance")).toBeInTheDocument();
  });

  it("renders deferred scope context for employee group needs review outcomes", async () => {
    const deferredScopeRun = {
      ...sampleRun,
      summary: {
        total_count: 1,
        pass_count: 0,
        violation_count: 0,
        needs_review_count: 1,
        missing_evidence_count: 0,
      },
      row_outcomes: [
        {
          row_index: 0,
          employee_id: "emp-001",
          expense_date: "2026-06-21",
          outcome: "needs_review" as const,
          rule_id: "rule-exec-meal-cap",
          matching_rule_ids: ["rule-exec-meal-cap"],
          reason:
            "Executive meal expenses are capped at $150 per day. Rule scope includes employee_group, which Expense Report rows do not carry in v1.",
          policy_limit: null,
          actual_value: null,
          scope_context: {
            matched_dimensions: {
              expense_category: "meals",
              country: "domestic",
            },
            unavailable_dimensions: {
              employee_group: "executives",
            },
          },
          evidence: [],
          missing_evidence_fields: [],
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/compliance-evaluation-runs/compliance-run-1") {
          return jsonResponse(deferredScopeRun);
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(
      <ComplianceEvaluationRunCatalog
        principal={viewerPrincipal}
        initialRunId="compliance-run-1"
      />,
    );

    expect(await screen.findByText("Needs review")).toBeInTheDocument();
    expect(
      screen.getByText(/Matched scope: Category: meals · Country: domestic/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Unavailable in v1: Employee group: executives/),
    ).toBeInTheDocument();
  });

  it("renders missing evidence outcomes with field list and limit comparison", async () => {
    const missingEvidenceRun = {
      ...sampleRun,
      summary: {
        total_count: 1,
        pass_count: 0,
        violation_count: 0,
        needs_review_count: 0,
        missing_evidence_count: 1,
      },
      row_outcomes: [
        {
          row_index: 0,
          employee_id: "emp-001",
          expense_date: "2026-06-21",
          outcome: "missing_evidence" as const,
          rule_id: "rule-meal-cap-exception",
          matching_rule_ids: ["rule-meal-cap-exception"],
          reason: "Domestic meals are capped at $75 per day.",
          policy_limit: "75",
          actual_value: "100.00",
          missing_evidence_fields: ["manager_approval"],
          evidence: [mealCapCitation],
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/compliance-evaluation-runs/compliance-run-1") {
          return jsonResponse(missingEvidenceRun);
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(
      <ComplianceEvaluationRunCatalog
        principal={viewerPrincipal}
        initialRunId="compliance-run-1"
      />,
    );

    expect(await screen.findByText("Missing evidence")).toBeInTheDocument();
    const missingEvidenceRow = screen.getByText("emp-001").closest("tr");
    expect(missingEvidenceRow).not.toBeNull();
    expect(
      within(missingEvidenceRow as HTMLElement).getByText("100.00"),
    ).toBeInTheDocument();
    expect(screen.getByText("manager_approval")).toBeInTheDocument();
    expect(screen.getByTitle("rule-meal-cap-exception")).toBeInTheDocument();
  });

  it("paginates expense outcomes on the run detail page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/compliance-evaluation-runs/compliance-run-1") {
          return jsonResponse(buildSampleRunWithOutcomes(15));
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(
      <ComplianceEvaluationRunCatalog
        principal={viewerPrincipal}
        initialRunId="compliance-run-1"
      />,
    );

    expect(await screen.findByText("1–10 of 15 outcomes")).toBeInTheDocument();
    expect(screen.getAllByText("Violation")).toHaveLength(10);

    await userEvent.click(
      screen.getByRole("button", { name: "Next page of outcomes" }),
    );

    expect(await screen.findByText("11–15 of 15 outcomes")).toBeInTheDocument();
    expect(screen.getAllByText("Violation")).toHaveLength(5);
  });

  it("lists evaluation runs aggregated across expense reports", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/expense-reports") {
          return jsonResponse({
            items: [
              {
                expense_report_id: "expense-report-1",
                imported_by: "admin-user",
                source_filename: "expenses.csv",
                row_count: 2,
                created_at: "2026-06-22T11:00:00Z",
              },
            ],
          });
        }
        if (
          url === "/api/expense-reports/expense-report-1/compliance-evaluation-runs"
        ) {
          return jsonResponse({
            expense_report_id: "expense-report-1",
            items: [sampleRun],
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(<ComplianceEvaluationRunCatalog principal={viewerPrincipal} />);

    expect(
      await screen.findByRole("button", { name: "Open compliance-run-1" }),
    ).toBeInTheDocument();
    expect(screen.getByText("policy-v1")).toBeInTheDocument();
    expect(screen.getByText("1 pass")).toBeInTheDocument();
    expect(screen.getByText("1 violation")).toBeInTheDocument();
  });

  it("opens run detail from the catalog", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/expense-reports") {
        return jsonResponse({
          items: [
            {
              expense_report_id: "expense-report-1",
              imported_by: "admin-user",
              source_filename: "expenses.csv",
              row_count: 2,
              created_at: "2026-06-22T11:00:00Z",
            },
          ],
        });
      }
      if (
        url === "/api/expense-reports/expense-report-1/compliance-evaluation-runs"
      ) {
        return jsonResponse({
          expense_report_id: "expense-report-1",
          items: [sampleRun],
        });
      }
      if (url === "/api/compliance-evaluation-runs/compliance-run-1") {
        return jsonResponse(sampleRun);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ComplianceEvaluationRunCatalog principal={viewerPrincipal} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Open compliance-run-1" }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/compliance-evaluation-runs/compliance-run-1",
        expect.any(Object),
      );
    });
    expect(await screen.findByText("Violation")).toBeInTheDocument();
  });
});
