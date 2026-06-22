import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ManualRulesPage from "./ManualRulesPage";
import type { AuthenticatedPrincipal, Role } from "./types";

function makePrincipal(role: Role): AuthenticatedPrincipal {
  return {
    subject: `${role}-user`,
    roles: [role],
    auth_backend: "local",
  };
}

const createdManualRule = {
  rule_id: "rule-manual-offsite-dinner-cap",
  statement: "Team offsites may reimburse dinner up to $120 with director approval.",
  enforceability_class: "enforceable",
  lifecycle_state: "approved",
  origin: {
    source_type: "manual",
    extraction_run_id: null,
    rationale:
      "Finance approved a temporary offsite exception not yet reflected in the Policy Document.",
  },
  scope: {
    country: null,
    expense_category: "meals",
    travel_type: null,
    employee_group: "employees",
    effective_start_date: null,
    effective_end_date: null,
  },
  citation: null,
  condition: {
    field: "meal.amount",
    operator: "<=",
    value: "120",
  },
  applicability: {
    aggregation_period: "per_transaction",
    unit: "money",
    currency: "USD",
    limit_basis: "per employee",
  },
  exceptions: [
    {
      description: "Director approval is required.",
      required_evidence: ["director_approval"],
    },
  ],
};

describe("ManualRulesPage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  describe.each(["admin", "approver"] satisfies Role[])(
    "as %s",
    (role) => {
      it(
        "creates a Manual Rule with optional Citation omitted and shows the human-authored result",
        async () => {
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => createdManualRule,
        });
        vi.stubGlobal("fetch", fetchMock);

        render(<ManualRulesPage principal={makePrincipal(role)} />);

        fireEvent.change(screen.getByLabelText("Rule ID"), {
          target: { value: createdManualRule.rule_id },
        });
        fireEvent.change(screen.getByLabelText("Statement"), {
          target: { value: createdManualRule.statement },
        });
        fireEvent.change(screen.getByLabelText("Rationale"), {
          target: { value: createdManualRule.origin.rationale },
        });
        fireEvent.change(screen.getByLabelText("Expense category"), {
          target: { value: "meals" },
        });
        fireEvent.change(screen.getByLabelText("Employee group"), {
          target: { value: "employees" },
        });
        fireEvent.change(screen.getByLabelText("Condition field"), {
          target: { value: "meal.amount" },
        });
        fireEvent.change(screen.getByLabelText("Operator"), {
          target: { value: "<=" },
        });
        fireEvent.change(screen.getByLabelText("Threshold value"), {
          target: { value: "120" },
        });
        fireEvent.change(screen.getByLabelText("Aggregation period"), {
          target: { value: "per_transaction" },
        });
        fireEvent.change(screen.getByLabelText("Unit"), {
          target: { value: "money" },
        });
        fireEvent.change(screen.getByLabelText("Currency"), {
          target: { value: "USD" },
        });
        fireEvent.change(screen.getByLabelText("Limit basis"), {
          target: { value: "per employee" },
        });
        fireEvent.change(screen.getByLabelText("Exception"), {
          target: { value: "Director approval is required." },
        });
        fireEvent.change(screen.getByLabelText("Required evidence"), {
          target: { value: "director_approval" },
        });

        await userEvent.click(
          screen.getByRole("button", { name: "Create Manual Rule" }),
        );

        await waitFor(() => {
          expect(fetchMock).toHaveBeenCalledWith(
            "/api/rules/manual",
            expect.any(Object),
          );
        });
        const [, request] = fetchMock.mock.calls[0] ?? [];
        const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
        expect(request?.method).toBe("POST");
        expect(body).toMatchObject({
          rule_id: "rule-manual-offsite-dinner-cap",
          statement:
            "Team offsites may reimburse dinner up to $120 with director approval.",
          enforceability_class: "enforceable",
          rationale:
            "Finance approved a temporary offsite exception not yet reflected in the Policy Document.",
          scope: {
            expense_category: "meals",
            employee_group: "employees",
          },
          condition: {
            field: "meal.amount",
            operator: "<=",
            value: "120",
          },
          applicability: {
            aggregation_period: "per_transaction",
            unit: "money",
            currency: "USD",
            limit_basis: "per employee",
          },
          exceptions: [
            {
              description: "Director approval is required.",
              required_evidence: ["director_approval"],
            },
          ],
        });
        expect(body).not.toHaveProperty("citation");

        expect(
          await screen.findByText("Manual Rule created and approved."),
        ).toBeInTheDocument();
        expect(screen.getAllByText("Human-authored")).not.toHaveLength(0);
        expect(screen.getByText(createdManualRule.statement)).toBeInTheDocument();
        },
        10000,
      );
    },
  );

  it("surfaces validation errors clearly before submission", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<ManualRulesPage principal={makePrincipal("approver")} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Create Manual Rule" }),
    );

    expect(
      await screen.findByText("Rule ID is required."),
    ).toBeInTheDocument();
    expect(screen.getByText("Statement is required.")).toBeInTheDocument();
    expect(screen.getByText("Rationale is required.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables creation for viewer clearance", () => {
    vi.stubGlobal("fetch", vi.fn());

    render(<ManualRulesPage principal={makePrincipal("viewer")} />);

    expect(screen.getByRole("button", { name: "Create Manual Rule" })).toBeDisabled();
    expect(screen.getByText("Viewer access")).toBeInTheDocument();
  });
});
