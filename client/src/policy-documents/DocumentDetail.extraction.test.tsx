import { render, screen, waitFor } from "@testing-library/react";
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

const extractionRuns = {
  items: [
    {
      extraction_run_id: "extract-expense-v1",
      document_id: "expense-policy",
      document_version_id: "docv-expense-v2",
      prompt_template_id: "rule-extraction",
      prompt_template_version: "v1",
      model_configuration_id: "fake-openai",
      model_configuration_version: "v1",
      candidate_rule_count: 1,
      created_at: "2026-06-21T10:00:00Z",
      status: "completed" as const,
      failure_detail: null,
    },
  ],
};

describe("DocumentDetail extraction runs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads extraction runs when the dossier is expanded", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/policy-documents/expense-policy/versions?include_deleted=true") {
        return Promise.resolve({
          ok: true,
          json: async () => expenseVersions,
        });
      }
      if (
        url ===
        "/api/policy-documents/expense-policy/versions/docv-expense-v2/extraction-runs"
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => extractionRuns,
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentDetail documentId="expense-policy" onBack={() => undefined} />);

    await screen.findByText("docv-expense-v2");
    await userEvent.click(screen.getByRole("button", { name: /extraction run/i }));

    expect(await screen.findByText("extract-expense-v1")).toBeInTheDocument();
    expect(screen.getByText("rule-extraction@v1")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/policy-documents/expense-policy/versions/docv-expense-v2/extraction-runs",
        expect.any(Object),
      );
    });
  });
});
