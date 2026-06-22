import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DocumentDetail from "./DocumentDetail";

const expenseVersions = {
  items: [
    {
      document_id: "expense-policy",
      document_version_id: "docv-expense-v2",
      filename: "expense-policy-v2.pdf",
      content_type: "application/pdf",
      size_bytes: 2048,
      sha256: "abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890",
      created_at: "2026-06-22T10:00:00Z",
      deleted_at: null,
      deletion_reason: null,
    },
  ],
};

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

describe("DocumentDetail extraction trigger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the commission form for admins and hides it for viewers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/policy-documents/expense-policy/versions?include_deleted=true") {
          return Promise.resolve({ ok: true, json: async () => expenseVersions });
        }
        if (url === "/api/prompt-templates") {
          return Promise.resolve({ ok: true, json: async () => promptTemplates });
        }
        if (url === "/api/model-configurations") {
          return Promise.resolve({ ok: true, json: async () => modelConfigurations });
        }
        if (
          url ===
          "/api/policy-documents/expense-policy/versions/docv-expense-v2/extraction-runs"
        ) {
          return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    const { rerender } = render(
      <DocumentDetail documentId="expense-policy" canUpload onBack={() => undefined} />,
    );

    await screen.findByText("docv-expense-v2");
    await userEvent.click(screen.getByRole("button", { name: /extraction run/i }));

    expect(await screen.findByRole("heading", { name: "Extract rules" })).toBeInTheDocument();

    rerender(
      <DocumentDetail documentId="expense-policy" canUpload={false} onBack={() => undefined} />,
    );

    expect(screen.queryByRole("heading", { name: "Extract rules" })).not.toBeInTheDocument();
  });
});
