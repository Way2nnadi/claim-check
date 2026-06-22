import {
	PRIMARY_REVIEW_TABS,
	enforceabilityClassName,
	formatEnforceabilityClass,
	formatLifecycleState,
	lifecycleStateClassName,
	truncateStatement,
	type LifecycleTabId,
} from "./candidateRuleFormat";
import {
	catalogApproveDisabled,
	catalogRejectDisabled,
	canEditCandidateRules,
} from "./candidateRuleDecisions";
import type { AuthenticatedPrincipal, CandidateRuleReview } from "./types";

interface CandidateRuleLedgerProps {
	allReviews: CandidateRuleReview[];
	reviews: CandidateRuleReview[];
	lifecycleTab: LifecycleTabId;
	tabCounts: Partial<Record<LifecycleTabId, number>>;
	scopeLabel: string;
	principal: AuthenticatedPrincipal;
	onLifecycleTabChange: (tab: LifecycleTabId) => void;
	onOpenReview: (candidateRuleId: string) => void;
	onApproveReview: (review: CandidateRuleReview) => void;
	onRejectReview: (review: CandidateRuleReview) => void;
	emptyMessage?: string;
	emptyHint?: string | null;
}

function ApproveIcon() {
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
			<path
				d="M3 8.5 6.5 12 13 4"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function RejectIcon() {
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
			<path
				d="M4 4 12 12M12 4 4 12"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function EditIcon() {
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
			<path
				d="M10.5 3.5 12.5 5.5 5.5 12.5 3 13 3.5 10.5Z"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinejoin="round"
			/>
			<path
				d="M9 5 11 7"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinecap="round"
			/>
		</svg>
	);
}

export default function CandidateRuleLedger({
	allReviews,
	reviews,
	lifecycleTab,
	tabCounts,
	scopeLabel,
	principal,
	onLifecycleTabChange,
	onOpenReview,
	onApproveReview,
	onRejectReview,
	emptyMessage = "No Candidate Rules are waiting in this queue.",
	emptyHint = "Extracted Rules appear here after an Extraction Run completes.",
}: CandidateRuleLedgerProps) {
	const canEdit = canEditCandidateRules(principal);

	if (allReviews.length === 0) {
		return (
			<div className="extraction-empty reveal">
				<span className="folio">Review queue · empty</span>
				<p>{emptyMessage}</p>
				{emptyHint ? <p className="review-empty-hint">{emptyHint}</p> : null}
			</div>
		);
	}

	return (
		<div className="extraction-ledger-wrap review-ledger-wrap">
			<div className="review-ledger-head">
				<p className="catalog-scope">{scopeLabel}</p>

				<div
					className="catalog-tabs"
					role="tablist"
					aria-label="Filter by lifecycle state"
				>
				{PRIMARY_REVIEW_TABS.map((tab) => {
					const isSelected = lifecycleTab === tab.id;
					const count = tabCounts[tab.id];

					return (
						<button
							key={tab.id}
							type="button"
							role="tab"
							id={`review-lifecycle-tab-${tab.id}`}
							className={`catalog-tab${isSelected ? " active" : ""}`}
							data-tab-id={tab.id}
							aria-selected={isSelected}
							aria-controls="review-rule-panel"
							onClick={() => onLifecycleTabChange(tab.id)}
						>
							<span>{tab.label}</span>
							{count !== undefined ? (
								<span className="catalog-tab-count">{count}</span>
							) : null}
						</button>
					);
				})}
				</div>
			</div>

			{reviews.length === 0 ? (
				<div
					id="review-rule-panel"
					className="extraction-empty compact reveal"
					role="tabpanel"
					aria-labelledby={`review-lifecycle-tab-${lifecycleTab}`}
				>
					<p>{emptyMessage}</p>
					{emptyHint ? <p className="review-empty-hint">{emptyHint}</p> : null}
				</div>
			) : (
				<ol
					id="review-rule-panel"
					className="review-ledger"
					role="tabpanel"
					aria-labelledby={`review-lifecycle-tab-${lifecycleTab}`}
					aria-label="Candidate Rule review queue"
				>
					{reviews.map((review) => {
						const rule = review.current_rule;
						const qaCount = review.qa_flags.length;
						const lifecycleClass = lifecycleStateClassName(review.lifecycle_state);
						const enforceabilityClass = enforceabilityClassName(
							rule.enforceability_class,
						);
						const statement = truncateStatement(rule.statement, 160);
						const approveDisabled = catalogApproveDisabled(review, canEdit);
						const rejectDisabled = catalogRejectDisabled(review, canEdit);

						return (
							<li key={review.candidate_rule_id}>
								<article
									className={`review-row reveal lifecycle-${lifecycleClass}`}
								>
									{canEdit ? (
										<div className="review-row-actions">
											<button
												type="button"
												className="review-row-action approve"
												disabled={approveDisabled}
												aria-label="Approve"
												onClick={() => onApproveReview(review)}
											>
												<ApproveIcon />
											</button>
											<button
												type="button"
												className="review-row-action reject"
												disabled={rejectDisabled}
												aria-label="Reject"
												onClick={() => onRejectReview(review)}
											>
												<RejectIcon />
											</button>
											<button
												type="button"
												className="review-row-action edit"
												aria-label="Edit"
												onClick={() => onOpenReview(review.candidate_rule_id)}
											>
												<EditIcon />
											</button>
										</div>
									) : null}
									<p className="review-statement">{statement}</p>
									<div className="review-row-head">
										<div className="review-row-idline">
											<span className={`review-lifecycle ${lifecycleClass}`}>
												{formatLifecycleState(review.lifecycle_state)}
											</span>
											<span
												className={`review-enforceability ${enforceabilityClass}`}
											>
												{formatEnforceabilityClass(rule.enforceability_class)}
											</span>
											{rule.scope.expense_category ? (
												<span className="review-rule-category">
													{rule.scope.expense_category}
												</span>
											) : null}
											<span
												className={`review-qa-count${qaCount > 0 ? " flagged" : " clear"}`}
												aria-label={`${qaCount} QA flag${qaCount === 1 ? "" : "s"}`}
											>
												{qaCount} QA
											</span>
										</div>
									</div>
								</article>
							</li>
						);
					})}
				</ol>
			)}
		</div>
	);
}
