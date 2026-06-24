import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAllComplianceEvaluationRuns } from "../compliance-evaluation-runs/api";
import { fetchComplianceReviews } from "./api";
import type { ComplianceReviewOutcomeFilter, ComplianceReviewQueueItem } from "./types";
import { describeComplianceReviewError } from "./format";
import { useAsyncResource } from "../shared/ui/useAsyncResource";
import type { AuthenticatedPrincipal } from "../shared/auth/types";
import { shortenId } from "../shared/format/common";

import ComplianceReviewDetailView from "./ComplianceReviewDetail";
import ComplianceReviewLedger from "./ComplianceReviewLedger";
import EvaluationRunFilterPicker from "./EvaluationRunFilterPicker";

interface ComplianceReviewCatalogProps {
  principal: AuthenticatedPrincipal;
  initialRunId?: string | null;
}

type CatalogStatus = "loading" | "ready" | "error";

function countItemsByOutcome(
  items: readonly ComplianceReviewQueueItem[],
): Partial<Record<ComplianceReviewOutcomeFilter, number>> {
  const counts: Partial<Record<ComplianceReviewOutcomeFilter, number>> = {
    all: items.length,
    violation: 0,
    needs_review: 0,
    missing_evidence: 0,
  };

  for (const item of items) {
    if (item.outcome === "violation") {
      counts.violation = (counts.violation ?? 0) + 1;
    } else if (item.outcome === "needs_review") {
      counts.needs_review = (counts.needs_review ?? 0) + 1;
    } else if (item.outcome === "missing_evidence") {
      counts.missing_evidence = (counts.missing_evidence ?? 0) + 1;
    }
  }

  return counts;
}

export default function ComplianceReviewCatalog({
  principal,
  initialRunId = null,
}: ComplianceReviewCatalogProps) {
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId);
  const [outcomeFilter, setOutcomeFilter] =
    useState<ComplianceReviewOutcomeFilter>("all");
  const [includeViolations, setIncludeViolations] = useState(true);
  const [status, setStatus] = useState<CatalogStatus>("loading");
  const [queueItems, setQueueItems] = useState<ComplianceReviewQueueItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const runsResource = useAsyncResource(
    fetchAllComplianceEvaluationRuns,
    "Unable to load Evaluation Runs.",
  );
  const evaluationRuns = runsResource.data ?? [];

  useEffect(() => {
    if (initialRunId) {
      setSelectedRunId(initialRunId);
    }
  }, [initialRunId]);

  const loadQueue = useCallback(async () => {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const response = await fetchComplianceReviews({
        complianceEvaluationRunId: selectedRunId,
        includeViolations,
      });
      setQueueItems(response.items);
      setStatus("ready");
    } catch (error: unknown) {
      setErrorMessage(
        describeComplianceReviewError(error, "Unable to load Compliance Review queue."),
      );
      setStatus("error");
    }
  }, [selectedRunId, includeViolations]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const tabCounts = useMemo(
    () => countItemsByOutcome(queueItems),
    [queueItems],
  );

  const displayedItems = useMemo(() => {
    if (outcomeFilter === "all") {
      return queueItems;
    }
    return queueItems.filter((item) => item.outcome === outcomeFilter);
  }, [queueItems, outcomeFilter]);

  const scopeLabel = useMemo(() => {
    const countLabel = `${displayedItems.length} awaiting review`;
    if (!selectedRunId) {
      return countLabel;
    }
    return `${countLabel} · Run ${shortenId(selectedRunId, 12)}`;
  }, [displayedItems.length, selectedRunId]);

  const activeScopeCount =
    (selectedRunId ? 1 : 0) + (includeViolations ? 0 : 1);

  const selectedRun = useMemo(
    () =>
      evaluationRuns.find(
        (run) => run.compliance_evaluation_run_id === selectedRunId,
      ) ?? null,
    [evaluationRuns, selectedRunId],
  );

  function clearScopeFilters(): void {
    setSelectedRunId(null);
    setIncludeViolations(true);
  }

  if (selectedReviewId) {
    return (
      <ComplianceReviewDetailView
        complianceReviewId={selectedReviewId}
        principal={principal}
        onBack={() => setSelectedReviewId(null)}
        onResolved={() => void loadQueue()}
      />
    );
  }

  return (
    <div className="catalog-page review-catalog-page content-enter">
      <details className="review-scope-panel notion-scope-panel">
        <summary>
          Scope filters
          {activeScopeCount > 0 ? (
            <span className="review-scope-panel-badge">
              {activeScopeCount} active
            </span>
          ) : null}
        </summary>

        {activeScopeCount > 0 ? (
          <div className="scope-applied-filters">
            {selectedRun ? (
              <p className="scope-applied-filter">
                <span className="scope-applied-filter-label">Evaluation run</span>
                <code>{selectedRun.compliance_evaluation_run_id}</code>
              </p>
            ) : null}
            {!includeViolations ? (
              <p className="scope-applied-filter">
                <span className="scope-applied-filter-label">Violations</span>
                <span>Excluded from queue</span>
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="review-scope-form compliance-review-scope-form">
          <EvaluationRunFilterPicker
            value={selectedRunId ?? ""}
            runs={evaluationRuns}
            onChange={(runId) => setSelectedRunId(runId || null)}
          />

          <div className="review-filter-actions compliance-review-scope-actions">
            <label
              className="compliance-review-scope-toggle"
              htmlFor="compliance-review-include-violations"
            >
              <input
                id="compliance-review-include-violations"
                type="checkbox"
                checked={includeViolations}
                onChange={(event) => setIncludeViolations(event.target.checked)}
              />
              Include violations
            </label>

            <button
              type="button"
              className="document-command"
              disabled={activeScopeCount === 0}
              onClick={clearScopeFilters}
            >
              Clear filters
            </button>
          </div>
        </div>
      </details>

      {status === "loading" ? (
        <p className="catalog-status">
          <span className="catalog-status-rule" aria-hidden="true" />
          Loading review queue…
        </p>
      ) : null}

      {status === "error" ? (
        <p className="error-banner">{errorMessage}</p>
      ) : null}

      {status === "ready" ? (
        <ComplianceReviewLedger
          items={displayedItems}
          scopeLabel={scopeLabel}
          outcomeFilter={outcomeFilter}
          tabCounts={tabCounts}
          selectedReviewId={selectedReviewId}
          onOutcomeFilterChange={setOutcomeFilter}
          onOpenReview={setSelectedReviewId}
          emptyMessage={
            selectedRunId
              ? "No actionable outcomes in this Evaluation Run."
              : outcomeFilter === "all"
                ? "No Evaluation Outcomes require human review."
                : `No ${outcomeFilter.replace("_", " ")} outcomes in this view.`
          }
          emptyHint={
            selectedRunId || !includeViolations
              ? "Try clearing scope filters or switching outcome tabs."
              : "Execute a Compliance Evaluation Run to populate this queue."
          }
        />
      ) : null}
    </div>
  );
}
