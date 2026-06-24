import type { ComplianceEvaluationRun } from "../compliance-evaluation-runs/types";
import type { ComplianceReviewOutcomeFilter, ComplianceReviewQueueItem } from "./types";
import {
  COMPLIANCE_REVIEW_OUTCOME_TABS,
  formatComplianceOutcome,
  complianceOutcomeTone,
  formatQueueItemHeadline,
  formatQueueItemSecondary,
  outcomeRowClassName,
  summarizeReviewQueueItem,
} from "./format";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import StatusPill from "../shared/ui/StatusPill";
import TablePagination, {
  TABLE_PAGE_SIZE,
  paginateItems,
} from "../shared/ui/TablePagination";
import { formatRelativeTime } from "../shared/format/relativeTime";

interface ComplianceReviewLedgerProps {
  items: ComplianceReviewQueueItem[];
  scopeLabel: string;
  outcomeFilter: ComplianceReviewOutcomeFilter;
  tabCounts: Partial<Record<ComplianceReviewOutcomeFilter, number>>;
  selectedReviewId: string | null;
  onOutcomeFilterChange: (filter: ComplianceReviewOutcomeFilter) => void;
  onOpenReview: (complianceReviewId: string) => void;
  emptyMessage?: string;
  emptyHint?: string | null;
}

export default function ComplianceReviewLedger({
  items,
  scopeLabel,
  outcomeFilter,
  tabCounts,
  selectedReviewId,
  onOutcomeFilterChange,
  onOpenReview,
  emptyMessage = "No Evaluation Outcomes require human review.",
  emptyHint = "Run a Compliance Evaluation against an Expense Report to populate this queue.",
}: ComplianceReviewLedgerProps) {
  const [page, setPage] = useState(1);
  const reviewRowRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    setPage(1);
  }, [items, outcomeFilter]);

  const pagination = useMemo(
    () => paginateItems(items, page, TABLE_PAGE_SIZE),
    [items, page],
  );

  const visibleItems = pagination.items;

  useEffect(() => {
    reviewRowRefs.current.length = visibleItems.length;
  }, [visibleItems.length]);

  function focusReviewRow(index: number): void {
    reviewRowRefs.current[index]?.focus();
  }

  function handleReviewRowKeyDown(
    event: KeyboardEvent<HTMLElement>,
    index: number,
    complianceReviewId: string,
  ): void {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusReviewRow(Math.min(index + 1, visibleItems.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusReviewRow(Math.max(index - 1, 0));
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusReviewRow(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      focusReviewRow(visibleItems.length - 1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenReview(complianceReviewId);
    }
  }

  return (
    <div className="extraction-ledger-wrap review-ledger-wrap">
      <div className="review-ledger-head">
        <p className="catalog-scope">{scopeLabel}</p>

        <div
          className="notion-filter-tabs"
          role="tablist"
          aria-label="Filter by outcome type"
        >
          {COMPLIANCE_REVIEW_OUTCOME_TABS.map((tab) => {
            const isSelected = outcomeFilter === tab.id;
            const count = tabCounts[tab.id];

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`compliance-review-outcome-tab-${tab.id}`}
                className={`notion-filter-tab${isSelected ? " is-active" : ""}`}
                aria-selected={isSelected}
                aria-controls="compliance-review-queue-panel"
                onClick={() => onOutcomeFilterChange(tab.id)}
              >
                <span className="notion-filter-tab-label">{tab.label}</span>
                {count !== undefined ? (
                  <span className="notion-filter-tab-count">{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {items.length === 0 ? (
        <div
          id="compliance-review-queue-panel"
          className="extraction-empty compact reveal"
          role="tabpanel"
          aria-labelledby={`compliance-review-outcome-tab-${outcomeFilter}`}
        >
          <p>{emptyMessage}</p>
          {emptyHint ? <p className="review-empty-hint">{emptyHint}</p> : null}
        </div>
      ) : (
        <>
          <ol
            id="compliance-review-queue-panel"
            className="review-ledger"
            role="tabpanel"
            aria-labelledby={`compliance-review-outcome-tab-${outcomeFilter}`}
            aria-label="Compliance Review queue"
            aria-describedby={
              pagination.totalCount > TABLE_PAGE_SIZE
                ? "compliance-review-queue-pagination-range"
                : undefined
            }
          >
            {visibleItems.map((item, index) => {
              const isSelected = item.compliance_review_id === selectedReviewId;
              const outcomeClass = outcomeRowClassName(item.outcome);
              return (
                <li key={item.compliance_review_id}>
                  <article
                    ref={(element) => {
                      reviewRowRefs.current[index] = element;
                    }}
                    className={`review-row reveal ${outcomeClass}${isSelected ? " selected" : ""}`}
                    tabIndex={0}
                    role="button"
                    aria-pressed={isSelected}
                    aria-label={summarizeReviewQueueItem(item)}
                    onClick={() => onOpenReview(item.compliance_review_id)}
                    onKeyDown={(event) =>
                      handleReviewRowKeyDown(
                        event,
                        index,
                        item.compliance_review_id,
                      )
                    }
                  >
                    <div className="review-row-body">
                      <p className="review-statement">{formatQueueItemHeadline(item)}</p>
                      <p className="compliance-review-row-rationale">
                        {formatQueueItemSecondary(item)}
                      </p>
                      <div className="review-row-head">
                        <div className="review-row-idline">
                          <StatusPill
                            label={formatComplianceOutcome(item.outcome)}
                            variant={complianceOutcomeTone(item.outcome)}
                          />
                          <span className="compliance-review-row-time">
                            {formatRelativeTime(item.executed_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
          <TablePagination
            page={pagination.page}
            pageSize={TABLE_PAGE_SIZE}
            totalCount={pagination.totalCount}
            onPageChange={setPage}
            itemLabel="reviews"
            idPrefix="compliance-review-queue-pagination"
          />
        </>
      )}
    </div>
  );
}

export function actionableCountForRun(run: ComplianceEvaluationRun): number {
  return (
    run.summary.violation_count +
    run.summary.needs_review_count +
    run.summary.missing_evidence_count
  );
}
