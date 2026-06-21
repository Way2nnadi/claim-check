import { describe, expect, it, vi } from "vitest";
import { apiRequest } from "./api";

describe("apiRequest", () => {
  it("adds the bearer token and JSON content type for string bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/example", { method: "POST", body: JSON.stringify({ ok: true }) }, "token-123");

    const [, request] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(request?.headers);
    expect(headers.get("Authorization")).toBe("Bearer token-123");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("does not force JSON content type for multipart bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const body = new FormData();
    body.set("file", new Blob(["policy text"], { type: "text/plain" }), "policy.txt");

    await apiRequest("/api/example", { method: "POST", body }, "token-123");

    const [, request] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(request?.headers);
    expect(headers.get("Authorization")).toBe("Bearer token-123");
    expect(headers.has("Content-Type")).toBe(false);
  });
});
