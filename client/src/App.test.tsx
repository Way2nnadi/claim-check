import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { SESSION_STORAGE_TOKEN_KEY } from "./api";

describe("App", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("restores the saved token, calls /api/me, and hides admin-only actions for viewers", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "viewer-token");
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/me") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            subject: "viewer-user",
            roles: ["viewer"],
            auth_backend: "local",
          }),
        });
      }
      if (url === "/api/policy-documents") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload Document Version" })).not.toBeInTheDocument();

    const request = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    expect(fetchMock).toHaveBeenCalledWith("/api/me", expect.any(Object));
    expect(headers.get("Authorization")).toBe("Bearer viewer-token");
  });

  it("disables Policy Version publishing for viewer clearance", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "viewer-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/me") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              subject: "viewer-user",
              roles: ["viewer"],
              auth_backend: "local",
            }),
          });
        }
        if (url === "/api/policy-versions") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ items: [] }),
          });
        }
        if (url === "/api/policy-documents") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ items: [] }),
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(<App />);

    await screen.findByRole("heading", { name: "Documents" });
    await userEvent.click(screen.getByRole("button", { name: /Policy Versions/i }));

    expect(await screen.findByRole("heading", { name: "Policy Versions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish Policy Version" })).toBeDisabled();
  });

  it("clears the token and returns to sign-in when the user signs out", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "admin-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/me") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              subject: "admin-user",
              roles: ["admin"],
              auth_backend: "local",
            }),
          });
        }
        if (url === "/api/policy-documents") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ items: [] }),
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
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
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/me") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            subject: "admin-user",
            roles: ["admin"],
            auth_backend: "local",
          }),
        });
      }
      if (url === "/api/policy-documents") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: "Enter as Admin" }));

    expect(await screen.findByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload Document Version" })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(SESSION_STORAGE_TOKEN_KEY)).toBe("local-admin-token");

    const request = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    expect(headers.get("Authorization")).toBe("Bearer local-admin-token");
  });

  it("authenticates with a custom token and stores it for later requests", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/me") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            subject: "custom-approver",
            roles: ["approver"],
            auth_backend: "local",
          }),
        });
      }
      if (url === "/api/policy-documents") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await userEvent.click(screen.getByText("Custom bearer token"));
    await userEvent.type(screen.getByLabelText("Bearer token"), "custom-token");
    await userEvent.click(screen.getByRole("button", { name: "Sign in with custom token" }));

    expect(await screen.findByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload Document Version" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Schedule Re-ingestion" })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(SESSION_STORAGE_TOKEN_KEY)).toBe("custom-token");

    const request = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    expect(headers.get("Authorization")).toBe("Bearer custom-token");
  });

  it("renders the policy document catalog with summary metadata", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "viewer-token");
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/me") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            subject: "viewer-user",
            roles: ["viewer"],
            auth_backend: "local",
          }),
        });
      }
      if (url === "/api/policy-documents") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
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
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByText("expense-policy")).toBeInTheDocument();
    expect(screen.getByText("Expense Policy")).toBeInTheDocument();
    expect(screen.getByText("docv-expense-v2")).toBeInTheDocument();
    expect(screen.getByText(/1 active · 2 total/)).toBeInTheDocument();
    expect(screen.getByText("Contains archived versions")).toBeInTheDocument();
  });

  it("opens document detail from the catalog and lists versions", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "viewer-token");
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/me") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            subject: "viewer-user",
            roles: ["viewer"],
            auth_backend: "local",
          }),
        });
      }
      if (url === "/api/policy-documents") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
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
          }),
        });
      }
      if (url === "/api/policy-documents/expense-policy/versions?include_deleted=true") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              {
                document_id: "expense-policy",
                document_version_id: "docv-expense-v2",
                filename: "expense-policy-v2.pdf",
                content_type: "application/pdf",
                size_bytes: 2048,
                sha256: "abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890",
                deleted_at: null,
                deletion_reason: null,
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByText("Expense Policy");
    await userEvent.click(screen.getByRole("button", { name: /Expense Policy/i }));

    expect(await screen.findByText("docv-expense-v2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retrieve source" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload Document Version" })).not.toBeInTheDocument();
  });

  it("shows a helpful empty state when the catalog has no documents", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "viewer-token");
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/me") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            subject: "viewer-user",
            roles: ["viewer"],
            auth_backend: "local",
          }),
        });
      }
      if (url === "/api/policy-documents") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "No Policy Documents on file" })).toBeInTheDocument();
    expect(
      screen.getByText(/Upload a source document to open the catalog/),
    ).toBeInTheDocument();
  });

  it("collapses and reopens the navigation drawer", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "viewer-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/me") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              subject: "viewer-user",
              roles: ["viewer"],
              auth_backend: "local",
            }),
          });
        }
        if (url === "/api/policy-documents") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ items: [] }),
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
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

  it("renders the review queue when navigating to Review", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "approver-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/me") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              subject: "approver-user",
              roles: ["approver"],
              auth_backend: "local",
            }),
          });
        }
        if (url === "/api/policy-documents") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ items: [] }),
          });
        }
        if (url === "/api/candidate-rules") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ items: [] }),
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(<App />);

    await screen.findByRole("navigation", { name: "Primary" });
    await userEvent.click(screen.getByRole("button", { name: "ReviewApproval Desk" }));

    expect(await screen.findByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(
      screen.getByText(/The review queue is empty — no extracted Rules are waiting for triage/),
    ).toBeInTheDocument();
  });
});
