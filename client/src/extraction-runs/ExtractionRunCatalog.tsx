import type { ExtractionRun, ExtractionRunFilters } from "./types";
import type { PolicyDocumentSummary } from "../policy-documents/types";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useAsyncResource } from "../shared/ui/useAsyncResource";
import { fetchExtractionRuns } from "./api";
import { fetchPolicyDocuments } from "../policy-documents/api";

import DocumentFilterPicker from "../policy-documents/DocumentFilterPicker";
import ExtractionRunLedger from "./ExtractionRunLedger";

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

interface ExtractionRunCatalogProps {
  onOpenRun?: (extractionRunId: string) => void;
}

interface ExtractionRunCatalogData {
  documents: PolicyDocumentSummary[];
  runs: ExtractionRun[];
}

export default function ExtractionRunCatalog({ onOpenRun }: ExtractionRunCatalogProps) {
  const [scopeDraft, setScopeDraft] = useState<ScopeFilters>({
    documentId: "",
    documentVersionId: "",
  });
  const [appliedFilters, setAppliedFilters] = useState<ExtractionRunFilters>({});

  const fetchCatalog = useCallback(async (): Promise<ExtractionRunCatalogData> => {
    const [documentsResponse, runsResponse] = await Promise.all([
      fetchPolicyDocuments(),
      fetchExtractionRuns(appliedFilters),
    ]);
    return {
      documents: documentsResponse.items,
      runs: runsResponse.items,
    };
  }, [appliedFilters]);

  const { status, data, error: errorMessage, reload } = useAsyncResource(
    fetchCatalog,
    "Unable to load Extraction Run history.",
    { loadOnMount: false },
  );
  const documents = data?.documents ?? [];
  const runs = data?.runs ?? [];

  useEffect(() => {
    void reload();
  }, [appliedFilters, reload]);

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
          Loading…
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
            onOpenRun={onOpenRun}
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
