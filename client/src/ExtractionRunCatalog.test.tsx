import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExtractionRunCatalog from "./ExtractionRunCatalog";

const sampleRuns = {
  items: [
    {
      extraction_run_id: "extract-expense-v1",
      document_id: "expense-policy",
      document_version_id: "docv-expense-v1",
      prompt_template_id: "rule-extraction",
      prompt_template_version: "v1",
      model_configuration_id: "fake-openai",
      model_configuration_version: "v1",
      candidate_rule_count: 2,
      created_at: "2026-06-21T10:00:00Z",
      status: "completed" as const,
      failure_detail: null,
    },
    {
      extraction_run_id: "extract-expense-v2-failed",
      document_id: "expense-policy",
      document_version_id: "docv-expense-v2",
      prompt_template_id: "rule-extraction",
      prompt_template_version: "v1",
      model_configuration_id: "fake-openai",
      model_configuration_version: "v1",
      candidate_rule_count: 0,
      created_at: "2026-06-21T11:00:00Z",
      status: "failed" as const,
      failure_detail: "Structured extraction output did not pass validation.",
    },
  ],
};

describe("ExtractionRunCatalog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads and renders extraction runs with pinning metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/policy-documents") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              items: [
                {
                  document_id: "expense-policy",
                  latest_document_version_id: "docv-expense-v2",
                  latest_uploaded_at: "2026-06-21T10:00:00Z",
                  version_count: 2,
                  active_version_count: 2,
                  has_deleted_versions: false,
                },
              ],
            }),
          });
        }
        if (url === "/api/extraction-runs") {
          return Promise.resolve({
            ok: true,
            json: async () => sampleRuns,
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(<ExtractionRunCatalog />);

    expect(await screen.findByText("extract-expense-v1")).toBeInTheDocument();
    expect(screen.getAllByText("rule-extraction@v1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("fake-openai@v1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Structured extraction output did not pass validation."),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /All/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Completed/i })).toHaveTextContent("1");
    expect(screen.getByRole("tab", { name: /Failed/i })).toHaveTextContent("1");
  });

  it("filters runs by status tab", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/policy-documents") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ items: [] }),
          });
        }
        if (url === "/api/extraction-runs") {
          return Promise.resolve({
            ok: true,
            json: async () => sampleRuns,
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(<ExtractionRunCatalog />);

    expect(await screen.findByText("extract-expense-v1")).toBeInTheDocument();
    expect(screen.getByText("extract-expense-v2-failed")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /Completed/i }));

    expect(screen.getByText("extract-expense-v1")).toBeInTheDocument();
    expect(screen.queryByText("extract-expense-v2-failed")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /Failed/i }));

    expect(screen.queryByText("extract-expense-v1")).not.toBeInTheDocument();
    expect(screen.getByText("extract-expense-v2-failed")).toBeInTheDocument();
  });

  it("applies document and version filters", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/policy-documents") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      if (url.startsWith("/api/extraction-runs")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ExtractionRunCatalog />);

    await screen.findByText("No Extraction Runs have been recorded yet.");
    await userEvent.click(screen.getByText("Scope filters"));
    await userEvent.type(screen.getByLabelText("Document"), "expense-policy");
    await userEvent.type(screen.getByLabelText("Document version id"), "docv-expense-v1");
    await userEvent.click(screen.getByRole("button", { name: "Apply scope" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/extraction-runs?document_id=expense-policy&document_version_id=docv-expense-v1",
        expect.any(Object),
      );
    });
  });
});
