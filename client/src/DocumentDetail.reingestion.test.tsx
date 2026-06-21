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
      deleted_at: null,
      deletion_reason: null,
    },
  ],
};

describe("DocumentDetail re-ingestion entry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows re-ingestion entry for admins and hides it for viewers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => expenseVersions,
      }),
    );

    const { rerender } = render(
      <DocumentDetail documentId="expense-policy" canUpload onBack={() => undefined} />,
    );

    expect(await screen.findByRole("button", { name: "Re-ingest" })).toBeInTheDocument();

    rerender(<DocumentDetail documentId="expense-policy" canUpload={false} onBack={() => undefined} />);

    expect(screen.queryByRole("button", { name: "Re-ingest" })).not.toBeInTheDocument();
  });

  it("opens the re-ingestion wizard from the document detail page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/versions")) {
          return Promise.resolve({ ok: true, json: async () => expenseVersions });
        }
        if (url === "/api/prompt-templates") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              items: [
                {
                  prompt_template_id: "rule-extraction",
                  version: "v1",
                  description: null,
                },
              ],
            }),
          });
        }
        if (url === "/api/model-configurations") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              items: [
                {
                  model_configuration_id: "fake-openai",
                  version: "v1",
                  model: "gpt-5-mini",
                },
              ],
            }),
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(<DocumentDetail documentId="expense-policy" canUpload onBack={() => undefined} />);

    await userEvent.click(await screen.findByRole("button", { name: "Re-ingest" }));

    expect(await screen.findByRole("heading", { name: "Re-ingestion wizard" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Re-ingest" })).toBeInTheDocument();
  });
});
