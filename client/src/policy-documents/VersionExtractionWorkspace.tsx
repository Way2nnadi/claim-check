import type { ExtractionRun } from "../extraction-runs/types";
import { describeFetchError } from "./format";
import { useCallback, useEffect, useState } from "react";
import { fetchDocumentVersionExtractionRuns } from "../extraction-runs/api";

import ExtractionRunLedger from "../extraction-runs/ExtractionRunLedger";
import TriggerExtractionRun from "../extraction-runs/TriggerExtractionRun";

interface VersionExtractionWorkspaceProps {
  documentId: string;
  documentVersionId: string;
  isArchived: boolean;
  canTrigger?: boolean;
}

type RunStatus = "idle" | "loading" | "ready" | "error";

export default function VersionExtractionWorkspace({
  documentId,
  documentVersionId,
  isArchived,
  canTrigger = false,
}: VersionExtractionWorkspaceProps) {
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
    void loadRuns();
  }, [loadRuns]);

  const showTrigger = canTrigger && !isArchived;

  return (
    <div className="version-extraction-workspace">
      {isArchived ? (
        <p className="version-extraction-note">
          Archived versions retain extraction run history even when source files are unavailable.
        </p>
      ) : null}

      {showTrigger ? (
        <TriggerExtractionRun
          documentId={documentId}
          documentVersionId={documentVersionId}
          onCompleted={() => void loadRuns()}
        />
      ) : null}

      <div className="version-extraction-history">
        <h5 className="version-extraction-history-heading">Extraction history</h5>

        {status === "loading" ? (
          <p className="catalog-status compact">Loading…</p>
        ) : null}

        {status === "error" ? <p className="error-banner">{errorMessage}</p> : null}

        {status === "ready" ? (
          <ExtractionRunLedger runs={runs} emptyMessage="No extraction runs yet." />
        ) : null}
      </div>
    </div>
  );
}
