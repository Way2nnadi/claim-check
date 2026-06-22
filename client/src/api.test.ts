import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiRequest,
  downloadDocumentVersion,
  downloadPolicyVersionSnapshot,
} from "./api";

describe("apiRequest", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });
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

  it("downloads document version bytes without forcing JSON parsing", async () => {
    window.sessionStorage.setItem("policy-pipeline.auth.token", "viewer-token");
    const blob = new Blob(["pdf"], { type: "application/pdf" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => blob,
    });
    vi.stubGlobal("fetch", fetchMock);

    const clickMock = vi.fn();
    const link = {
      href: "",
      download: "",
      rel: "",
      click: clickMock,
      remove: vi.fn(),
    } as unknown as HTMLAnchorElement;
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
      if (tagName === "a") {
        return link as HTMLAnchorElement;
      }
      return originalCreateElement(tagName, options);
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:test"),
      revokeObjectURL: vi.fn(),
    });

    await downloadDocumentVersion("expense-policy", "docv-1", "expense.pdf");

    const [, request] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(request?.headers);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/policy-documents/expense-policy/versions/docv-1",
      expect.any(Object),
    );
    expect(headers.get("Authorization")).toBe("Bearer viewer-token");
    expect(clickMock).toHaveBeenCalled();
    expect(link.download).toBe("expense.pdf");
  });

  it("downloads a Policy Version snapshot as a JSON attachment", async () => {
    window.sessionStorage.setItem("policy-pipeline.auth.token", "viewer-token");
    const blob = new Blob(['{"policy_version_id":"policy-v2"}'], {
      type: "application/json",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => blob,
    });
    vi.stubGlobal("fetch", fetchMock);

    const clickMock = vi.fn();
    const link = {
      href: "",
      download: "",
      rel: "",
      click: clickMock,
      remove: vi.fn(),
    } as unknown as HTMLAnchorElement;
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
      if (tagName === "a") {
        return link as HTMLAnchorElement;
      }
      return originalCreateElement(tagName, options);
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:policy-version"),
      revokeObjectURL: vi.fn(),
    });

    await downloadPolicyVersionSnapshot("policy-v2");

    const [, request] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(request?.headers);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/policy-versions/policy-v2/snapshot",
      expect.any(Object),
    );
    expect(headers.get("Authorization")).toBe("Bearer viewer-token");
    expect(clickMock).toHaveBeenCalled();
    expect(link.download).toBe("policy-v2.json");
  });

  it("posts Policy Version publish requests with JSON bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        policy_version_id: "policy-v3",
        rule_count: 3,
        status: "published",
        published_by: "approver-user",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { publishPolicyVersion } = await import("./api");
    await publishPolicyVersion({
      policy_version_id: "policy-v3",
      change_summary: "Raised lodging cap and clarified approval evidence.",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/policy-versions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          policy_version_id: "policy-v3",
          change_summary: "Raised lodging cap and clarified approval evidence.",
        }),
      }),
    );
  });

  it("builds extraction run query parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchExtractionRuns } = await import("./api");
    await fetchExtractionRuns({
      documentId: "expense-policy",
      documentVersionId: "docv-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/extraction-runs?document_id=expense-policy&document_version_id=docv-1",
      expect.any(Object),
    );
  });

  it("builds candidate rule query parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchCandidateRules } = await import("./api");
    await fetchCandidateRules({
      lifecycleStates: ["extracted", "in_review"],
      documentId: "expense-policy",
      documentVersionId: "docv-1",
      extractionRunId: "extract-test",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/candidate-rules?lifecycle_state=extracted&lifecycle_state=in_review&document_id=expense-policy&document_version_id=docv-1&extraction_run_id=extract-test",
      expect.any(Object),
    );
  });

  it("patches candidate rule review updates with JSON bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidate_rule_id: "rule-123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { updateCandidateRule } = await import("./api");
    await updateCandidateRule("rule-123", {
      statement: "Meals are capped at $80 per day.",
      condition: {
        field: "meal.amount",
        operator: "<=",
        value: "80",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/candidate-rules/rule-123",
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

  it("posts candidate rule approvals with JSON bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidate_rule_id: "rule-123", status: "approved" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { approveCandidateRule } = await import("./api");
    await approveCandidateRule("rule-123", {
      rationale: "Citation verified and threshold confirmed.",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/candidate-rules/rule-123/approvals",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          rationale: "Citation verified and threshold confirmed.",
        }),
      }),
    );
  });

  it("posts candidate rule rejections with JSON bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidate_rule_id: "rule-123", status: "rejected" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rejectCandidateRule } = await import("./api");
    await rejectCandidateRule("rule-123", {
      reason: "This statement duplicates a stricter Rule already approved elsewhere.",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/candidate-rules/rule-123/rejections",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          reason: "This statement duplicates a stricter Rule already approved elsewhere.",
        }),
      }),
    );
  });

  it("posts extraction run create requests with JSON bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        extraction_run_id: "extract-test",
        document_version_id: "docv-1",
        prompt_template_id: "rule-extraction",
        prompt_template_version: "v1",
        model_configuration_id: "fake-openai",
        model_configuration_version: "v1",
        attempt_count: 1,
        candidate_rules: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createExtractionRun } = await import("./api");
    await createExtractionRun("expense-policy", "docv-1", {
      extraction_run_id: "extract-test",
      prompt_template_id: "rule-extraction",
      prompt_template_version: "v1",
      model_configuration_id: "fake-openai",
      model_configuration_version: "v1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/policy-documents/expense-policy/versions/docv-1/extraction-runs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          extraction_run_id: "extract-test",
          prompt_template_id: "rule-extraction",
          prompt_template_version: "v1",
          model_configuration_id: "fake-openai",
          model_configuration_version: "v1",
        }),
      }),
    );
  });

  it("posts re-ingestion requests as multipart form data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        document_version: { document_version_id: "docv-3" },
        extraction_run: { extraction_run_id: "reingest-test", candidate_rules: [] },
        diff: { baseline_policy_version_id: null, added: [], changed: [], removed: [], unchanged: [] },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["pdf"], "policy.pdf", { type: "application/pdf" });
    const { reingestDocument } = await import("./api");
    await reingestDocument("expense-policy", file, {
      extraction_run_id: "reingest-test",
      prompt_template_id: "rule-extraction",
      prompt_template_version: "v1",
      model_configuration_id: "fake-openai",
      model_configuration_version: "v1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/policy-documents/expense-policy/reingestions",
      expect.objectContaining({ method: "POST" }),
    );
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(body.get("extraction_run_id")).toBe("reingest-test");
    expect(body.get("prompt_template_id")).toBe("rule-extraction");
    expect(body.get("model_configuration_id")).toBe("fake-openai");
  });
});
