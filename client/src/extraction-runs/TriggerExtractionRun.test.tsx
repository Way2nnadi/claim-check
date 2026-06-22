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
    {
      prompt_template_id: "rule-extraction",
      version: "v2",
      description: "Rule extraction with scope object requirement",
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
    {
      model_configuration_id: "openai-primary",
      version: "v1",
      model: "gpt-4o-mini",
    },
  ],
};

describe("TriggerExtractionRun", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists every registry pin when a picker opens", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/prompt-templates") {
        return Promise.resolve({ ok: true, json: async () => promptTemplates });
      }
      if (url === "/api/model-configurations") {
        return Promise.resolve({ ok: true, json: async () => modelConfigurations });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TriggerExtractionRun
        documentId="expense-policy"
        documentVersionId="docv-expense-v2"
        onCompleted={() => undefined}
      />,
    );

    await screen.findByLabelText("Prompt");
    await userEvent.click(screen.getByLabelText("Prompt"));

    expect(screen.getByRole("option", { name: "rule-extraction@v1" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "rule-extraction@v2" })).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Model"));

    expect(screen.getByRole("option", { name: "fake-openai@v1" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "openai-primary@v1" })).toBeInTheDocument();
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

    await screen.findByLabelText("Prompt");
    await userEvent.clear(screen.getByLabelText("Run id"));
    await userEvent.type(screen.getByLabelText("Run id"), "extract-docv-expense-v2-test");
    await userEvent.click(screen.getByRole("button", { name: "Extract" }));

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

    expect(await screen.findByText(/1 rule extracted/)).toBeInTheDocument();
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

    await screen.findByLabelText("Prompt");
    await userEvent.click(screen.getByRole("button", { name: "Extract" }));

    expect(
      await screen.findByText(
        "Structured extraction output could not be validated after 2 attempts.",
      ),
    ).toBeInTheDocument();
    expect(onCompleted).toHaveBeenCalled();
  });
});
