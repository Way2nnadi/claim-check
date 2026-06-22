import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { SESSION_STORAGE_TOKEN_KEY } from "../shared/api/client";

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => payload,
  });
}

function createAppFetchMock(
  principal: {
    subject: string;
    roles: string[];
    auth_backend: string;
  },
  overrides: Partial<
    Record<
      string,
      | unknown
      | ((url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>)
    >
  > = {},
) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const override = overrides[url];
    if (typeof override === "function") {
      return override(url, init);
    }
    if (override !== undefined) {
      return jsonResponse(override);
    }

    if (url === "/api/me") {
      return jsonResponse(principal);
    }
    if (
      url === "/api/candidate-rules?lifecycle_state=extracted&lifecycle_state=in_review"
    ) {
      return jsonResponse({
        items: [
          { candidate_rule_id: "rule-meals-cap" },
          { candidate_rule_id: "rule-lodging-cap" },
        ],
      });
    }
    if (url === "/api/policy-versions") {
      return jsonResponse({
        items: [
          {
            policy_version_id: "policy-v4",
            published_by: "approver-user",
            change_summary: "Meals and lodging limits aligned to the new travel memo.",
            rule_count: 18,
            created_at: "2026-06-22T10:00:00Z",
          },
        ],
      });
    }
    if (url === "/api/extraction-runs") {
      return jsonResponse({
        items: [
          {
            extraction_run_id: "extract-expense-v2",
            document_id: "expense-policy",
            document_version_id: "docv-expense-v2",
            prompt_template_id: "rule-extraction",
            prompt_template_version: "v2",
            model_configuration_id: "gpt-5-mini",
            model_configuration_version: "2026-06-01",
            candidate_rule_count: 2,
            created_at: "2026-06-22T09:30:00Z",
            status: "completed",
            failure_detail: null,
          },
        ],
      });
    }
    if (url === "/api/expense-reports") {
      return jsonResponse({
        items: [],
      });
    }

    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
}

