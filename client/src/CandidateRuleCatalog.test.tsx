import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CandidateRuleCatalog from "./CandidateRuleCatalog";
import type { AuthenticatedPrincipal } from "./types";

const principal: AuthenticatedPrincipal = {
  subject: "approver-user",
  roles: ["approver"],
  auth_backend: "local",
};

const sampleRuns = {
  items: [
    {
      extraction_run_id: "extract-expense-v1",
      document_id: "expense-policy",
      document_version_id: "docv-expense-v1",
      prompt_template_id: "rule-extraction",
      prompt_template_version: "v1",
      model_configuration_id: "fake-openai",
      model_configuration_version: "v1",
      candidate_rule_count: 1,
      created_at: "2026-06-21T10:00:00Z",
      status: "completed" as const,
      failure_detail: null,
    },
  ],
};

const sampleReviews = {
  items: [
    {
      candidate_rule_id: "rule-meals-cap",
      lifecycle_state: "extracted" as const,
      current_rule: {
        rule_id: "rule-meals-cap",
        statement: "Meals are capped at $75 per day.",
        enforceability_class: "enforceable" as const,
        lifecycle_state: "extracted" as const,
        origin: {
          source_type: "extracted" as const,
          extraction_run_id: "extract-expense-v1",
          rationale: null,
        },
        scope: {
          country: null,
          expense_category: "meals",
          travel_type: null,
          employee_group: "employees",
          effective_start_date: null,
          effective_end_date: null,
        },
        citation: {
          document_id: "expense-policy",
          document_version_id: "docv-expense-v1",
          section_id: "meals#abc",
          quote: "Meals are capped at $75 per day.",
          start_char: 0,
          end_char: 32,
        },
        condition: {
          field: "meal.amount",
          operator: "<=",
          value: "75",
        },
        applicability: {
          aggregation_period: "per_day" as const,
          unit: "money",
          currency: "USD",
          limit_basis: "per employee",
        },
        exceptions: [],
      },
      extracted_rule: {
        rule_id: "rule-meals-cap",
        statement: "Meals are capped at $75 per day.",
        enforceability_class: "enforceable" as const,
        lifecycle_state: "extracted" as const,
        origin: {
          source_type: "extracted" as const,
          extraction_run_id: "extract-expense-v1",
          rationale: null,
        },
        scope: {
          country: null,
          expense_category: "meals",
          travel_type: null,
          employee_group: "employees",
          effective_start_date: null,
          effective_end_date: null,
        },
        citation: {
          document_id: "expense-policy",
          document_version_id: "docv-expense-v1",
          section_id: "meals#abc",
          quote: "Meals are capped at $75 per day.",
          start_char: 0,
          end_char: 32,
        },
        condition: {
          field: "meal.amount",
          operator: "<=",
          value: "75",
        },
        applicability: {
          aggregation_period: "per_day" as const,
          unit: "money",
          currency: "USD",
          limit_basis: "per employee",
        },
        exceptions: [],
      },
      committed_rule: null,
      qa_flags: [
        {
          code: "low_extraction_confidence" as const,
          detail: "Candidate Rule extraction confidence 0.62 is below 0.75.",
        },
      ],
    },
  ],
};

function createFetchMock(
  overrides: Partial<Record<string, () => Promise<{ ok: boolean; json: () => Promise<unknown> }>>> = {},
) {
  return vi.fn().mockImplementation((url: string) => {
    if (url === "/api/policy-documents") {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          items: [
            {
              document_id: "expense-policy",
              latest_document_version_id: "docv-expense-v1",
              latest_uploaded_at: "2026-06-21T10:00:00Z",
              version_count: 1,
              active_version_count: 1,
              has_deleted_versions: false,
            },
          ],
        }),
      });
    }
    if (url === "/api/extraction-runs") {
      return Promise.resolve({ ok: true, json: async () => sampleRuns });
    }
    if (url === "/api/candidate-rules") {
      return Promise.resolve({ ok: true, json: async () => sampleReviews });
    }
    if (url === "/api/candidate-rules?extraction_run_id=extract-expense-v1") {
      return Promise.resolve({ ok: true, json: async () => sampleReviews });
    }
    if (url === "/api/candidate-rules/rule-meals-cap") {
      return Promise.resolve({ ok: true, json: async () => sampleReviews.items[0] });
    }
    if (
      url === "/api/policy-documents/expense-policy/versions/docv-expense-v1/sections"
    ) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          items: [
            {
              document_id: "expense-policy",
              document_version_id: "docv-expense-v1",
              section_id: "meals#abc",
              heading_path: ["Travel Policy", "Meals"],
              content: "Meals are capped at $75 per day.",
              start_char: 0,
              end_char: 32,
            },
          ],
        }),
      });
    }
    const override = overrides[url];
    if (override) {
      return override();
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
}

