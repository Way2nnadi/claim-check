import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { fetchExtractionRuns, fetchPolicyDocuments } from "./api";
import DocumentFilterPicker from "./DocumentFilterPicker";
import { describeFetchError } from "./documentFormat";
import ExtractionRunLedger from "./ExtractionRunLedger";
import type { ExtractionRun, ExtractionRunFilters, PolicyDocumentSummary } from "./types";

type CatalogStatus = "loading" | "ready" | "error";

interface ScopeFilters {
  documentId: string;
  documentVersionId: string;
}

function countScopeFilters(filters: ExtractionRunFilters): number {
  return (
    Number(Boolean(filters.documentId)) + Number(Boolean(filters.documentVersionId))
  );
}

function buildFilters(scope: ScopeFilters): ExtractionRunFilters {
  const filters: ExtractionRunFilters = {};
  const trimmedDocumentId = scope.documentId.trim();
  const trimmedVersionId = scope.documentVersionId.trim();

  if (trimmedDocumentId) {
    filters.documentId = trimmedDocumentId;
  }
  if (trimmedVersionId) {
    filters.documentVersionId = trimmedVersionId;
  }

  return filters;
}

export default function ExtractionRunCatalog() {
  const [status, setStatus] = useState<CatalogStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [documents, setDocuments] = useState<PolicyDocumentSummary[]>([]);
  const [runs, setRuns] = useState<ExtractionRun[]>([]);
  const [scopeDraft, setScopeDraft] = useState<ScopeFilters>({
    documentId: "",
    documentVersionId: "",
  });
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
    void loadRuns(appliedFilters);
  }, [appliedFilters, loadRuns]);

  function handleScopeSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setAppliedFilters(buildFilters(scopeDraft));
  }

  function handleClearScope(): void {
    const clearedScope: ScopeFilters = { documentId: "", documentVersionId: "" };
    setScopeDraft(clearedScope);
    setAppliedFilters({});
  }

  const scopeFilterCount = countScopeFilters(appliedFilters);
  const scopeActiveInDraft =
    Boolean(scopeDraft.documentId.trim()) || Boolean(scopeDraft.documentVersionId.trim());

  return (
    <div className="catalog-page content-enter">
      <details className="review-scope-panel">
        <summary>
          Scope filters
          {scopeFilterCount > 0 ? (
            <span className="review-scope-panel-badge">{scopeFilterCount} active</span>
          ) : null}
        </summary>
        <form className="review-scope-form" onSubmit={handleScopeSubmit}>
          <div className="review-filter-grid">
            <DocumentFilterPicker
              value={scopeDraft.documentId}
              documents={documents}
              onChange={(value) => setScopeDraft((current) => ({ ...current, documentId: value }))}
            />
            <label htmlFor="extraction-filter-version">
              Document version id
              <input
                id="extraction-filter-version"
                name="extraction-filter-version"
                value={scopeDraft.documentVersionId}
                placeholder="docv-…"
                spellCheck={false}
                onChange={(event) =>
                  setScopeDraft((current) => ({
                    ...current,
                    documentVersionId: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <div className="review-filter-actions">
            <button type="submit" className="review-filter-apply">
              Apply scope
            </button>
            <button
              type="button"
              className="review-filter-clear"
              disabled={scopeFilterCount === 0 && !scopeActiveInDraft}
              onClick={handleClearScope}
            >
              Clear scope
            </button>
          </div>
        </form>
      </details>

      {status === "loading" ? (
        <p className="catalog-status">
          <span className="catalog-status-rule" aria-hidden="true" />
          Indexing extraction runs…
        </p>
      ) : null}

      {status === "error" ? <p className="error-banner">{errorMessage}</p> : null}

      {status === "ready" ? (
        <>
          {scopeFilterCount > 0 ? (
            <p className="catalog-scope">
              {appliedFilters.documentId ? appliedFilters.documentId : null}
              {appliedFilters.documentId && appliedFilters.documentVersionId ? " · " : null}
              {appliedFilters.documentVersionId ? appliedFilters.documentVersionId : null}
            </p>
          ) : null}
          <ExtractionRunLedger
            runs={runs}
            showDocumentContext
            emptyMessage={
              scopeFilterCount > 0
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
