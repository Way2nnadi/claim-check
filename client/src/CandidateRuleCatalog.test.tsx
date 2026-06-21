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

describe("CandidateRuleCatalog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads and renders candidate rules with lifecycle and QA metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
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
            json: async () => sampleReviews,
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(<CandidateRuleCatalog principal={principal} />);

    expect(await screen.findByText("rule-meals-cap")).toBeInTheDocument();
    expect(screen.getByText("Extracted")).toBeInTheDocument();
    expect(screen.getByText("Enforceable")).toBeInTheDocument();
    expect(screen.getByText("1 QA")).toBeInTheDocument();
    expect(screen.getByText(/Meals are capped at \$75 per day/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Queue/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Flagged/i })).toHaveTextContent("1");
  });

  it("filters flagged rules client-side and applies scope via the scope panel", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/policy-documents") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      if (url.startsWith("/api/candidate-rules")) {
        return Promise.resolve({
          ok: true,
          json: async () => sampleReviews,
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CandidateRuleCatalog principal={principal} />);

    await screen.findByText("rule-meals-cap");
    await userEvent.click(screen.getByRole("tab", { name: /Flagged/i }));
    expect(screen.getByText("rule-meals-cap")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Scope filters"));
    const documentInput = screen.getByRole("combobox", { name: "Document" });
    await userEvent.type(documentInput, "expense-policy");
    await userEvent.type(screen.getByLabelText("Document version id"), "docv-expense-v1");
    await userEvent.type(screen.getByLabelText("Extraction run id"), "extract-expense-v1");
    await userEvent.click(screen.getByRole("button", { name: "Apply scope" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/candidate-rules?document_id=expense-policy&document_version_id=docv-expense-v1&extraction_run_id=extract-expense-v1",
        expect.any(Object),
      );
    });
  });

  it("filters lifecycle tabs client-side without refetching", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/policy-documents") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      if (url === "/api/candidate-rules") {
        return Promise.resolve({
          ok: true,
          json: async () => sampleReviews,
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CandidateRuleCatalog principal={principal} />);

    await screen.findByText("rule-meals-cap");
    const listFetchCountAfterInitialLoad = fetchMock.mock.calls.filter(
      ([url]) => url === "/api/candidate-rules",
    ).length;

    await userEvent.click(screen.getByRole("tab", { name: /Custom/i }));
    await userEvent.click(screen.getByLabelText("Extracted"));
    await userEvent.click(screen.getByLabelText("In review"));
    await userEvent.click(screen.getByLabelText("Published"));

    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/candidate-rules")).toHaveLength(
      listFetchCountAfterInitialLoad,
    );
    expect(screen.queryByText("rule-meals-cap")).not.toBeInTheDocument();
  });

  it("opens a split-pane review screen when a row is selected", async () => {
    const sectionsResponse = {
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
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/policy-documents") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ items: [] }),
          });
        }
        if (url === "/api/candidate-rules") {
          return Promise.resolve({
            ok: true,
            json: async () => sampleReviews,
          });
        }
        if (url === "/api/candidate-rules/rule-meals-cap") {
          return Promise.resolve({
            ok: true,
            json: async () => sampleReviews.items[0],
          });
        }
        if (
          url ===
          "/api/policy-documents/expense-policy/versions/docv-expense-v1/sections"
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => sectionsResponse,
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(<CandidateRuleCatalog principal={principal} />);

    await userEvent.click(await screen.findByRole("button", { name: /rule-meals-cap/i }));

    expect(await screen.findByText("Candidate Rule edit desk")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Candidate Rules" })).toBeInTheDocument();
    expect(screen.getByText("QA Flags")).toBeInTheDocument();
    expect(
      screen.getAllByText("Candidate Rule extraction confidence 0.62 is below 0.75."),
    ).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Save Candidate Rule" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: /Meals are capped at \$75 per day/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Source document" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Extracted rule" })).toBeInTheDocument();
    expect(screen.getByText("Extracted rule")).toBeInTheDocument();
    expect(screen.getByText(/Enforceable · per day · money · USD/)).toBeInTheDocument();
    expect(screen.getByText("Extraction confidence")).toBeInTheDocument();
    expect(screen.getAllByText("Low Extraction Confidence")).toHaveLength(2);
    expect(document.querySelector(".review-source-passage")).toHaveTextContent(
      "Meals are capped at $75 per day.",
    );
    expect(screen.getByRole("button", { name: "Browse sections (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More context" })).toBeInTheDocument();
  });

  it("lets the approver clear the current selection without immediately reopening the first Candidate Rule", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/policy-documents") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ items: [] }),
          });
        }
        if (url === "/api/candidate-rules") {
          return Promise.resolve({
            ok: true,
            json: async () => sampleReviews,
          });
        }
        if (url === "/api/candidate-rules/rule-meals-cap") {
          return Promise.resolve({
            ok: true,
            json: async () => sampleReviews.items[0],
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(<CandidateRuleCatalog principal={principal} />);

    await userEvent.click(await screen.findByRole("button", { name: /rule-meals-cap/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Clear selection" }));

    expect(
      await screen.findByText(
        "Select a Candidate Rule from the queue to compare extracted values, make edits, and save a reviewed Rule.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("QA Flags")).not.toBeInTheDocument();
  });
});