describe("CandidateRuleCatalog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads all candidate rules as the default review screen", async () => {
    vi.stubGlobal("fetch", createFetchMock());

    render(<CandidateRuleCatalog principal={principal} />);

    expect(await screen.findByText(/Meals are capped at \$75 per day/)).toBeInTheDocument();
    expect(screen.getByText("Extracted")).toBeInTheDocument();
    expect(screen.getByText("Scope filters")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Rule statement" })).toBeInTheDocument();
    expect(screen.queryByText("extract-expense-v1")).not.toBeInTheDocument();
  });

  it("filters rules to a specific extraction run when scoped", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CandidateRuleCatalog
        principal={principal}
        extractionRunId="extract-expense-v1"
        onClearExtractionRunScope={() => undefined}
      />,
    );

    expect(await screen.findByText(/Meals are capped at \$75 per day/)).toBeInTheDocument();
    expect(screen.getByText("expense-policy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show all rules" })).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/candidate-rules?extraction_run_id=extract-expense-v1",
        expect.any(Object),
      );
    });
  });

  it("filters lifecycle tabs client-side without refetching rules", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(<CandidateRuleCatalog principal={principal} />);

    await screen.findByText(/Meals are capped at \$75 per day/);

    const rulesFetchCountAfterOpen = fetchMock.mock.calls.filter(([url]) =>
      url.startsWith("/api/candidate-rules"),
    ).length;

    await userEvent.click(screen.getByRole("tab", { name: /Custom/i }));
    await userEvent.click(screen.getByLabelText("Extracted"));
    await userEvent.click(screen.getByLabelText("In review"));
    await userEvent.click(screen.getByLabelText("Published"));

    expect(
      fetchMock.mock.calls.filter(([url]) => url.startsWith("/api/candidate-rules")),
    ).toHaveLength(rulesFetchCountAfterOpen);
    expect(screen.queryByText(/Meals are capped at \$75 per day/)).not.toBeInTheDocument();
  });

  it("opens a full-page edit desk when a rule is opened", async () => {
    vi.stubGlobal("fetch", createFetchMock());

    render(<CandidateRuleCatalog principal={principal} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Open dossier for Meals are capped at \$75 per day/i }),
    );

    expect(await screen.findByText("rule-meals-cap")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "QA flags" })).toBeInTheDocument();
    expect(
      screen.getAllByText("Candidate Rule extraction confidence 0.62 is below 0.75."),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Save Candidate Rule" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Expense Policy" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Statement")).toHaveValue("Meals are capped at $75 per day.");
  });

  it("returns to the rule list from the edit desk", async () => {
    vi.stubGlobal("fetch", createFetchMock());

    render(<CandidateRuleCatalog principal={principal} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Open dossier for Meals are capped at \$75 per day/i }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "← Back to rules" }));

    expect(await screen.findByText(/Meals are capped at \$75 per day/)).toBeInTheDocument();
    expect(screen.queryByText("QA Flags")).not.toBeInTheDocument();
  });

  it("applies document scope filters to candidate rules", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(<CandidateRuleCatalog principal={principal} />);

    await screen.findByText(/Meals are capped at \$75 per day/);
    await userEvent.click(screen.getByText("Scope filters"));
    const documentInput = screen.getByRole("combobox", { name: "Document" });
    await userEvent.type(documentInput, "expense-policy");
    await userEvent.type(screen.getByLabelText("Document version id"), "docv-expense-v1");
    await userEvent.click(screen.getByRole("button", { name: "Apply scope" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/candidate-rules?document_id=expense-policy&document_version_id=docv-expense-v1",
        expect.any(Object),
      );
    });
  });
});
