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
  emptyHint?: string | null;
}

export default function CandidateRuleLedger({
  reviews,
  onOpenReview,
  emptyMessage = "No Candidate Rules are waiting in this queue.",
  emptyHint = "Extracted Rules appear here after an Extraction Run completes.",
}: CandidateRuleLedgerProps) {
  return (
    <div className="review-rule-table-wrap">
      <table className="review-rule-table" aria-label="Candidate Rule review queue">
        <thead>
          <tr>
            <th scope="col">Rule statement</th>
            <th scope="col">Lifecycle</th>
            <th scope="col">Type</th>
            <th scope="col">QA</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {reviews.length === 0 ? (
            <tr className="review-empty-row">
              <td colSpan={5}>
                <div className="review-empty-inline">
                  <p>{emptyMessage}</p>
                  {emptyHint ? (
                    <p className="review-empty-hint">{emptyHint}</p>
                  ) : null}
                </div>
              </td>
            </tr>
          ) : (
            reviews.map((review) => {
              const rule = review.current_rule;
              const qaCount = review.qa_flags.length;
              const lifecycleClass = lifecycleStateClassName(review.lifecycle_state);
              const enforceabilityClass = enforceabilityClassName(rule.enforceability_class);
              const statement = truncateStatement(rule.statement, 120);

              return (
                <tr
                  key={review.candidate_rule_id}
                  className={`review-rule-row lifecycle-${lifecycleClass}`}
                >
                  <td className="review-rule-statement-cell">
                    <p className="review-rule-statement">{statement}</p>
                    {rule.scope.expense_category ? (
                      <span className="review-rule-category">{rule.scope.expense_category}</span>
                    ) : null}
                  </td>
                  <td>
                    <span className={`review-lifecycle ${lifecycleClass}`}>
                      {formatLifecycleState(review.lifecycle_state)}
                    </span>
                  </td>
                  <td>
                    <span className={`review-enforceability ${enforceabilityClass}`}>
                      {formatEnforceabilityClass(rule.enforceability_class)}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`review-qa-count${qaCount > 0 ? " flagged" : " clear"}`}
                      aria-label={`${qaCount} QA flag${qaCount === 1 ? "" : "s"}`}
                    >
                      {qaCount} QA
                    </span>
                  </td>
                  <td className="review-rule-action-cell">
                    <button
                      type="button"
                      className="review-open-button"
                      aria-label={`Open dossier for ${statement}`}
                      onClick={() => onOpenReview(review.candidate_rule_id)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
