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
  formatLifecycleState,
  isDefaultCustomSelection,
  lifecycleStatesForTab,
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

function buildFilters(
  lifecycleTab: LifecycleTabId,
  customLifecycleSelection: Set<LifecycleState>,
  scope: ScopeFilters,
): CandidateRuleFilters {
  const filters: CandidateRuleFilters = {};
  const lifecycleStates = lifecycleStatesForTab(lifecycleTab, [...customLifecycleSelection]);

  if (lifecycleStates) {
    filters.lifecycleStates = lifecycleStates;
  }

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
  const [appliedFilters, setAppliedFilters] = useState<CandidateRuleFilters>(() =>
    buildFilters("queue", new Set(REVIEW_QUEUE_LIFECYCLE_STATES), {
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
    void loadReviews(appliedFilters);
  }, [appliedFilters, loadReviews]);

  function applyLifecycleTab(tab: LifecycleTabId): void {
    setLifecycleTab(tab);
    if (tab === "custom") {
      return;
    }
    setAppliedFilters(buildFilters(tab, customLifecycleSelection, scopeDraft));
  }

  function handleCustomLifecycleToggle(state: LifecycleState): void {
    setCustomLifecycleSelection((current) => {
      const next = new Set(current);
      if (next.has(state)) {
        next.delete(state);
      } else {
        next.add(state);
      }
      setLifecycleTab("custom");
      setAppliedFilters(
        buildFilters("custom", next, scopeDraft),
      );
      return next;
    });
  }

  function handleScopeSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setAppliedFilters(buildFilters(lifecycleTab, customLifecycleSelection, scopeDraft));
  }

  function handleClearScope(): void {
    const clearedScope: ScopeFilters = {
      documentId: "",
      documentVersionId: "",
      extractionRunId: "",
    };
    setScopeDraft(clearedScope);
    setAppliedFilters(buildFilters(lifecycleTab, customLifecycleSelection, clearedScope));
  }

  const scopeFilterCount = countScopeFilters(appliedFilters);
  const flaggedCount = reviews.filter((review) => review.qa_flags.length > 0).length;
  const displayedReviews = useMemo(() => {
    if (lifecycleTab !== "flagged") {
      return reviews;
    }
    return reviews.filter((review) => review.qa_flags.length > 0);
  }, [lifecycleTab, reviews]);

  const tabCounts: Partial<Record<LifecycleTabId, number>> = {};
  if (status === "ready") {
    tabCounts[lifecycleTab] =
      lifecycleTab === "flagged" ? displayedReviews.length : reviews.length;
    if (lifecycleTab !== "flagged" && flaggedCount > 0) {
      tabCounts.flagged = flaggedCount;
    }
  }

  const scopeActiveInDraft =
    Boolean(scopeDraft.documentId.trim()) ||
    Boolean(scopeDraft.documentVersionId.trim()) ||
    Boolean(scopeDraft.extractionRunId.trim());

  const hasNonDefaultFilters =
    scopeFilterCount > 0 ||
    (lifecycleTab === "custom" && !isDefaultCustomSelection([...customLifecycleSelection]));

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
    <div className="review-catalog content-enter">
      <header className="review-catalog-head reveal">
        <span className="folio">Approval desk · triage</span>
        <p className="review-catalog-lede">
          Extracted Candidate Rules await review before publication. QA flags and lifecycle
          state guide triage.
        </p>
      </header>

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
                {count !== undefined ? (
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
              {appliedFilters.documentId ? appliedFilters.documentId : null}
              {appliedFilters.documentId && appliedFilters.documentVersionId ? " · " : null}
              {appliedFilters.documentVersionId ? appliedFilters.documentVersionId : null}
              {(appliedFilters.documentId || appliedFilters.documentVersionId) &&
              appliedFilters.extractionRunId
                ? " · "
                : null}
              {appliedFilters.extractionRunId ? appliedFilters.extractionRunId : null}
            </p>
          ) : null}
          <div id="review-rule-panel" role="tabpanel" aria-labelledby={`review-lifecycle-tab-${lifecycleTab}`}>
            <CandidateRuleLedger
              reviews={displayedReviews}
              onOpenReview={setSelectedCandidateRuleId}
              emptyMessage={
                lifecycleTab === "flagged"
                  ? "No flagged Candidate Rules in the current scope."
                  : hasNonDefaultFilters
                    ? "No Candidate Rules match the current filters."
                    : lifecycleTab === "queue"
                      ? "The review queue is empty — no extracted Rules are waiting for triage."
                      : "No Candidate Rules match this lifecycle view."
              }
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
