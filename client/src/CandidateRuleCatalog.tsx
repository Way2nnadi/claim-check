import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { fetchCandidateRules, fetchPolicyDocuments } from "./api";
import CandidateRuleDetail from "./CandidateRuleDetail";
import CandidateRuleLedger from "./CandidateRuleLedger";
import {
  ALL_LIFECYCLE_STATES,
  LIFECYCLE_TABS,
  REVIEW_QUEUE_LIFECYCLE_STATES,
  describeCandidateRuleError,
  emptyMessageForLifecycleTab,
  filterReviewsForTab,
  formatLifecycleState,
  isDefaultCustomSelection,
  showEmptyStateHint,
  type LifecycleTabId,
} from "./candidateRuleFormat";
import DocumentFilterPicker from "./DocumentFilterPicker";
import type {
  AuthenticatedPrincipal,
  CandidateRuleFilters,
  CandidateRuleReview,
  LifecycleState,
  PolicyDocumentSummary,
} from "./types";

interface CandidateRuleCatalogProps {
  principal: AuthenticatedPrincipal;
}

type CatalogStatus = "loading" | "ready" | "error";

interface ScopeFilters {
  documentId: string;
  documentVersionId: string;
  extractionRunId: string;
}

function countScopeFilters(filters: CandidateRuleFilters): number {
  return (
    Number(Boolean(filters.documentId)) +
    Number(Boolean(filters.documentVersionId)) +
    Number(Boolean(filters.extractionRunId))
  );
}

function buildScopeFilters(scope: ScopeFilters): CandidateRuleFilters {
  const filters: CandidateRuleFilters = {};
  const trimmedDocumentId = scope.documentId.trim();
  const trimmedVersionId = scope.documentVersionId.trim();
  const trimmedExtractionRunId = scope.extractionRunId.trim();

  if (trimmedDocumentId) {
    filters.documentId = trimmedDocumentId;
  }
  if (trimmedVersionId) {
    filters.documentVersionId = trimmedVersionId;
  }
  if (trimmedExtractionRunId) {
    filters.extractionRunId = trimmedExtractionRunId;
  }

  return filters;
}

