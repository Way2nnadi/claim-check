import type { CSSProperties } from "react";
import {
  enforceabilityClassName,
  formatEnforceabilityClass,
  formatLifecycleState,
  lifecycleStateClassName,
  truncateStatement,
} from "./candidateRuleFormat";
import type { CandidateRuleReview } from "./types";

interface CandidateRuleLedgerProps {
  reviews: CandidateRuleReview[];
  onOpenReview: (candidateRuleId: string) => void;
  emptyMessage?: string;
  selectedCandidateRuleId?: string | null;
  showEmptyHint?: boolean;
}

export default function CandidateRuleLedger({
  reviews,
  onOpenReview,
  emptyMessage = "No Candidate Rules are waiting in this queue.",
  selectedCandidateRuleId = null,
  showEmptyHint = true,
}: CandidateRuleLedgerProps) {
  if (reviews.length === 0) {
    return (
      <div className="review-empty reveal">
        <span className="folio">Approval desk · clear</span>
        <p>{emptyMessage}</p>
        {showEmptyHint ? (
          <p className="review-empty-hint">
            Extracted Rules appear here after an Extraction Run completes. Adjust filters if you
            expected to see pending work.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <ol className="review-ledger" aria-label="Candidate Rule review queue">
      {reviews.map((review, index) => {
        const rule = review.current_rule;
        const citation = rule.citation;
        const qaCount = review.qa_flags.length;
        const lifecycleClass = lifecycleStateClassName(review.lifecycle_state);
        const enforceabilityClass = enforceabilityClassName(rule.enforceability_class);
        const isSelected = selectedCandidateRuleId === review.candidate_rule_id;

        return (
          <li key={review.candidate_rule_id}>
            <button
              type="button"
              className={`review-row reveal lifecycle-${lifecycleClass}${isSelected ? " selected" : ""}`}
              style={{ "--reveal-delay": `${40 + index * 50}ms` } as CSSProperties}
              onClick={() => onOpenReview(review.candidate_rule_id)}
              aria-pressed={isSelected}
            >
              <header className="review-row-head">
                <div className="review-row-idline">
                  <code>{review.candidate_rule_id}</code>
                  <span className={`review-lifecycle ${lifecycleClass}`}>
                    {formatLifecycleState(review.lifecycle_state)}
                  </span>
                  <span className={`review-enforceability ${enforceabilityClass}`}>
                    {formatEnforceabilityClass(rule.enforceability_class)}
                  </span>
                </div>
                <span
                  className={`review-qa-count${qaCount > 0 ? " flagged" : " clear"}`}
                  aria-label={`${qaCount} QA flag${qaCount === 1 ? "" : "s"}`}
                >
                  {qaCount} QA
                </span>
              </header>

              <p className="review-statement">{truncateStatement(rule.statement)}</p>

              <dl className="review-meta-grid">
                {citation ? (
                  <>
                    <div>
                      <dt>Document</dt>
                      <dd>{citation.document_id}</dd>
                    </div>
                    <div>
                      <dt>Version</dt>
                      <dd>{citation.document_version_id}</dd>
                    </div>
                  </>
                ) : null}
                {rule.origin.extraction_run_id ? (
                  <div>
                    <dt>Extraction run</dt>
                    <dd>{rule.origin.extraction_run_id}</dd>
                  </div>
                ) : null}
                {rule.scope.expense_category ? (
                  <div>
                    <dt>Category</dt>
                    <dd>{rule.scope.expense_category}</dd>
                  </div>
                ) : null}
              </dl>

              <span className="review-open-hint">Open dossier</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
