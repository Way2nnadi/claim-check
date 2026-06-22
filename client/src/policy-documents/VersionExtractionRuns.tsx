import type { ExtractionRun } from "../extraction-runs/types";
import { describeFetchError } from "./format";
import { useCallback, useEffect, useState } from "react";
import { fetchDocumentVersionExtractionRuns } from "../extraction-runs/api";

import ExtractionRunLedger from "../extraction-runs/ExtractionRunLedger";
import TriggerExtractionRun from "../extraction-runs/TriggerExtractionRun";

interface VersionExtractionRunsProps {
  documentId: string;
  documentVersionId: string;
  isArchived: boolean;
  canTrigger?: boolean;
}

type RunStatus = "idle" | "loading" | "ready" | "error";

function ExtractionChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`version-extraction-chevron${open ? " open" : ""}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
      ? `${runs.length} extraction run${runs.length === 1 ? "" : "s"}`
      : "Extraction runs";

  const toggleLabel = expanded ? "Collapse extraction runs" : "Expand extraction runs";

  const showTrigger = canTrigger && !isArchived;

  return (
    <section className="version-extraction-panel" aria-labelledby={`extraction-${documentVersionId}`}>
      <button
        type="button"
        id={`extraction-${documentVersionId}`}
        className={`version-extraction-toggle${expanded ? " open" : ""}`}
        aria-expanded={expanded}
        aria-label={toggleLabel}
        onClick={handleToggle}
      >
        <ExtractionChevron open={expanded} />
        <span className="version-extraction-toggle-label">{countLabel}</span>
      </button>

      {expanded ? (
        <div className="version-extraction-body reveal">
          {isArchived ? (
            <p className="version-extraction-note">
              Archived versions retain extraction run history even when source files are unavailable.
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
            <p className="catalog-status compact">Loading…</p>
          ) : null}

          {status === "error" ? <p className="error-banner">{errorMessage}</p> : null}

          {status === "ready" ? (
            <ExtractionRunLedger
              runs={runs}
              emptyMessage="No extraction runs yet."
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
