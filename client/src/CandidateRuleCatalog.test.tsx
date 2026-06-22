import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CandidateRuleCatalog from "./CandidateRuleCatalog";
import type { AuthenticatedPrincipal, CandidateRuleReview } from "./types";

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

function buildReview(
  overrides: Partial<CandidateRuleReview> = {},
): CandidateRuleReview {
  return {
    candidate_rule_id: "rule-meals-cap",
    lifecycle_state: "extracted",
    current_rule: {
      rule_id: "rule-meals-cap",
      statement: "Meals are capped at $75 per day.",
      enforceability_class: "enforceable",
      lifecycle_state: "extracted",
      origin: {
        source_type: "extracted",
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
        aggregation_period: "per_day",
        unit: "money",
        currency: "USD",
        limit_basis: "per employee",
      },
      exceptions: [],
    },
    extracted_rule: {
      rule_id: "rule-meals-cap",
      statement: "Meals are capped at $75 per day.",
      enforceability_class: "enforceable",
      lifecycle_state: "extracted",
      origin: {
        source_type: "extracted",
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
        aggregation_period: "per_day",
        unit: "money",
        currency: "USD",
        limit_basis: "per employee",
      },
      exceptions: [],
    },
    committed_rule: null,
    qa_flags: [
      {
        code: "low_extraction_confidence",
        detail: "Candidate Rule extraction confidence 0.62 is below 0.75.",
      },
    ],
    ...overrides,
  };
}

