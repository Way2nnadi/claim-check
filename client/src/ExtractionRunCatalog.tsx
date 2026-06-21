import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { fetchExtractionRuns, fetchPolicyDocuments } from "./api";
import DocumentFilterPicker from "./DocumentFilterPicker";
import { describeFetchError } from "./documentFormat";
import ExtractionRunLedger from "./ExtractionRunLedger";
import type { ExtractionRun, ExtractionRunFilters, PolicyDocumentSummary } from "./types";

type CatalogStatus = "loading" | "ready" | "error";

export default function ExtractionRunCatalog() {
  const [status, setStatus] = useState<CatalogStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [documents, setDocuments] = useState<PolicyDocumentSummary[]>([]);
  const [runs, setRuns] = useState<ExtractionRun[]>([]);
  const [documentFilter, setDocumentFilter] = useState("");
  const [versionFilter, setVersionFilter] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<ExtractionRunFilters>({});

  const loadRuns = useCallback(async (filters: ExtractionRunFilters): Promise<void> => {
    setStatus("loading");
    setErrorMessage(null);

    try {
      const [documentsResponse, runsResponse] = await Promise.all([
        fetchPolicyDocuments(),
        fetchExtractionRuns(filters),
      ]);
      setDocuments(documentsResponse.items);
      setRuns(runsResponse.items);
      setStatus("ready");
    } catch (error: unknown) {
      setErrorMessage(describeFetchError(error, "Unable to load Extraction Run history."));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadRuns({});
  }, [loadRuns]);

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const nextFilters: ExtractionRunFilters = {};
    const trimmedDocumentId = documentFilter.trim();
    const trimmedVersionId = versionFilter.trim();
    if (trimmedDocumentId) {
      nextFilters.documentId = trimmedDocumentId;
    }
    if (trimmedVersionId) {
      nextFilters.documentVersionId = trimmedVersionId;
    }
    setAppliedFilters(nextFilters);
    void loadRuns(nextFilters);
  }

  function handleClearFilters(): void {
    setDocumentFilter("");
    setVersionFilter("");
    setAppliedFilters({});
    void loadRuns({});
  }

  const activeFilterCount =
    Number(Boolean(appliedFilters.documentId)) + Number(Boolean(appliedFilters.documentVersionId));

  return (
    <div className="extraction-catalog content-enter">
      <header className="extraction-catalog-head reveal">
        <span className="folio">Extraction log · archive</span>
        <p className="extraction-catalog-lede">
          Each run records the document version, prompt, and model used. Failed runs include error
          details.
        </p>
      </header>

      <form className="extraction-filter reveal" onSubmit={handleFilterSubmit}>
        <div className="extraction-filter-grid">
          <DocumentFilterPicker
            value={documentFilter}
            documents={documents}
            onChange={setDocumentFilter}
          />
          <label htmlFor="extraction-filter-version">
            Document version id
            <input
              id="extraction-filter-version"
              name="extraction-filter-version"
              value={versionFilter}
              placeholder="docv-…"
              spellCheck={false}
              onChange={(event) => setVersionFilter(event.target.value)}
            />
          </label>
        </div>
        <div className="extraction-filter-actions">
          <button type="submit" className="extraction-filter-apply">
            Apply filters
          </button>
          <button
            type="button"
            className="extraction-filter-clear"
            disabled={activeFilterCount === 0 && !documentFilter && !versionFilter}
            onClick={handleClearFilters}
          >
            Clear
          </button>
          {activeFilterCount > 0 ? (
            <p className="extraction-filter-active">
              {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active
            </p>
          ) : null}
        </div>
      </form>

      {status === "loading" ? (
        <p className="catalog-status">
          <span className="catalog-status-rule" aria-hidden="true" />
          Indexing extraction runs…
        </p>
      ) : null}

      {status === "error" ? <p className="error-banner">{errorMessage}</p> : null}

      {status === "ready" ? (
        <>
          {activeFilterCount > 0 ? (
            <p className="extraction-catalog-scope">
              {appliedFilters.documentId ? appliedFilters.documentId : null}
              {appliedFilters.documentId && appliedFilters.documentVersionId ? " · " : null}
              {appliedFilters.documentVersionId ? appliedFilters.documentVersionId : null}
            </p>
          ) : null}
          <ExtractionRunLedger
            runs={runs}
            showDocumentContext
            emptyMessage={
              activeFilterCount > 0
                ? "No Extraction Runs match the current filters."
                : "No Extraction Runs have been recorded yet."
            }
            filteredEmptyMessage="No Extraction Runs with this status in the current scope."
          />
        </>
      ) : null}
    </div>
  );
}