describe("App", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("restores the saved token, calls /api/me, and renders the dashboard home page", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "viewer-token");
    const fetchMock = createAppFetchMock({
      subject: "viewer-user",
      roles: ["viewer"],
      auth_backend: "local",
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByText(/2 pending · latest policy-v4 · 1 run/i)).toBeInTheDocument();
    expect(await screen.findByText("policy-v4")).toBeInTheDocument();
    expect(await screen.findByText("extract-expense-v2")).toBeInTheDocument();
    expect(
      document.querySelector("time[dateTime='2026-06-22T09:30:00Z']"),
    ).toBeInTheDocument();

    const request = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    expect(fetchMock).toHaveBeenCalledWith("/api/me", expect.any(Object));
    expect(headers.get("Authorization")).toBe("Bearer viewer-token");
  });

  it("hides Policy Version publishing for viewer clearance", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "viewer-token");
    vi.stubGlobal(
      "fetch",
      createAppFetchMock(
        {
          subject: "viewer-user",
          roles: ["viewer"],
          auth_backend: "local",
        },
        {
          "/api/policy-versions": { items: [] },
        },
      ),
    );

    render(<App />);

    await screen.findByRole("heading", { name: "Dashboard" });
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button",
        { name: /Policy Versions/i },
      ),
    );

    expect(await screen.findByRole("heading", { name: "Policy Versions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish Policy Version" })).not.toBeInTheDocument();
  });

  it("opens the publish drawer only after clicking Publish Policy Version", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "admin-token");
    vi.stubGlobal(
      "fetch",
      createAppFetchMock(
        {
          subject: "admin-user",
          roles: ["admin"],
          auth_backend: "local",
        },
        {
          "/api/policy-versions": {
            items: [
              {
                policy_version_id: "policy-v1",
                published_by: "admin-user",
                change_summary: "Initial snapshot.",
                rule_count: 1,
                created_at: "2026-06-21T12:00:00Z",
              },
            ],
          },
        },
      ),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button",
        { name: /Policy Versions/i },
      ),
    );

    expect(await screen.findByText("policy-v1")).toBeInTheDocument();
    expect(screen.queryByLabelText("Policy Version id")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Publish Policy Version" }));

    expect(await screen.findByLabelText("Policy Version id")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close publish Policy Version drawer" }));

    await waitFor(() => {
      expect(screen.queryByLabelText("Policy Version id")).not.toBeInTheDocument();
    });

    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button",
        { name: /Documents/i },
      ),
    );
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button",
        { name: /Policy Versions/i },
      ),
    );

    expect(await screen.findByText("policy-v1")).toBeInTheDocument();
    expect(screen.queryByLabelText("Policy Version id")).not.toBeInTheDocument();
  });

  it("opens Manual Rules and keeps creation disabled for viewer clearance", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "viewer-token");
    vi.stubGlobal(
      "fetch",
      createAppFetchMock({
        subject: "viewer-user",
        roles: ["viewer"],
        auth_backend: "local",
      }),
    );

    render(<App />);

    await screen.findByRole("heading", { name: "Dashboard" });
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button",
        { name: /Manual Rules/i },
      ),
    );

    expect(await screen.findByRole("heading", { name: "Manual Rules" })).toBeInTheDocument();
    const createButtons = screen.getAllByRole("button", {
      name: "Create Manual Rule",
    });
    expect(createButtons.length).toBeGreaterThan(0);
    for (const button of createButtons) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByText("Viewer access")).toBeInTheDocument();
  });

  it("opens Audit, loads events, and applies entity filters", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "viewer-token");
    const fetchMock = createAppFetchMock(
      {
        subject: "viewer-user",
        roles: ["viewer"],
        auth_backend: "local",
      },
      {
        "/api/audit-events": {
          items: [
            {
              action: "candidate_rule.approved",
              actor_subject: "approver-user",
              actor_roles: ["approver"],
              entity_type: "candidate_rule",
              entity_id: "rule-123",
              occurred_at: "2026-06-22T10:15:00Z",
              payload: { rationale: "Citation verified by finance." },
            },
          ],
        },
        "/api/audit-events?entity_type=candidate_rule&entity_id=rule-404": {
          items: [],
        },
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Dashboard" });
    await userEvent.click(screen.getByRole("button", { name: "Audit" }));

    expect(await screen.findByRole("heading", { name: "Audit log" })).toBeInTheDocument();
    expect(screen.getByText("approver-user")).toBeInTheDocument();
    expect(screen.getByText("Citation verified by finance.")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Code filters"));
    await userEvent.selectOptions(screen.getByLabelText("Entity type"), "candidate_rule");
    await userEvent.clear(screen.getByLabelText("Entity id"));
    await userEvent.type(screen.getByLabelText("Entity id"), "rule-404");
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/audit-events?entity_type=candidate_rule&entity_id=rule-404",
        expect.any(Object),
      );
    });
    expect(
      await screen.findByText("No audit events match the current scope."),
    ).toBeInTheDocument();

    const auditRequest = fetchMock.mock.calls.find(
      ([url]) =>
        url === "/api/audit-events?entity_type=candidate_rule&entity_id=rule-404",
    )?.[1];
    expect(new Headers(auditRequest?.headers).get("Authorization")).toBe(
      "Bearer viewer-token",
    );
  });

  it("clears the token and returns to sign-in when the user signs out", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "admin-token");
    vi.stubGlobal(
      "fetch",
      createAppFetchMock({
        subject: "admin-user",
        roles: ["admin"],
        auth_backend: "local",
      }),
    );

    render(<App />);

    await screen.findByRole("button", { name: "Sign out" });
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(window.sessionStorage.getItem(SESSION_STORAGE_TOKEN_KEY)).toBeNull();
    });
    expect(screen.getByRole("heading", { name: /Policy Nexus/i })).toBeInTheDocument();
  });

  it("authenticates with a persona token and shows role-allowed actions", async () => {
    const fetchMock = createAppFetchMock({
      subject: "admin-user",
      roles: ["admin"],
      auth_backend: "local",
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: "Enter as Admin" }));

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button",
        { name: /Documents/i },
      ),
    );
    expect(screen.queryByRole("button", { name: "Upload Document Version" })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(SESSION_STORAGE_TOKEN_KEY)).toBe("local-admin-token");

    const request = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    expect(headers.get("Authorization")).toBe("Bearer local-admin-token");
  });

  it("authenticates with a custom token and stores it for later requests", async () => {
    const fetchMock = createAppFetchMock({
      subject: "custom-approver",
      roles: ["approver"],
      auth_backend: "local",
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await userEvent.click(screen.getByText("Custom bearer token"));
    await userEvent.type(screen.getByLabelText("Bearer token"), "custom-token");
    await userEvent.click(screen.getByRole("button", { name: "Sign in with custom token" }));

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button",
        { name: /Documents/i },
      ),
    );
    expect(screen.queryByRole("button", { name: "Upload Document Version" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Schedule Re-ingestion" })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(SESSION_STORAGE_TOKEN_KEY)).toBe("custom-token");

    const request = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    expect(headers.get("Authorization")).toBe("Bearer custom-token");
  });

  it("renders the policy document catalog with summary metadata", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "viewer-token");
    const fetchMock = createAppFetchMock(
      {
        subject: "viewer-user",
        roles: ["viewer"],
        auth_backend: "local",
      },
      {
        "/api/policy-documents": {
          items: [
            {
              document_id: "expense-policy",
              latest_document_version_id: "docv-expense-v2",
              latest_uploaded_at: "2026-06-21T12:00:00Z",
              version_count: 2,
              active_version_count: 1,
              has_deleted_versions: true,
            },
          ],
        },
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Dashboard" });
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button",
        { name: /Documents/i },
      ),
    );
    expect(await screen.findByText("expense-policy")).toBeInTheDocument();
    expect(screen.getByText("Expense Policy")).toBeInTheDocument();
    expect(screen.getByText("docv-expense-v2")).toBeInTheDocument();
    expect(screen.getByText(/1 active · 2 total/)).toBeInTheDocument();
    expect(screen.getByText("Has archived versions")).toBeInTheDocument();
  });

  it("opens document detail from the catalog and lists versions", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "viewer-token");
    const fetchMock = createAppFetchMock(
      {
        subject: "viewer-user",
        roles: ["viewer"],
        auth_backend: "local",
      },
      {
        "/api/policy-documents": {
          items: [
            {
              document_id: "expense-policy",
              latest_document_version_id: "docv-expense-v2",
              latest_uploaded_at: "2026-06-21T12:00:00Z",
              version_count: 2,
              active_version_count: 1,
              has_deleted_versions: true,
            },
          ],
        },
        "/api/policy-documents/expense-policy/versions?include_deleted=true": {
          items: [
            {
              document_id: "expense-policy",
              document_version_id: "docv-expense-v2",
              filename: "expense-policy-v2.pdf",
              content_type: "application/pdf",
              size_bytes: 2048,
              sha256: "abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890",
              created_at: "2026-06-21T12:00:00Z",
              deleted_at: null,
              deletion_reason: null,
            },
          ],
        },
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Dashboard" });
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button",
        { name: /Documents/i },
      ),
    );
    await screen.findByText("Expense Policy");
    await userEvent.click(screen.getByRole("button", { name: "Open Expense Policy" }));

    expect(await screen.findByText("docv-expense-v2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retrieve source" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload Document Version" })).not.toBeInTheDocument();
  });

  it("shows a helpful empty state when the catalog has no documents", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "viewer-token");
    const fetchMock = createAppFetchMock(
      {
        subject: "viewer-user",
        roles: ["viewer"],
        auth_backend: "local",
      },
      {
        "/api/policy-documents": { items: [] },
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Dashboard" });
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button",
        { name: /Documents/i },
      ),
    );
    expect(await screen.findByRole("heading", { name: "No documents yet" })).toBeInTheDocument();
    expect(
      screen.getByText(/Ask an administrator to register a document/),
    ).toBeInTheDocument();
  });

  it("collapses and reopens the navigation drawer", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "viewer-token");
    vi.stubGlobal(
      "fetch",
      createAppFetchMock({
        subject: "viewer-user",
        roles: ["viewer"],
        auth_backend: "local",
      }),
    );

    render(<App />);

    await screen.findByRole("navigation", { name: "Primary" });
    expect(screen.getByRole("button", { name: "Collapse navigation" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));

    expect(document.querySelector(".shell-page.sidebar-collapsed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand navigation" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Expand navigation" }));

    expect(document.querySelector(".shell-page.sidebar-collapsed")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse navigation" })).toBeInTheDocument();
  });

  it("renders the review queue when navigating to Review Rules", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "approver-token");
    vi.stubGlobal(
      "fetch",
      createAppFetchMock(
        {
          subject: "approver-user",
          roles: ["approver"],
          auth_backend: "local",
        },
        {
          "/api/policy-documents": { items: [] },
          "/api/candidate-rules": { items: [] },
        },
      ),
    );

    render(<App />);

    await screen.findByRole("navigation", { name: "Primary" });
    await userEvent.click(screen.getByRole("button", { name: "Review Rules" }));

    expect(await screen.findByRole("heading", { name: "Review Rules" })).toBeInTheDocument();
    expect(
      screen.getByText(/The review queue is empty — no extracted Rules are waiting for triage/),
    ).toBeInTheDocument();
  });

  it("adds Expense Reports to navigation and opens the import page", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "admin-token");
    vi.stubGlobal(
      "fetch",
      createAppFetchMock({
        subject: "admin-user",
        roles: ["admin"],
        auth_backend: "local",
      }),
    );

    render(<App />);

    await screen.findByRole("heading", { name: "Dashboard" });
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button",
        { name: /Expense Reports/i },
      ),
    );

    expect(await screen.findByRole("heading", { name: "Expense Reports" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import Expense Report" })).toBeInTheDocument();
  });
});