const sampleReviews = {
  items: [buildReview()],
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
    expect(screen.getByRole("table", { name: "Candidate Rule review queue" })).toBeInTheDocument();
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

  it("clears the current selection from the review workbench", async () => {
    vi.stubGlobal("fetch", createFetchMock());

    render(<CandidateRuleCatalog principal={principal} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Open dossier for Meals are capped at \$75 per day/i }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Clear selection" }));

    expect(await screen.findByText(/Meals are capped at \$75 per day/)).toBeInTheDocument();
    expect(screen.getByText("Choose a Candidate Rule to inspect source, QA flags, and review deltas.")).toBeInTheDocument();
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

  it("advances to the next filtered queue item after approval", async () => {
    const firstReview = buildReview();
    const approvedFirstReview = buildReview({
      lifecycle_state: "approved",
      current_rule: {
        ...buildReview().current_rule,
        lifecycle_state: "approved",
      },
      committed_rule: {
        ...buildReview().current_rule,
        lifecycle_state: "approved",
      },
    });
    const secondReview = buildReview({
      candidate_rule_id: "rule-lodging-cap",
      current_rule: {
        ...buildReview().current_rule,
        rule_id: "rule-lodging-cap",
        statement: "Lodging is capped at $250 per night.",
        scope: {
          ...buildReview().current_rule.scope,
          expense_category: "lodging",
        },
        citation: {
          document_id: "expense-policy",
          document_version_id: "docv-expense-v1",
          section_id: "lodging#xyz",
          quote: "Lodging is capped at $250 per night.",
          start_char: 33,
          end_char: 69,
        },
        condition: {
          field: "lodging.amount",
          operator: "<=",
          value: "250",
        },
        applicability: {
          aggregation_period: "per_night",
          unit: "money",
          currency: "USD",
          limit_basis: "per room",
        },
      },
      extracted_rule: {
        ...buildReview().extracted_rule,
        rule_id: "rule-lodging-cap",
        statement: "Lodging is capped at $250 per night.",
        scope: {
          ...buildReview().extracted_rule.scope,
          expense_category: "lodging",
        },
        citation: {
          document_id: "expense-policy",
          document_version_id: "docv-expense-v1",
          section_id: "lodging#xyz",
          quote: "Lodging is capped at $250 per night.",
          start_char: 33,
          end_char: 69,
        },
        condition: {
          field: "lodging.amount",
          operator: "<=",
          value: "250",
        },
        applicability: {
          aggregation_period: "per_night",
          unit: "money",
          currency: "USD",
          limit_basis: "per room",
        },
      },
      qa_flags: [],
    });

    let approved = false;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
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
      if (url === "/api/candidate-rules") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [firstReview, secondReview] }),
        });
      }
      if (url === "/api/candidate-rules/rule-meals-cap" && (!init?.method || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: async () => (approved ? approvedFirstReview : firstReview),
        });
      }
      if (url === "/api/candidate-rules/rule-lodging-cap") {
        return Promise.resolve({
          ok: true,
          json: async () => secondReview,
        });
      }
      if (url === "/api/candidate-rules/rule-meals-cap/approvals" && init?.method === "POST") {
        approved = true;
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            candidate_rule_id: "rule-meals-cap",
            status: "approved",
            recorded_by: "approver-user",
          }),
        });
      }
      if (url === "/api/policy-documents/expense-policy/versions/docv-expense-v1/sections") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              {
                document_id: "expense-policy",
                document_version_id: "docv-expense-v1",
                section_id: "meals#abc",
                heading_path: ["Travel Policy", "Meals"],
                content: "Meals are capped at $75 per day. Lodging is capped at $250 per night.",
                start_char: 0,
                end_char: 69,
              },
              {
                document_id: "expense-policy",
                document_version_id: "docv-expense-v1",
                section_id: "lodging#xyz",
                heading_path: ["Travel Policy", "Lodging"],
                content: "Meals are capped at $75 per day. Lodging is capped at $250 per night.",
                start_char: 0,
                end_char: 69,
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CandidateRuleCatalog principal={principal} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Open dossier for Meals are capped at \$75 per day/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Approve Candidate Rule" }));
    await userEvent.type(screen.getByLabelText("Approval rationale"), "Citation verified and threshold confirmed.");
    await userEvent.click(screen.getByRole("button", { name: "Confirm approval" }));

    expect(
      await screen.findByRole("heading", { level: 3, name: "Expense Policy" }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("Statement")).toHaveValue("Lodging is capped at $250 per night.");
  });

  it("advances to the next filtered queue item after rejection", async () => {
    const firstReview = buildReview();
    const rejectedFirstReview = buildReview({
      lifecycle_state: "rejected",
      current_rule: {
        ...buildReview().current_rule,
        lifecycle_state: "rejected",
      },
      committed_rule: {
        ...buildReview().current_rule,
        lifecycle_state: "rejected",
      },
    });
    const secondReview = buildReview({
      candidate_rule_id: "rule-airfare-cap",
      current_rule: {
        ...buildReview().current_rule,
        rule_id: "rule-airfare-cap",
        statement: "Airfare must be booked in economy class.",
        scope: {
          ...buildReview().current_rule.scope,
          expense_category: "airfare",
        },
        citation: {
          document_id: "expense-policy",
          document_version_id: "docv-expense-v1",
          section_id: "airfare#xyz",
          quote: "Airfare must be booked in economy class.",
          start_char: 70,
          end_char: 111,
        },
        condition: {
          field: "airfare.cabin_class",
          operator: "=",
          value: "economy",
        },
        applicability: {
          aggregation_period: "per_transaction",
          unit: "booking",
          currency: null,
          limit_basis: null,
        },
      },
      extracted_rule: {
        ...buildReview().extracted_rule,
        rule_id: "rule-airfare-cap",
        statement: "Airfare must be booked in economy class.",
        scope: {
          ...buildReview().extracted_rule.scope,
          expense_category: "airfare",
        },
        citation: {
          document_id: "expense-policy",
          document_version_id: "docv-expense-v1",
          section_id: "airfare#xyz",
          quote: "Airfare must be booked in economy class.",
          start_char: 70,
          end_char: 111,
        },
        condition: {
          field: "airfare.cabin_class",
          operator: "=",
          value: "economy",
        },
        applicability: {
          aggregation_period: "per_transaction",
          unit: "booking",
          currency: null,
          limit_basis: null,
        },
      },
      qa_flags: [],
    });

    let rejected = false;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
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
      if (url === "/api/candidate-rules") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [firstReview, secondReview] }),
        });
      }
      if (url === "/api/candidate-rules/rule-meals-cap" && (!init?.method || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: async () => (rejected ? rejectedFirstReview : firstReview),
        });
      }
      if (url === "/api/candidate-rules/rule-airfare-cap") {
        return Promise.resolve({
          ok: true,
          json: async () => secondReview,
        });
      }
      if (url === "/api/candidate-rules/rule-meals-cap/rejections" && init?.method === "POST") {
        rejected = true;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            candidate_rule_id: "rule-meals-cap",
            status: "rejected",
            recorded_by: "approver-user",
          }),
        });
      }
      if (url === "/api/policy-documents/expense-policy/versions/docv-expense-v1/sections") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              {
                document_id: "expense-policy",
                document_version_id: "docv-expense-v1",
                section_id: "meals#abc",
                heading_path: ["Travel Policy", "Meals"],
                content: "Meals are capped at $75 per day. Airfare must be booked in economy class.",
                start_char: 0,
                end_char: 111,
              },
              {
                document_id: "expense-policy",
                document_version_id: "docv-expense-v1",
                section_id: "airfare#xyz",
                heading_path: ["Travel Policy", "Airfare"],
                content: "Meals are capped at $75 per day. Airfare must be booked in economy class.",
                start_char: 0,
                end_char: 111,
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CandidateRuleCatalog principal={principal} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Open dossier for Meals are capped at \$75 per day/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Reject Candidate Rule" }));
    await userEvent.type(
      screen.getByLabelText("Rejection reason"),
      "This statement duplicates a stricter Rule already approved elsewhere.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));

    expect(await screen.findByLabelText("Statement")).toHaveValue("Airfare must be booked in economy class.");
  });
});