export default function CandidateRuleCatalog({ principal }: CandidateRuleCatalogProps) {
  const [status, setStatus] = useState<CatalogStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [documents, setDocuments] = useState<PolicyDocumentSummary[]>([]);
  const [reviews, setReviews] = useState<CandidateRuleReview[]>([]);
  const [selectedCandidateRuleId, setSelectedCandidateRuleId] = useState<string | null>(null);
  const [lifecycleTab, setLifecycleTab] = useState<LifecycleTabId>("queue");
  const [customLifecycleSelection, setCustomLifecycleSelection] = useState<Set<LifecycleState>>(
    () => new Set(REVIEW_QUEUE_LIFECYCLE_STATES),
  );
  const [scopeDraft, setScopeDraft] = useState<ScopeFilters>({
    documentId: "",
    documentVersionId: "",
    extractionRunId: "",
  });
  const [appliedScopeFilters, setAppliedScopeFilters] = useState<CandidateRuleFilters>(() =>
    buildScopeFilters({
      documentId: "",
      documentVersionId: "",
      extractionRunId: "",
    }),
  );

  const loadReviews = useCallback(async (filters: CandidateRuleFilters): Promise<void> => {
    setStatus("loading");
    setErrorMessage(null);

    try {
      const [documentsResponse, reviewsResponse] = await Promise.all([
        fetchPolicyDocuments(),
        fetchCandidateRules(filters),
      ]);
      setDocuments(documentsResponse.items);
      setReviews(reviewsResponse.items);
      setStatus("ready");
    } catch (error: unknown) {
      setErrorMessage(
        describeCandidateRuleError(error, "Unable to load the Candidate Rule review queue."),
      );
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadReviews(appliedScopeFilters);
  }, [appliedScopeFilters, loadReviews]);

  const customSelection = useMemo(
    () => [...customLifecycleSelection],
    [customLifecycleSelection],
  );

  const displayedReviews = useMemo(
    () => filterReviewsForTab(reviews, lifecycleTab, customSelection),
    [customSelection, lifecycleTab, reviews],
  );

  const tabCounts = useMemo(() => {
    if (status !== "ready") {
      return {} as Partial<Record<LifecycleTabId, number>>;
    }

    const counts: Partial<Record<LifecycleTabId, number>> = {};
    for (const tab of LIFECYCLE_TABS) {
      counts[tab.id] = filterReviewsForTab(reviews, tab.id, customSelection).length;
    }
    return counts;
  }, [customSelection, reviews, status]);

  function applyLifecycleTab(tab: LifecycleTabId): void {
    setLifecycleTab(tab);
  }

  function handleCustomLifecycleToggle(state: LifecycleState): void {
    setCustomLifecycleSelection((current) => {
      const next = new Set(current);
      if (next.has(state)) {
        next.delete(state);
      } else {
        next.add(state);
      }
      return next;
    });
    setLifecycleTab("custom");
  }

  function handleScopeSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setAppliedScopeFilters(buildScopeFilters(scopeDraft));
  }

  function handleClearScope(): void {
    const clearedScope: ScopeFilters = {
      documentId: "",
      documentVersionId: "",
      extractionRunId: "",
    };
    setScopeDraft(clearedScope);
    setAppliedScopeFilters(buildScopeFilters(clearedScope));
  }

  const scopeFilterCount = countScopeFilters(appliedScopeFilters);

  const scopeActiveInDraft =
    Boolean(scopeDraft.documentId.trim()) ||
    Boolean(scopeDraft.documentVersionId.trim()) ||
    Boolean(scopeDraft.extractionRunId.trim());

  const hasNonDefaultFilters =
    scopeFilterCount > 0 ||
    (lifecycleTab === "custom" && !isDefaultCustomSelection(customSelection));

  if (selectedCandidateRuleId) {
    return (
      <CandidateRuleDetail
        candidateRuleId={selectedCandidateRuleId}
        principal={principal}
        onBack={() => setSelectedCandidateRuleId(null)}
      />
    );
  }

  return (
    <div className="catalog-page review-catalog content-enter">
      <div className="review-toolbar reveal">
        <div
          className="catalog-tabs"
          role="tablist"
          aria-label="Filter by lifecycle state"
        >
          {LIFECYCLE_TABS.map((tab) => {
            const isSelected = lifecycleTab === tab.id;
            const count = tabCounts[tab.id];

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`review-lifecycle-tab-${tab.id}`}
                className={`catalog-tab${isSelected ? " active" : ""}${tab.id !== "all" && tab.id !== "custom" ? ` ${tab.id}` : ""}`}
                aria-selected={isSelected}
                aria-controls="review-rule-panel"
                onClick={() => applyLifecycleTab(tab.id)}
              >
                <span>{tab.label}</span>
                {count !== undefined && (count > 0 || isSelected) ? (
                  <span className="catalog-tab-count">{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {lifecycleTab === "custom" ? (
          <fieldset className="review-lifecycle-custom">
            <legend>Custom lifecycle</legend>
            {ALL_LIFECYCLE_STATES.map((state) => (
              <label key={state} className="review-lifecycle-option">
                <input
                  type="checkbox"
                  checked={customLifecycleSelection.has(state)}
                  onChange={() => handleCustomLifecycleToggle(state)}
                />
                <span>{formatLifecycleState(state)}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

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
              <label htmlFor="review-filter-version">
                Document version id
                <input
                  id="review-filter-version"
                  name="review-filter-version"
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
              {scopeDraft.documentId.trim() ? (
                <label htmlFor="review-filter-extraction-run">
                  Extraction run id
                  <input
                    id="review-filter-extraction-run"
                    name="review-filter-extraction-run"
                    value={scopeDraft.extractionRunId}
                    placeholder="extract-…"
                    spellCheck={false}
                    onChange={(event) =>
                      setScopeDraft((current) => ({
                        ...current,
                        extractionRunId: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : null}
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
      </div>

      {status === "loading" ? (
        <p className="catalog-status">
          <span className="catalog-status-rule" aria-hidden="true" />
          Indexing Candidate Rules…
        </p>
      ) : null}

      {status === "error" ? <p className="error-banner">{errorMessage}</p> : null}

      {status === "ready" ? (
        <>
          {scopeFilterCount > 0 ? (
            <p className="review-scope-chips">
              {appliedScopeFilters.documentId ? appliedScopeFilters.documentId : null}
              {appliedScopeFilters.documentId && appliedScopeFilters.documentVersionId ? " · " : null}
              {appliedScopeFilters.documentVersionId ? appliedScopeFilters.documentVersionId : null}
              {(appliedScopeFilters.documentId || appliedScopeFilters.documentVersionId) &&
              appliedScopeFilters.extractionRunId
                ? " · "
                : null}
              {appliedScopeFilters.extractionRunId ? appliedScopeFilters.extractionRunId : null}
            </p>
          ) : null}
          <div id="review-rule-panel" role="tabpanel" aria-labelledby={`review-lifecycle-tab-${lifecycleTab}`}>
            <CandidateRuleLedger
              reviews={displayedReviews}
              onOpenReview={setSelectedCandidateRuleId}
              emptyMessage={emptyMessageForLifecycleTab(lifecycleTab, hasNonDefaultFilters)}
              showEmptyHint={showEmptyStateHint(lifecycleTab)}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
