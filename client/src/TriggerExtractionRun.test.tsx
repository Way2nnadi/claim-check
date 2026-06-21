import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TriggerExtractionRun from "./TriggerExtractionRun";

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

describe("TriggerExtractionRun", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("commissions an extraction run and reports success", async () => {
    const onCompleted = vi.fn();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/prompt-templates") {
        return Promise.resolve({ ok: true, json: async () => promptTemplates });
      }
      if (url === "/api/model-configurations") {
        return Promise.resolve({ ok: true, json: async () => modelConfigurations });
      }
      if (
        url ===
          "/api/policy-documents/expense-policy/versions/docv-expense-v2/extraction-runs" &&
        init?.method === "POST"
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            extraction_run_id: "extract-docv-expense-v2-test",
            document_version_id: "docv-expense-v2",
            prompt_template_id: "rule-extraction",
            prompt_template_version: "v1",
            model_configuration_id: "fake-openai",
            model_configuration_version: "v1",
            attempt_count: 1,
            candidate_rules: [{ rule_id: "extract-docv-expense-v2-test:1" }],
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TriggerExtractionRun
        documentId="expense-policy"
        documentVersionId="docv-expense-v2"
        onCompleted={onCompleted}
      />,
    );

    await screen.findByLabelText("Prompt Template");
    await userEvent.clear(screen.getByLabelText("Extraction Run id"));
    await userEvent.type(screen.getByLabelText("Extraction Run id"), "extract-docv-expense-v2-test");
    await userEvent.click(screen.getByRole("button", { name: "Commission extraction" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/policy-documents/expense-policy/versions/docv-expense-v2/extraction-runs",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            extraction_run_id: "extract-docv-expense-v2-test",
            prompt_template_id: "rule-extraction",
            prompt_template_version: "v1",
            model_configuration_id: "fake-openai",
            model_configuration_version: "v1",
          }),
        }),
      );
    });

    expect(
      await screen.findByText(/1 Candidate Rule extracted after 1 attempt/),
    ).toBeInTheDocument();
    expect(onCompleted).toHaveBeenCalled();
  });

  it("surfaces actionable validation failures without stack traces", async () => {
    const onCompleted = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
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
              detail:
                "Structured extraction output could not be validated after 2 attempts.",
            }),
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TriggerExtractionRun
        documentId="expense-policy"
        documentVersionId="docv-expense-v2"
        onCompleted={onCompleted}
      />,
    );

    await screen.findByLabelText("Prompt Template");
    await userEvent.click(screen.getByRole("button", { name: "Commission extraction" }));

    expect(
      await screen.findByText(
        "Structured extraction output could not be validated after 2 attempts.",
      ),
    ).toBeInTheDocument();
    expect(onCompleted).toHaveBeenCalled();
  });
});
