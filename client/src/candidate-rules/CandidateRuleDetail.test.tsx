import type { CandidateRuleReview } from "./types";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedPrincipal } from "../shared/auth/types";
import userEvent from "@testing-library/user-event";

import CandidateRuleDetail from "./CandidateRuleDetail";

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

describe("CandidateRuleDetail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lets an approver edit a Candidate Rule, shows extracted diffs, and saves to in review", async () => {
    const savedReview = buildReview({
      lifecycle_state: "in_review",
      current_rule: {
        ...buildReview().current_rule,
        statement: "Meals are capped at $80 per day.",
        lifecycle_state: "in_review",
        condition: {
          field: "meal.amount",
          operator: "<=",
          value: "80",
        },
      },
      committed_rule: {
        ...buildReview().current_rule,
        statement: "Meals are capped at $80 per day.",
        lifecycle_state: "in_review",
        condition: {
          field: "meal.amount",
          operator: "<=",
          value: "80",
        },
      },
    });

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/candidate-rules/rule-meals-cap" && (!init?.method || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: async () => buildReview(),
        });
      }
      if (url === "/api/candidate-rules/rule-meals-cap" && init?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: async () => savedReview,
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CandidateRuleDetail
        candidateRuleId="rule-meals-cap"
        principal={approverPrincipal}
        onBack={() => undefined}
      />,
    );

    expect(await screen.findByDisplayValue("Meals are capped at $75 per day.")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Statement"));
    await userEvent.type(screen.getByLabelText("Statement"), "Meals are capped at $80 per day.");
    await userEvent.clear(screen.getByLabelText("Value"));
    await userEvent.type(screen.getByLabelText("Value"), "80");

    expect(screen.getAllByText("Was").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "Save Candidate Rule" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/candidate-rules/rule-meals-cap",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            statement: "Meals are capped at $80 per day.",
            condition: {
              field: "meal.amount",
              operator: "<=",
              value: "80",
            },
          }),
        }),
      );
    });

    expect(await screen.findByText("In review")).toBeInTheDocument();
    expect(screen.getByText("Candidate Rule moved to in review.")).toBeInTheDocument();
  });

  it("rejects numeric currency input and hides Was when extraction had no currency", async () => {
    const review = buildReview({
      current_rule: {
        ...buildReview().current_rule,
        applicability: {
          aggregation_period: "per_day",
          unit: "money",
          currency: null,
          limit_basis: "per employee",
        },
      },
      extracted_rule: {
        ...buildReview().extracted_rule,
        applicability: {
          aggregation_period: "per_day",
          unit: "money",
          currency: null,
          limit_basis: "per employee",
        },
      },
    });

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/candidate-rules/rule-meals-cap") {
        return Promise.resolve({
          ok: true,
          json: async () => review,
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CandidateRuleDetail
        candidateRuleId="rule-meals-cap"
        principal={approverPrincipal}
        onBack={() => undefined}
      />,
    );

    const currencyInput = await screen.findByLabelText("Currency");
    await userEvent.type(currencyInput, "100");

    expect(currencyInput).toHaveValue("");
    expect(screen.queryByText("Was")).not.toBeInTheDocument();
  });

  it("disables save controls for viewers", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/candidate-rules/rule-meals-cap") {
        return Promise.resolve({
          ok: true,
          json: async () => buildReview(),
        });
      }
      if (url.startsWith("/api/policy-documents/") && url.endsWith("/sections")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CandidateRuleDetail
        candidateRuleId="rule-meals-cap"
        principal={viewerPrincipal}
        onBack={() => undefined}
      />,
    );

    expect(await screen.findByRole("button", { name: "Save Candidate Rule" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(screen.getByText("Viewer access")).toBeInTheDocument();
  });

  it("surfaces validation errors from the API", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/candidate-rules/rule-meals-cap" && (!init?.method || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: async () => buildReview(),
        });
      }
      if (url === "/api/candidate-rules/rule-meals-cap" && init?.method === "PATCH") {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: async () => ({
            detail:
              "Guidance and subjective Candidate Rules must not include a machine-checkable condition.",
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CandidateRuleDetail
        candidateRuleId="rule-meals-cap"
        principal={approverPrincipal}
        onBack={() => undefined}
      />,
    );

    await screen.findByDisplayValue("Meals are capped at $75 per day.");
    await userEvent.click(
      screen.getByRole("button", { name: "Open Enforceability class list" }),
    );
    await userEvent.click(await screen.findByRole("option", { name: "Guidance" }));
    await userEvent.click(screen.getByRole("button", { name: "Save Candidate Rule" }));

    expect(
      await screen.findByText(
        "Guidance and subjective Candidate Rules must not include a machine-checkable condition.",
      ),
    ).toBeInTheDocument();
  });

  it("blocks approval and rejection while Candidate Rule edits are unsaved", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/candidate-rules/rule-meals-cap") {
        return Promise.resolve({
          ok: true,
          json: async () => buildReview(),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CandidateRuleDetail
        candidateRuleId="rule-meals-cap"
        principal={approverPrincipal}
        onBack={() => undefined}
      />,
    );

    await screen.findByDisplayValue("Meals are capped at $75 per day.");
    await userEvent.clear(screen.getByLabelText("Statement"));
    await userEvent.type(screen.getByLabelText("Statement"), "Meals are capped at $80 per day.");

    expect(screen.getByText("Decision blockers")).toBeInTheDocument();
    expect(screen.getByText("Save your edits first.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  });

  it("requires rationale before approving and posts the approval decision", async () => {
    const approvedReview = buildReview({
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

    let approved = false;
    const onReviewResolved = vi.fn();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/candidate-rules/rule-meals-cap" && (!init?.method || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: async () => (approved ? approvedReview : buildReview()),
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
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CandidateRuleDetail
        candidateRuleId="rule-meals-cap"
        principal={approverPrincipal}
        onBack={() => undefined}
        onReviewResolved={onReviewResolved}
      />,
    );

    await screen.findByDisplayValue("Meals are capped at $75 per day.");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("Rationale is required.")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Rationale"), "Citation verified and threshold confirmed.");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/candidate-rules/rule-meals-cap/approvals",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            rationale: "Citation verified and threshold confirmed.",
          }),
        }),
      );
    });

    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Approved.")).toBeInTheDocument();
    expect(onReviewResolved).toHaveBeenCalledWith("rule-meals-cap", "approved");
  });

  it("surfaces approval blockers before submission and preserves backend errors after submission", async () => {
    const blockedReview = buildReview({
      qa_flags: [
        {
          code: "unresolvable_citation",
          detail: "Candidate Rule Citation quote could not be resolved: Meals are capped at $75 per day.",
        },
      ],
    });
    const fetchBlockedReview = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/candidate-rules/rule-meals-cap") {
        return Promise.resolve({
          ok: true,
          json: async () => blockedReview,
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchBlockedReview);

    const { unmount } = render(
      <CandidateRuleDetail
        candidateRuleId="rule-meals-cap"
        principal={approverPrincipal}
        onBack={() => undefined}
      />,
    );

    await screen.findByDisplayValue("Meals are capped at $75 per day.");
    expect(screen.getByText("Approval blockers")).toBeInTheDocument();
    expect(
      screen.getByText("Resolve the Citation issue before approving this Candidate Rule."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();

    const fetchValidationError = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/candidate-rules/rule-meals-cap" && (!init?.method || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: async () => buildReview(),
        });
      }
      if (url === "/api/candidate-rules/rule-meals-cap/approvals" && init?.method === "POST") {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: async () => ({
            detail: "Value error, Extracted Rule requires a Citation.",
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchValidationError);

    unmount();

    render(
      <CandidateRuleDetail
        candidateRuleId="rule-meals-cap"
        principal={approverPrincipal}
        onBack={() => undefined}
      />,
    );

    await screen.findByDisplayValue("Meals are capped at $75 per day.");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await userEvent.type(screen.getByLabelText("Rationale"), "Citation verified.");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(
      await screen.findByText("Value error, Extracted Rule requires a Citation."),
    ).toBeInTheDocument();
  });

  it("requires a rejection reason before rejecting a Candidate Rule", async () => {
    const rejectedReview = buildReview({
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

    let rejected = false;
    const onReviewResolved = vi.fn();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/candidate-rules/rule-meals-cap" && (!init?.method || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: async () => (rejected ? rejectedReview : buildReview()),
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
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CandidateRuleDetail
        candidateRuleId="rule-meals-cap"
        principal={approverPrincipal}
        onBack={() => undefined}
        onReviewResolved={onReviewResolved}
      />,
    );

    await screen.findByDisplayValue("Meals are capped at $75 per day.");
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("Reason is required.")).toBeInTheDocument();

    await userEvent.type(
      screen.getByLabelText("Reason"),
      "This statement duplicates a stricter Rule already approved elsewhere.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/candidate-rules/rule-meals-cap/rejections",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            reason: "This statement duplicates a stricter Rule already approved elsewhere.",
          }),
        }),
      );
    });

    expect(await screen.findByText("Rejected")).toBeInTheDocument();
    expect(screen.getByText("Rejected.")).toBeInTheDocument();
    expect(onReviewResolved).toHaveBeenCalledWith("rule-meals-cap", "rejected");
  });
});
