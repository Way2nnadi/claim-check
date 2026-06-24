import type { CandidateRuleReview } from "./types";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedPrincipal } from "../shared/auth/types";
import userEvent from "@testing-library/user-event";

import CandidateRuleCatalog from "./CandidateRuleCatalog";

const principal: AuthenticatedPrincipal = {
  subject: "approver-user",
  roles: ["approver"],
  auth_backend: "local",
};

const viewerPrincipal: AuthenticatedPrincipal = {
  subject: "viewer-user",
  roles: ["viewer"],
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
    reingestion_diff_category: null,
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
    const override = overrides[url];
    if (override) {
      return override();
    }
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
    expect(screen.getByText("1 awaiting review")).toBeInTheDocument();
    expect(screen.getByText("Enforceable")).toBeInTheDocument();
    expect(screen.getByText("Scope filters")).toBeInTheDocument();
    expect(document.getElementById("review-rule-panel")).toBeInTheDocument();
    expect(screen.queryByText("extract-expense-v1")).not.toBeInTheDocument();
  });

  it("supports keyboard navigation across the review queue", async () => {
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
      },
      extracted_rule: {
        ...buildReview().extracted_rule,
        rule_id: "rule-lodging-cap",
        statement: "Lodging is capped at $250 per night.",
        scope: {
          ...buildReview().extracted_rule.scope,
          expense_category: "lodging",
        },
      },
      qa_flags: [],
    });
    vi.stubGlobal(
      "fetch",
      createFetchMock({
        "/api/candidate-rules": async () => ({
          ok: true,
          json: async () => ({
            items: [buildReview(), secondReview],
          }),
        }),
      }),
    );
    const user = userEvent.setup();

    render(<CandidateRuleCatalog principal={principal} />);

    const firstRow = (await screen.findByText("Meals are capped at $75 per day.")).closest(
      "article",
    );
    const secondRow = screen.getByText("Lodging is capped at $250 per night.").closest(
      "article",
    );

    expect(firstRow).not.toBeNull();
    expect(secondRow).not.toBeNull();

    firstRow?.focus();
    expect(firstRow).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(secondRow).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(firstRow).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(await screen.findByRole("button", { name: "Save Candidate Rule" })).toBeInTheDocument();
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
    expect(screen.getByText("extract-expense-v1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();

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

    await userEvent.click(screen.getByRole("tab", { name: /Archive/i }));

    expect(
      fetchMock.mock.calls.filter(([url]) => url.startsWith("/api/candidate-rules")),
    ).toHaveLength(rulesFetchCountAfterOpen);
    expect(screen.queryByText(/Meals are capped at \$75 per day/)).not.toBeInTheDocument();
  });

  it("opens a full-page edit desk when edit is clicked", async () => {
    vi.stubGlobal("fetch", createFetchMock());

    render(<CandidateRuleCatalog principal={principal} />);

    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(
      screen.getByRole("button", { name: "Copy ID rule-meals-cap" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tabpanel", { name: "Candidate Rule review queue" })).not.toBeInTheDocument();
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

  it("does not open the edit desk when the queue row itself is clicked", async () => {
    vi.stubGlobal("fetch", createFetchMock());

    render(<CandidateRuleCatalog principal={principal} />);

    await userEvent.click(await screen.findByText(/Meals are capped at \$75 per day/));

    expect(document.getElementById("review-rule-panel")).toBeInTheDocument();
    expect(screen.queryByLabelText("Statement")).not.toBeInTheDocument();
  });

  it("returns to the review queue from the edit desk", async () => {
    vi.stubGlobal("fetch", createFetchMock());

    render(<CandidateRuleCatalog principal={principal} />);

    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await userEvent.click(await screen.findByRole("button", { name: "Queue" }));

    expect(await screen.findByText(/Meals are capped at \$75 per day/)).toBeInTheDocument();
    expect(document.getElementById("review-rule-panel")).toBeInTheDocument();
  });

  it("applies document scope filters to candidate rules", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(<CandidateRuleCatalog principal={principal} />);

    await screen.findByText(/Meals are capped at \$75 per day/);
    await userEvent.click(screen.getByText("Scope filters"));
    const documentInput = screen.getByRole("combobox", { name: "Document" });
    await userEvent.type(documentInput, "expense-policy");
    await userEvent.type(screen.getByLabelText("Document version"), "docv-expense-v1");
    await userEvent.click(screen.getByRole("button", { name: "Apply scope" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/candidate-rules?document_id=expense-policy&document_version_id=docv-expense-v1",
        expect.any(Object),
      );
    });
  });

  it("bulk approves selected low-risk Candidate Rules and leaves changed rows out of the batch", async () => {
    const firstReview = buildReview({
      qa_flags: [],
      reingestion_diff_category: "unchanged",
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
      reingestion_diff_category: "changed",
    });

    let queueRefreshCount = 0;
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
        queueRefreshCount += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: queueRefreshCount === 1 ? [firstReview, secondReview] : [],
          }),
        });
      }
      if (url === "/api/candidate-rules/approvals/bulk" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            approved_candidate_rule_ids: ["rule-meals-cap"],
            failed_candidate_rules: [],
            status: "approved",
            recorded_by: "approver-user",
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CandidateRuleCatalog principal={principal} />);

    expect(await screen.findByText("Unchanged")).toBeInTheDocument();
    expect(screen.getByText("Changed")).toBeInTheDocument();
    expect(screen.getByText("1 low-risk rule ready for batch approval")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "Select Candidate Rule rule-meals-cap" }));
    expect(screen.getByRole("checkbox", { name: "Select Candidate Rule rule-lodging-cap" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Approve selected" }));
    await userEvent.type(
      screen.getByLabelText("Bulk approval rationale"),
      "Citation verified and unchanged Candidate Rules approved together.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm bulk approval" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/candidate-rules/approvals/bulk",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            candidate_rule_ids: ["rule-meals-cap"],
            rationale: "Citation verified and unchanged Candidate Rules approved together.",
          }),
        }),
      );
    });

    expect(
      await screen.findByText("1 Candidate Rule approved. The queue has been refreshed."),
    ).toBeInTheDocument();
    expect(screen.getByText(/The review queue is empty/)).toBeInTheDocument();
  });

  it("disables bulk approve for the viewer role", async () => {
    vi.stubGlobal("fetch", createFetchMock());

    render(<CandidateRuleCatalog principal={viewerPrincipal} />);

    await screen.findByText(/Meals are capped at \$75 per day/);
    expect(screen.getByRole("checkbox", { name: "Select all low-risk visible Candidate Rules" })).toBeDisabled();
    expect(
      screen.getByText("Viewers can inspect the queue but cannot approve rules"),
    ).toBeInTheDocument();
  });

  it("surfaces partial bulk approval failures clearly", async () => {
    const firstReview = buildReview({
      qa_flags: [],
      reingestion_diff_category: "unchanged",
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
      reingestion_diff_category: "unchanged",
    });

    let queueRefreshCount = 0;
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
        queueRefreshCount += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: queueRefreshCount === 1 ? [firstReview, secondReview] : [secondReview],
          }),
        });
      }
      if (url === "/api/candidate-rules/approvals/bulk" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            approved_candidate_rule_ids: ["rule-meals-cap"],
            failed_candidate_rules: [
              {
                candidate_rule_id: "rule-lodging-cap",
                detail: "Candidate Rule cannot transition from approved to approved.",
              },
            ],
            status: "partial",
            recorded_by: "approver-user",
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CandidateRuleCatalog principal={principal} />);

    await screen.findByText(/Meals are capped at \$75 per day/);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Candidate Rule rule-meals-cap" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Candidate Rule rule-lodging-cap" }));
    await userEvent.click(screen.getByRole("button", { name: "Approve selected" }));
    await userEvent.type(
      screen.getByLabelText("Bulk approval rationale"),
      "Bulk approval after re-ingestion review.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm bulk approval" }));

    expect(
      await screen.findByText("1 Candidate Rule approved. 1 could not be approved."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("rule-lodging-cap: Candidate Rule cannot transition from approved to approved."),
    ).toBeInTheDocument();
    expect(screen.getByText("Lodging is capped at $250 per night.")).toBeInTheDocument();
  });

  it("approves a queue item from the row action and removes it from the queue tab", async () => {
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

    const [approveButton] = await screen.findAllByRole("button", { name: "Approve" });
    if (!approveButton) {
      throw new Error("Expected an approve button.");
    }
    await userEvent.click(approveButton);
    await userEvent.type(screen.getByLabelText("Rationale"), "Citation verified and threshold confirmed.");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("Lodging is capped at $250 per night.")).toBeInTheDocument();
    expect(screen.queryByText(/Meals are capped at \$75 per day/)).not.toBeInTheDocument();
    expect(document.getElementById("review-rule-panel")).toBeInTheDocument();
  });

  it("rejects a queue item from the row action and removes it from the queue tab", async () => {
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

    const [rejectButton] = await screen.findAllByRole("button", { name: "Reject" });
    if (!rejectButton) {
      throw new Error("Expected a reject button.");
    }
    await userEvent.click(rejectButton);
    await userEvent.type(
      screen.getByLabelText("Reason"),
      "This statement duplicates a stricter Rule already approved elsewhere.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("Airfare must be booked in economy class.")).toBeInTheDocument();
    expect(screen.queryByText(/Meals are capped at \$75 per day/)).not.toBeInTheDocument();
    expect(document.getElementById("review-rule-panel")).toBeInTheDocument();
  });
});
