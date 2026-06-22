import { render, screen, waitFor } from "@testing-library/react";
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
  },
  row_outcomes: [
    {
      row_index: 0,
      employee_id: "emp-001",
      expense_date: "2026-06-21",
      outcome: "pass",
      rule_id: null,
      reason: null,
    },
    {
      row_index: 1,
      employee_id: "emp-002",
      expense_date: "2026-06-21",
      outcome: "violation",
      rule_id: "rule-meals-cap",
      reason: "Amount exceeds meal cap.",
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
    },
    row_outcomes: Array.from({ length: outcomeCount }, (_, index) => ({
      row_index: index,
      employee_id: "E1001",
      expense_date: "2026-05-01",
      outcome: "violation" as const,
      rule_id: "rule-meals-cap",
      reason: "Amount exceeds meal cap.",
    })),
  };
}

describe("ComplianceEvaluationSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("executes a compliance evaluation run for admins", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/compiled-rule-sets") {
        return jsonResponse({
          items: [
            {
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
            },
          ],
        });
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

    expect(
      await screen.findByRole("button", { name: "Run compliance check" }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Run compliance check" }));

    expect(await screen.findByText("1 pass")).toBeInTheDocument();
    expect(screen.getByText("1 violation")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/expense-reports/expense-report-1/compliance-evaluation-runs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ compiled_rule_set_id: "compiled-set-1" }),
      }),
    );
  });

  it("shows actionable errors when the compiled rule set is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url === "/api/compiled-rule-sets") {
          return jsonResponse({
            items: [
              {
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
              },
            ],
          });
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
          return errorResponse(404, {
            detail: "Compiled Rule Set was not found.",
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

    await userEvent.click(
      await screen.findByRole("button", { name: "Run compliance check" }),
    );

    expect(
      await screen.findByText(
        "Compiled Rule Set was not found. Compile a published Policy Version before running compliance checks.",
      ),
    ).toBeInTheDocument();
  });

  it("paginates compliance evaluation runs on the expense report detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/compiled-rule-sets") {
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
        if (url === "/api/compiled-rule-sets") {
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
    expect(screen.getByText("emp-002")).toBeInTheDocument();
    expect(screen.getByText("Amount exceeds meal cap.")).toBeInTheDocument();
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
