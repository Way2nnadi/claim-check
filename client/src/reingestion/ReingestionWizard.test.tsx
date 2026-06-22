import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReingestionWizard from "./ReingestionWizard";

const promptTemplates = {
  items: [
    {
      prompt_template_id: "rule-extraction",
      version: "v1",
      description: "Rule extraction baseline",
    },
  ],
};

const modelConfigurations = {
  items: [
    {
      model_configuration_id: "fake-openai",
      version: "v1",
      model: "gpt-5-mini",
    },
  ],
};

const reingestionResult = {
  document_version: {
    document_id: "expense-policy",
    document_version_id: "docv-expense-v3",
    filename: "expense-policy-v3.pdf",
    content_type: "application/pdf",
    size_bytes: 3072,
    sha256: "abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890",
    created_at: "2026-06-23T10:00:00Z",
    deleted_at: null,
    deletion_reason: null,
  },
  extraction_run: {
    extraction_run_id: "reingest-expense-policy-test",
    document_version_id: "docv-expense-v3",
    prompt_template_id: "rule-extraction",
    prompt_template_version: "v1",
    model_configuration_id: "fake-openai",
    model_configuration_version: "v1",
    attempt_count: 1,
    candidate_rules: [{}, {}, {}],
  },
  diff: {
    baseline_policy_version_id: "pv-expense-v1",
    added: [{}],
    changed: [{}, {}],
    removed: [{}],
    unchanged: [{}, {}, {}],
  },
};

describe("ReingestionWizard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("completes re-ingestion and shows diff counts", async () => {
    const onCompleted = vi.fn();
    const onClose = vi.fn();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/prompt-templates") {
        return Promise.resolve({ ok: true, json: async () => promptTemplates });
      }
      if (url === "/api/model-configurations") {
        return Promise.resolve({ ok: true, json: async () => modelConfigurations });
      }
      if (url === "/api/policy-documents/expense-policy/reingestions" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => reingestionResult,
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReingestionWizard
        documentId="expense-policy"
        onClose={onClose}
        onCompleted={onCompleted}
      />,
    );

    await screen.findByLabelText("Prompt Template");

    const file = new File(["pdf"], "expense-policy-v3.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText(/Deposit revised source/i), file);
    await userEvent.clear(screen.getByLabelText("Extraction Run id"));
    await userEvent.type(
      screen.getByLabelText("Extraction Run id"),
      "reingest-expense-policy-test",
    );
    await userEvent.click(screen.getByRole("button", { name: "Begin re-ingestion" }));

    expect(await screen.findByText("Policy Version comparison")).toBeInTheDocument();
    expect(screen.getByText("Added").closest(".reingestion-diff-cell")).toHaveTextContent("1");
    expect(screen.getByText("Changed").closest(".reingestion-diff-cell")).toHaveTextContent("2");
    expect(screen.getByText("Removed").closest(".reingestion-diff-cell")).toHaveTextContent("1");
    expect(screen.getByText("Unchanged").closest(".reingestion-diff-cell")).toHaveTextContent("3");
    expect(screen.getByText(/Compared against pv-expense-v1/)).toBeInTheDocument();
    expect(onCompleted).toHaveBeenCalled();

    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "/api/policy-documents/expense-policy/reingestions" && init?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = postCall?.[1]?.body as FormData;
    expect(body.get("extraction_run_id")).toBe("reingest-expense-policy-test");
    expect(body.get("prompt_template_id")).toBe("rule-extraction");
    expect(body.get("model_configuration_id")).toBe("fake-openai");
  });

  it("surfaces extraction failures without stack traces", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/prompt-templates") {
        return Promise.resolve({ ok: true, json: async () => promptTemplates });
      }
      if (url === "/api/model-configurations") {
        return Promise.resolve({ ok: true, json: async () => modelConfigurations });
      }
      if (init?.method === "POST") {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: async () => ({
            detail: "Structured extraction output could not be validated after 2 attempts.",
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReingestionWizard
        documentId="expense-policy"
        onClose={() => undefined}
        onCompleted={() => undefined}
      />,
    );

    await screen.findByLabelText("Prompt Template");

    const file = new File(["pdf"], "expense-policy-v3.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText(/Deposit revised source/i), file);
    await userEvent.click(screen.getByRole("button", { name: "Begin re-ingestion" }));

    expect(
      await screen.findByText(
        "Structured extraction output could not be validated after 2 attempts.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adjust and retry" })).toBeInTheDocument();
  });

  it("explains when no baseline Policy Version exists", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/prompt-templates") {
        return Promise.resolve({ ok: true, json: async () => promptTemplates });
      }
      if (url === "/api/model-configurations") {
        return Promise.resolve({ ok: true, json: async () => modelConfigurations });
      }
      if (init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...reingestionResult,
            diff: {
              baseline_policy_version_id: null,
              added: [{}, {}],
              changed: [],
              removed: [],
              unchanged: [],
            },
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReingestionWizard
        documentId="expense-policy"
        onClose={() => undefined}
        onCompleted={() => undefined}
      />,
    );

    await screen.findByLabelText("Prompt Template");

    const file = new File(["pdf"], "expense-policy-v3.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText(/Deposit revised source/i), file);
    await userEvent.click(screen.getByRole("button", { name: "Begin re-ingestion" }));

    expect(
      await screen.findByText(/No published Policy Version exists yet/),
    ).toBeInTheDocument();
  });
});
