import { fetchModelConfigurations, fetchPromptTemplates } from "../extraction-runs/api";
import type { ModelConfigurationSummary, PromptTemplateSummary } from "../extraction-runs/types";
import { reingestDocument } from "./api";
import { defaultReingestionRunId, describeReingestionError, summarizeDiffCounts } from "./format";
import type { ReingestionResult } from "./types";
import { useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { formatBytes } from "../policy-documents/format";
import { describeExtractionTriggerError, formatPinningLabel, formatRegistrySelection, parseRegistrySelection } from "../extraction-runs/format";
import { describeBaselinePolicyVersion } from "./format";

import MissionDrawerHead from "../shared/ui/MissionDrawerHead";

import RegistryPicker from "../extraction-runs/RegistryPicker";

const UPLOAD_ACCEPT =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const UPLOAD_FORMAT_ERROR =
  "Only native-digital PDF and DOCX Policy Documents are supported.";

type WizardPhase = "configure" | "running" | "complete" | "error";
type RegistryStatus = "idle" | "loading" | "ready" | "error";

interface ReingestionWizardProps {
  documentId: string;
  onClose: () => void;
  onCompleted: () => void;
  onLockChange?: (locked: boolean) => void;
}

function isAcceptedUploadFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  const hasExtension = lowerName.endsWith(".pdf") || lowerName.endsWith(".docx");
  if (!hasExtension) {
    return false;
  }
  if (!file.type) {
    return true;
  }
  return (
    file.type === "application/pdf" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

const RUNNING_STAGES = [
  "Depositing Document Version",
  "Running quality gates",
  "Extracting Candidate Rules",
  "Diffing against Policy Version",
] as const;

export default function ReingestionWizard({
  documentId,
  onClose,
  onCompleted,
  onLockChange,
}: ReingestionWizardProps) {
  const [phase, setPhase] = useState<WizardPhase>("configure");
  const [runningStageIndex, setRunningStageIndex] = useState(0);
  const [registryStatus, setRegistryStatus] = useState<RegistryStatus>("idle");
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplateSummary[]>([]);
  const [modelConfigurations, setModelConfigurations] = useState<ModelConfigurationSummary[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [extractionRunId, setExtractionRunId] = useState(() => defaultReingestionRunId(documentId));
  const [promptSelection, setPromptSelection] = useState("");
  const [modelSelection, setModelSelection] = useState("");
  const [openPicker, setOpenPicker] = useState<"prompt" | "model" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<ReingestionResult | null>(null);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);

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
          setModelSelection(formatRegistrySelection(first.model_configuration_id, first.version));
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

  useEffect(() => {
    onLockChange?.(phase === "running");
  }, [phase, onLockChange]);

  useEffect(() => {
    if (phase !== "running") {
      return;
    }

    setRunningStageIndex(0);
    const interval = window.setInterval(() => {
      setRunningStageIndex((current) => {
        if (current >= RUNNING_STAGES.length - 1) {
          return current;
        }
        return current + 1;
      });
    }, 1400);

    return () => {
      window.clearInterval(interval);
    };
  }, [phase]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setFormError(null);

    if (file && !isAcceptedUploadFile(file)) {
      setFormError(UPLOAD_FORMAT_ERROR);
      setSelectedFile(null);
      setFileInputKey((current) => current + 1);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phase === "running" || registryStatus !== "ready") {
      return;
    }

    if (!selectedFile) {
      setFormError("Select a PDF or DOCX file before beginning re-ingestion.");
      return;
    }
    if (!isAcceptedUploadFile(selectedFile)) {
      setFormError(UPLOAD_FORMAT_ERROR);
      return;
    }

    const trimmedRunId = extractionRunId.trim();
    if (!trimmedRunId) {
      setFormError("Enter an Extraction Run id before beginning re-ingestion.");
      return;
    }

    const prompt = parseRegistrySelection(promptSelection);
    const model = parseRegistrySelection(modelSelection);
    if (!prompt) {
      setFormError("Select a Prompt Template version.");
      return;
    }
    if (!model) {
      setFormError("Select a Model Configuration version.");
      return;
    }

    setFormError(null);
    setFailureMessage(null);
    setPhase("running");

    try {
      const nextResult = await reingestDocument(documentId, selectedFile, {
        extraction_run_id: trimmedRunId,
        prompt_template_id: prompt.id,
        prompt_template_version: prompt.version,
        model_configuration_id: model.id,
        model_configuration_version: model.version,
      });
      setResult(nextResult);
      setPhase("complete");
      onCompleted();
    } catch (error: unknown) {
      setFailureMessage(describeReingestionError(error));
      setPhase("error");
    }
  }

  function handleRetry(): void {
    setPhase("configure");
    setFailureMessage(null);
    setResult(null);
    setExtractionRunId(defaultReingestionRunId(documentId));
  }

  function handleDone(): void {
    onClose();
  }

  const registryEmpty =
    registryStatus === "ready" &&
    (promptTemplates.length === 0 || modelConfigurations.length === 0);

  const diffCounts = result ? summarizeDiffCounts(result.diff) : null;

  return (
    <section
      className="reingestion-wizard reveal"
      aria-labelledby="reingestion-wizard-heading"
      aria-live="polite"
    >
      <MissionDrawerHead
        folio="Re-ingestion module"
        title="Re-ingestion wizard"
        titleId="reingestion-wizard-heading"
        lede="Upload a revised source, extract Candidate Rules, and diff against the current Policy Version — all in one atomic pass."
        onClose={onClose}
        closeDisabled={phase === "running"}
      />

      <div className="mission-drawer-body">
      <ol className="reingestion-steps" aria-label="Re-ingestion progress">
        {(["Configure", "Process", "Diff summary"] as const).map((label, index) => {
          const stepPhase =
            phase === "configure"
              ? 0
              : phase === "running"
                ? 1
                : phase === "complete" || phase === "error"
                  ? 2
                  : 0;
          const isActive = index === stepPhase;
          const isComplete = index < stepPhase || phase === "complete";

          return (
            <li
              key={label}
              className={`reingestion-step${isActive ? " active" : ""}${isComplete ? " complete" : ""}`}
              style={{ "--reveal-delay": `${index * 80}ms` } as CSSProperties}
            >
              <span className="reingestion-step-index">{index + 1}</span>
              <span className="reingestion-step-label">{label}</span>
            </li>
          );
        })}
      </ol>

      {phase === "configure" ? (
        <>
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
            <p className="reingestion-empty">
              No Prompt Templates or Model Configurations are registered. Seed the extraction
              registry before re-ingesting.
            </p>
          ) : null}

          {registryStatus === "ready" && !registryEmpty ? (
            <form className="reingestion-form" onSubmit={(event) => void handleSubmit(event)}>
              <label className="reingestion-dropzone" htmlFor="reingestion-file">
                <input
                  key={fileInputKey}
                  id="reingestion-file"
                  name="reingestion-file"
                  type="file"
                  accept={UPLOAD_ACCEPT}
                  onChange={handleFileChange}
                />
                <span className="reingestion-dropcopy">
                  {selectedFile ? (
                    <>
                      <strong>{selectedFile.name}</strong>
                      <span>{formatBytes(selectedFile.size)} · ready for intake</span>
                    </>
                  ) : (
                    <>
                      <strong>Deposit revised source</strong>
                      <span>PDF or DOCX · native-digital only</span>
                    </>
                  )}
                </span>
              </label>

              <label htmlFor="reingestion-run-id">
                Extraction Run id
                <input
                  id="reingestion-run-id"
                  name="reingestion-run-id"
                  value={extractionRunId}
                  spellCheck={false}
                  onChange={(event) => {
                    setExtractionRunId(event.target.value);
                    setFormError(null);
                  }}
                />
              </label>

              <RegistryPicker
                label="Prompt Template"
                value={promptSelection}
                isOpen={openPicker === "prompt"}
                onOpenChange={(open) => setOpenPicker(open ? "prompt" : null)}
                onChange={(nextValue) => {
                  setPromptSelection(nextValue);
                  setFormError(null);
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
                isOpen={openPicker === "model"}
                onOpenChange={(open) => setOpenPicker(open ? "model" : null)}
                onChange={(nextValue) => {
                  setModelSelection(nextValue);
                  setFormError(null);
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

              <div className="reingestion-actions">
                <button type="submit" className="reingestion-submit" disabled={!selectedFile}>
                  Begin re-ingestion
                </button>
                {selectedFile ? (
                  <button
                    type="button"
                    className="reingestion-clear"
                    onClick={() => {
                      setSelectedFile(null);
                      setFormError(null);
                      setFileInputKey((current) => current + 1);
                    }}
                  >
                    Clear file
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}

          {formError ? (
            <p className="reingestion-feedback error" role="alert">
              {formError}
            </p>
          ) : null}
        </>
      ) : null}

      {phase === "running" ? (
        <div className="reingestion-running">
          <p className="reingestion-running-lede">
            Atomic pass in progress — do not navigate away until the diff summary appears.
          </p>
          <ol className="reingestion-running-stages" aria-label="Processing stages">
            {RUNNING_STAGES.map((stage, index) => {
              const isDone = index < runningStageIndex;
              const isCurrent = index === runningStageIndex;
              return (
                <li
                  key={stage}
                  className={`reingestion-running-stage${isDone ? " done" : ""}${isCurrent ? " current" : ""}`}
                  style={{ "--reveal-delay": `${index * 120}ms` } as CSSProperties}
                >
                  <span className="reingestion-running-marker" aria-hidden="true" />
                  <span>{stage}</span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {phase === "error" && failureMessage ? (
        <div className="reingestion-failure">
          <span className="folio">Process halted</span>
          <p className="reingestion-feedback error" role="alert">
            {failureMessage}
          </p>
          <div className="reingestion-actions">
            <button type="button" className="reingestion-submit" onClick={handleRetry}>
              Adjust and retry
            </button>
            <button type="button" className="reingestion-clear" onClick={onClose}>
              Close wizard
            </button>
          </div>
        </div>
      ) : null}

      {phase === "complete" && result && diffCounts ? (
        <div className="reingestion-result">
          <div className="reingestion-result-head">
            <span className="folio">Diff matrix</span>
            <h5>Policy Version comparison</h5>
            <p>{describeBaselinePolicyVersion(result.diff.baseline_policy_version_id)}</p>
          </div>

          <dl className="reingestion-diff-grid" aria-label="Rule diff counts">
            {(
              [
                ["added", "Added", diffCounts.added],
                ["changed", "Changed", diffCounts.changed],
                ["removed", "Removed", diffCounts.removed],
                ["unchanged", "Unchanged", diffCounts.unchanged],
              ] as const
            ).map(([kind, label, count], index) => (
              <div
                key={kind}
                className={`reingestion-diff-cell ${kind} reveal`}
                style={{ "--reveal-delay": `${100 + index * 90}ms` } as CSSProperties}
              >
                <dt>{label}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>

          <dl className="reingestion-result-meta">
            <div>
              <dt>Document Version</dt>
              <dd>
                <code>{result.document_version.document_version_id}</code>
              </dd>
            </div>
            <div>
              <dt>Extraction Run</dt>
              <dd>
                <code>{result.extraction_run.extraction_run_id}</code>
              </dd>
            </div>
            <div>
              <dt>Candidate Rules</dt>
              <dd>{result.extraction_run.candidate_rules.length}</dd>
            </div>
            <div>
              <dt>Extraction attempts</dt>
              <dd>{result.extraction_run.attempt_count}</dd>
            </div>
          </dl>

          <div className="reingestion-actions">
            <button type="button" className="reingestion-submit" onClick={handleDone}>
              Return to document
            </button>
          </div>
        </div>
      ) : null}
      </div>
    </section>
  );
}
