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
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        subject: "viewer-user",
        roles: ["viewer"],
        auth_backend: "local",
      }),
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

  it("clears the token and returns to sign-in when the user signs out", async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, "admin-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          subject: "admin-user",
          roles: ["admin"],
          auth_backend: "local",
        }),
      }),
    );

    render(<App />);

    await screen.findByRole("button", { name: "Sign out" });
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(window.sessionStorage.getItem(SESSION_STORAGE_TOKEN_KEY)).toBeNull();
    });
    expect(screen.getByRole("heading", { name: "Policy Pipeline Gazette" })).toBeInTheDocument();
  });
});
