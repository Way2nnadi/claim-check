import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  createExtractionRun,
  fetchModelConfigurations,
  fetchPromptTemplates,
} from "./api";
import {
  defaultExtractionRunId,
  describeExtractionTriggerError,
  formatPinningLabel,
  formatRegistrySelection,
  parseRegistrySelection,
} from "./extractionRunFormat";
import RegistryPicker from "./RegistryPicker";
import type { ModelConfigurationSummary, PromptTemplateSummary } from "./types";

interface TriggerExtractionRunProps {
  documentId: string;
  documentVersionId: string;
  onCompleted: () => void;
}

type RegistryStatus = "idle" | "loading" | "ready" | "error";

export default function TriggerExtractionRun({
  documentId,
  documentVersionId,
  onCompleted,
}: TriggerExtractionRunProps) {
  const [registryStatus, setRegistryStatus] = useState<RegistryStatus>("idle");
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplateSummary[]>([]);
  const [modelConfigurations, setModelConfigurations] = useState<ModelConfigurationSummary[]>([]);
  const [extractionRunId, setExtractionRunId] = useState(() =>
    defaultExtractionRunId(documentVersionId),
  );
  const [promptSelection, setPromptSelection] = useState("");
  const [modelSelection, setModelSelection] = useState("");
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [triggerSuccess, setTriggerSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openPicker, setOpenPicker] = useState<"prompt" | "model" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRegistryStatus("loading");
    setRegistryError(null);

    void Promise.all([fetchPromptTemplates(), fetchModelConfigurations()])
      .then(([promptResponse, modelResponse]) => {
        if (cancelled) {
          return;
        }
        setPromptTemplates(promptResponse.items);
        setModelConfigurations(modelResponse.items);
        if (promptResponse.items[0]) {
          const first = promptResponse.items[0];
          setPromptSelection(formatRegistrySelection(first.prompt_template_id, first.version));
        }
        if (modelResponse.items[0]) {
          const first = modelResponse.items[0];
          setModelSelection(
            formatRegistrySelection(first.model_configuration_id, first.version),
          );
        }
        setRegistryStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setRegistryError(describeExtractionTriggerError(error));
        setRegistryStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting || registryStatus !== "ready") {
      return;
    }

    const trimmedRunId = extractionRunId.trim();
    if (!trimmedRunId) {
      setTriggerError("Enter an Extraction Run id before commissioning.");
      return;
    }

    const prompt = parseRegistrySelection(promptSelection);
    const model = parseRegistrySelection(modelSelection);
    if (!prompt) {
      setTriggerError("Select a Prompt Template version.");
      return;
    }
    if (!model) {
      setTriggerError("Select a Model Configuration version.");
      return;
    }

    setIsSubmitting(true);
    setTriggerError(null);
    setTriggerSuccess(null);

    try {
      const result = await createExtractionRun(documentId, documentVersionId, {
        extraction_run_id: trimmedRunId,
        prompt_template_id: prompt.id,
        prompt_template_version: prompt.version,
        model_configuration_id: model.id,
        model_configuration_version: model.version,
      });
      setTriggerSuccess(
        `Commissioned ${result.extraction_run_id} — ${result.candidate_rules.length} Candidate Rule${result.candidate_rules.length === 1 ? "" : "s"} extracted after ${result.attempt_count} attempt${result.attempt_count === 1 ? "" : "s"}.`,
      );
      setExtractionRunId(defaultExtractionRunId(documentVersionId));
      onCompleted();
    } catch (error: unknown) {
      setTriggerError(describeExtractionTriggerError(error));
      onCompleted();
    } finally {
      setIsSubmitting(false);
    }
  }

  const registryEmpty =
    registryStatus === "ready" &&
    (promptTemplates.length === 0 || modelConfigurations.length === 0);

  return (
    <section className="extraction-trigger reveal" aria-labelledby={`trigger-${documentVersionId}`}>
      <div className="extraction-trigger-head">
        <span className="folio">Extraction module</span>
        <h5 id={`trigger-${documentVersionId}`}>Commission an Extraction Run</h5>
        <p>
          Pin a Prompt Template and Model Configuration, then extract Candidate Rules from this
          Document Version.
        </p>
      </div>

      {registryStatus === "loading" ? (
        <p className="catalog-status compact">
          <span className="catalog-status-rule" aria-hidden="true" />
          Loading registry pins…
        </p>
      ) : null}

      {registryStatus === "error" ? (
        <p className="error-banner" role="alert">
          {registryError}
        </p>
      ) : null}

      {registryEmpty ? (
        <p className="extraction-trigger-empty">
          No Prompt Templates or Model Configurations are registered. Seed the extraction registry
          before commissioning a run.
        </p>
      ) : null}

      {registryStatus === "ready" && !registryEmpty ? (
        <form className="extraction-trigger-form" onSubmit={(event) => void handleSubmit(event)}>
          <label htmlFor={`extraction-run-id-${documentVersionId}`}>
            Extraction Run id
            <input
              id={`extraction-run-id-${documentVersionId}`}
              name="extraction-run-id"
              value={extractionRunId}
              spellCheck={false}
              disabled={isSubmitting}
              onChange={(event) => {
                setExtractionRunId(event.target.value);
                setTriggerError(null);
                setTriggerSuccess(null);
              }}
            />
          </label>

          <RegistryPicker
            label="Prompt Template"
            value={promptSelection}
            disabled={isSubmitting}
            isOpen={openPicker === "prompt"}
            onOpenChange={(open) => setOpenPicker(open ? "prompt" : null)}
            onChange={(nextValue) => {
              setPromptSelection(nextValue);
              setTriggerError(null);
              setTriggerSuccess(null);
            }}
            options={promptTemplates.map((template) => ({
              value: formatRegistrySelection(template.prompt_template_id, template.version),
              primary: formatPinningLabel(template.prompt_template_id, template.version),
              secondary: template.description,
            }))}
          />

          <RegistryPicker
            label="Model Configuration"
            value={modelSelection}
            disabled={isSubmitting}
            isOpen={openPicker === "model"}
            onOpenChange={(open) => setOpenPicker(open ? "model" : null)}
            onChange={(nextValue) => {
              setModelSelection(nextValue);
              setTriggerError(null);
              setTriggerSuccess(null);
            }}
            options={modelConfigurations.map((configuration) => ({
              value: formatRegistrySelection(
                configuration.model_configuration_id,
                configuration.version,
              ),
              primary: formatPinningLabel(
                configuration.model_configuration_id,
                configuration.version,
              ),
              secondary: configuration.model,
            }))}
          />

          <div className="extraction-trigger-actions">
            <button type="submit" className="extraction-trigger-submit" disabled={isSubmitting}>
              {isSubmitting ? "Extracting…" : "Commission extraction"}
            </button>
          </div>
        </form>
      ) : null}

      {triggerError ? (
        <p className="extraction-trigger-feedback error" role="alert">
          {triggerError}
        </p>
      ) : null}
      {triggerSuccess ? (
        <output className="extraction-trigger-feedback success">{triggerSuccess}</output>
      ) : null}
    </section>
  );
}
