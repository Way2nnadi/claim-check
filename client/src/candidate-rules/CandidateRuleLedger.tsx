import type { CandidateRuleReview } from "./types";
import { formatEnforceabilityClass, formatLifecycleState } from "../rules/format";
import { useRef } from "react";
import type { KeyboardEvent } from "react";
import { PRIMARY_REVIEW_TABS, enforceabilityClassName, formatReingestionDiffCategory, lifecycleStateClassName, reingestionDiffCategoryClassName, truncateStatement, type LifecycleTabId } from "./format";
import { catalogApproveDisabled, catalogRejectDisabled, canEditCandidateRules } from "./decisions";
import type { AuthenticatedPrincipal } from "../shared/auth/types";

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
	selectedCandidateRuleIds: ReadonlySet<string>;
	selectableCandidateRuleIds: ReadonlySet<string>;
	canBulkApprove: boolean;
	bulkApproveDisabled: boolean;
	isBulkApproving: boolean;
	onToggleCandidateRuleSelection: (candidateRuleId: string) => void;
	onToggleAllCandidateRuleSelections: () => void;
	onClearCandidateRuleSelections: () => void;
	onBulkApprove: () => void;
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
	selectedCandidateRuleIds,
	selectableCandidateRuleIds,
	canBulkApprove,
	bulkApproveDisabled,
	isBulkApproving,
	onToggleCandidateRuleSelection,
	onToggleAllCandidateRuleSelections,
	onClearCandidateRuleSelections,
	onBulkApprove,
}: CandidateRuleLedgerProps) {
	const reviewRowRefs = useRef<Array<HTMLElement | null>>([]);
	const canEdit = canEditCandidateRules(principal);
	const selectableCount = selectableCandidateRuleIds.size;
	const selectedCount = [...selectedCandidateRuleIds].filter((candidateRuleId) =>
		selectableCandidateRuleIds.has(candidateRuleId),
	).length;
	const allSelectableSelected =
		selectableCount > 0 && selectedCount === selectableCount;

	function focusReviewRow(index: number): void {
		reviewRowRefs.current[index]?.focus();
	}

	function handleReviewRowKeyDown(
		event: KeyboardEvent<HTMLElement>,
		index: number,
		candidateRuleId: string,
	): void {
		if (event.target !== event.currentTarget) {
			return;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			focusReviewRow(Math.min(index + 1, reviews.length - 1));
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
			focusReviewRow(reviews.length - 1);
			return;
		}

		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			onOpenReview(candidateRuleId);
		}
	}

	if (allReviews.length === 0) {
		return (
			<div className="extraction-empty reveal">
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
					className="notion-filter-tabs"
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
								className={`notion-filter-tab${isSelected ? " is-active" : ""}`}
								data-tab-id={tab.id}
								aria-selected={isSelected}
								aria-controls="review-rule-panel"
								onClick={() => onLifecycleTabChange(tab.id)}
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
					<li
						className={`review-rule-selection-summary${selectedCount > 0 ? " active" : ""}`}
					>
						<label className="review-rule-checkbox">
							<input
								type="checkbox"
								aria-label="Select all low-risk visible Candidate Rules"
								checked={allSelectableSelected}
								disabled={selectableCount === 0}
								onChange={onToggleAllCandidateRuleSelections}
							/>
						</label>
						<div className="review-rule-selection-copy">
							<span className="review-rule-selection-label">
								{selectedCount > 0
									? `${selectedCount} selected`
									: "Select low-risk visible rules"}
							</span>
							<span className="review-rule-selection-hint">
								{canBulkApprove
									? selectableCount > 0
										? `${selectableCount} low-risk rule${selectableCount === 1 ? "" : "s"} ready for batch approval`
										: "No low-risk Candidate Rules are available in this view"
									: "Viewers can inspect the queue but cannot approve rules"}
							</span>
						</div>
						{selectedCount > 0 ? (
							<div className="review-rule-selection-actions">
								<button
									type="button"
									className="review-secondary-button compact"
									disabled={isBulkApproving}
									onClick={onClearCandidateRuleSelections}
								>
									Clear
								</button>
								<button
									type="button"
									className="review-save-button compact"
									disabled={bulkApproveDisabled}
									onClick={onBulkApprove}
								>
									{isBulkApproving ? "Approving…" : "Approve selected"}
								</button>
							</div>
						) : null}
					</li>
					{reviews.map((review, index) => {
						const rule = review.current_rule;
						const qaCount = review.qa_flags.length;
						const lifecycleClass = lifecycleStateClassName(review.lifecycle_state);
						const enforceabilityClass = enforceabilityClassName(
							rule.enforceability_class,
						);
						const statement = truncateStatement(rule.statement, 160);
						const approveDisabled = catalogApproveDisabled(review, canEdit);
						const rejectDisabled = catalogRejectDisabled(review, canEdit);
						const isSelectable = selectableCandidateRuleIds.has(
							review.candidate_rule_id,
						);
						const isSelected = selectedCandidateRuleIds.has(
							review.candidate_rule_id,
						);

						return (
							<li key={review.candidate_rule_id}>
								<article
									ref={(node) => {
										reviewRowRefs.current[index] = node;
									}}
									className={`review-row reveal lifecycle-${lifecycleClass}${isSelected ? " selected" : ""}`}
									tabIndex={0}
									aria-label={`Open Candidate Rule ${review.candidate_rule_id}`}
									onKeyDown={(event) =>
										handleReviewRowKeyDown(
											event,
											index,
											review.candidate_rule_id,
										)
									}
								>
									<label className="review-rule-checkbox">
										<input
											type="checkbox"
											aria-label={`Select Candidate Rule ${review.candidate_rule_id}`}
											checked={isSelected}
											disabled={!isSelectable}
											onChange={() =>
												onToggleCandidateRuleSelection(review.candidate_rule_id)
											}
										/>
									</label>
									<div className="review-row-body">
										<p className="review-statement">{statement}</p>
										<div className="review-row-head">
											<div className="review-row-idline">
												{review.reingestion_diff_category ? (
													<span
														className={`review-diff-badge ${reingestionDiffCategoryClassName(
															review.reingestion_diff_category,
														)}`}
													>
														{formatReingestionDiffCategory(
															review.reingestion_diff_category,
														)}
													</span>
												) : null}
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
													{qaCount > 0
														? `${qaCount} QA flag${qaCount === 1 ? "" : "s"}`
														: "QA clear"}
												</span>
											</div>
										</div>
									</div>
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
								</article>
							</li>
						);
					})}
				</ol>
			)}
		</div>
	);
}
