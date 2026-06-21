import { useCallback, useEffect, useState } from "react";
import { fetchDocumentVersionExtractionRuns } from "./api";
import { describeFetchError } from "./documentFormat";
import ExtractionRunLedger from "./ExtractionRunLedger";
import TriggerExtractionRun from "./TriggerExtractionRun";
import type { ExtractionRun } from "./types";

interface VersionExtractionRunsProps {
  documentId: string;
  documentVersionId: string;
  isArchived: boolean;
  canTrigger?: boolean;
}

type RunStatus = "idle" | "loading" | "ready" | "error";

export default function VersionExtractionRuns({
  documentId,
  documentVersionId,
  isArchived,
  canTrigger = false,
}: VersionExtractionRunsProps) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [runs, setRuns] = useState<ExtractionRun[]>([]);

  const loadRuns = useCallback(async (): Promise<void> => {
    setStatus("loading");
    setErrorMessage(null);

    try {
      const response = await fetchDocumentVersionExtractionRuns(documentId, documentVersionId);
      setRuns(response.items);
      setStatus("ready");
    } catch (error: unknown) {
      setErrorMessage(describeFetchError(error, "Unable to load Extraction Runs."));
      setStatus("error");
    }
  }, [documentId, documentVersionId]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    void loadRuns();
  }, [expanded, loadRuns]);

  function handleToggle(): void {
    setExpanded((current) => !current);
  }

  function handleRunCompleted(): void {
    if (expanded) {
      void loadRuns();
    }
  }

  const countLabel =
    status === "ready"
      ? `Extraction dossier · ${runs.length} run${runs.length === 1 ? "" : "s"}`
      : "Extraction dossier";

  const showTrigger = canTrigger && !isArchived;

  return (
    <section className="version-extraction-panel" aria-labelledby={`extraction-${documentVersionId}`}>
      <button
        type="button"
        id={`extraction-${documentVersionId}`}
        className={`version-extraction-toggle${expanded ? " open" : ""}`}
        aria-expanded={expanded}
        onClick={handleToggle}
      >
        <span className="version-extraction-toggle-label">{countLabel}</span>
        <span className="version-extraction-toggle-hint">{expanded ? "Collapse" : "Expand"}</span>
      </button>

      {expanded ? (
        <div className="version-extraction-body reveal">
          {isArchived ? (
            <p className="version-extraction-note">
              Archived versions retain Extraction Run history even when source files are unavailable.
            </p>
          ) : null}

          {showTrigger ? (
            <TriggerExtractionRun
              documentId={documentId}
              documentVersionId={documentVersionId}
              onCompleted={handleRunCompleted}
            />
          ) : null}

          {status === "loading" ? (
            <p className="catalog-status compact">
              <span className="catalog-status-rule" aria-hidden="true" />
              Opening extraction ledger…
            </p>
          ) : null}

          {status === "error" ? <p className="error-banner">{errorMessage}</p> : null}

          {status === "ready" ? (
            <ExtractionRunLedger
              runs={runs}
              emptyMessage="No Extraction Runs have been executed against this Document Version yet."
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
