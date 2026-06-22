import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExpenseReportsPage from "./ExpenseReportsPage";
import type { AuthenticatedPrincipal } from "./types";

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

describe("ExpenseReportsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uploads a valid CSV for admins and prepends the imported Expense Report", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/expense-reports" && (!init?.method || init.method === "GET")) {
        return jsonResponse({ items: [] });
      }
      if (url === "/api/expense-reports" && init?.method === "POST") {
        return jsonResponse({
          expense_report_id: "expense-report-1",
          imported_by: "admin-user",
          source_filename: "expenses.csv",
          row_count: 1,
          created_at: "2026-06-22T11:00:00Z",
          rows: [
            {
              employee_id: "emp-001",
              expense_date: "2026-06-21",
              expense_category: "meals",
              amount: "42.50",
              currency: "USD",
              country: "us",
              travel_type: "domestic",
              business_purpose: "Team dinner",
              attendee_list: "Alice; Bob",
              manager_approval: true,
              receipt_attached: true,
              trip_id: "trip-7",
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ExpenseReportsPage principal={adminPrincipal} />);

    expect(await screen.findByText("No Expense Reports imported yet.")).toBeInTheDocument();

    const file = new File(
      [
        "employee_id,expense_date,expense_category,amount,currency\nemp-001,2026-06-21,meals,42.50,USD\n",
      ],
      "expenses.csv",
      { type: "text/csv" },
    );

    await userEvent.upload(screen.getByLabelText("Expense Report CSV"), file);
    await userEvent.click(screen.getByRole("button", { name: "Import Expense Report" }));

    expect(await screen.findByText("expense-report-1")).toBeInTheDocument();
    expect(screen.getByText("expenses.csv")).toBeInTheDocument();
    expect(screen.getByText("Team dinner")).toBeInTheDocument();
    expect(screen.getByText("USD")).toBeInTheDocument();
    expect(screen.queryByText("No Expense Reports imported yet.")).not.toBeInTheDocument();
  });

  it("surfaces file and row validation errors returned by the import API", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/expense-reports" && (!init?.method || init.method === "GET")) {
        return jsonResponse({ items: [] });
      }
      if (url === "/api/expense-reports" && init?.method === "POST") {
        return errorResponse(422, {
          detail: "Expense Report import rejected.",
          file_errors: ["Missing required columns: currency."],
          row_errors: [
            {
              row_number: 2,
              errors: [
                "amount is required.",
                "receipt_attached must be a boolean value (true/false, yes/no, 1/0).",
              ],
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ExpenseReportsPage principal={adminPrincipal} />);

    await screen.findByText("No Expense Reports imported yet.");

    const file = new File(
      ["employee_id,expense_date,expense_category,amount\nemp-001,2026-06-21,meals,\n"],
      "expenses.csv",
      { type: "text/csv" },
    );

    await userEvent.upload(screen.getByLabelText("Expense Report CSV"), file);
    await userEvent.click(screen.getByRole("button", { name: "Import Expense Report" }));

    expect(await screen.findByText("Missing required columns: currency.")).toBeInTheDocument();
    expect(screen.getByText("Row 2")).toBeInTheDocument();
    expect(screen.getByText("amount is required.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "receipt_attached must be a boolean value (true/false, yes/no, 1/0).",
      ),
    ).toBeInTheDocument();
  });

  it("keeps import controls disabled for viewer clearance while still listing reports", async () => {
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
                row_count: 1,
                created_at: "2026-06-22T11:00:00Z",
                rows: [
                  {
                    employee_id: "emp-001",
                    expense_date: "2026-06-21",
                    expense_category: "meals",
                    amount: "42.50",
                    currency: "USD",
                    country: null,
                    travel_type: null,
                    business_purpose: null,
                    attendee_list: null,
                    manager_approval: null,
                    receipt_attached: null,
                    trip_id: null,
                  },
                ],
              },
            ],
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(<ExpenseReportsPage principal={viewerPrincipal} />);

    expect(await screen.findByText("expense-report-1")).toBeInTheDocument();
    expect(screen.getByText("Viewer access")).toBeInTheDocument();
    expect(screen.getByLabelText("Expense Report CSV")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import Expense Report" })).toBeDisabled();

    await waitFor(() => {
      expect(screen.getByText("Imported by admin-user")).toBeInTheDocument();
    });
  });
});
