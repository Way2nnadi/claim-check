import type { CandidateRuleReview } from "./types";
import { formatEnforceabilityClass, formatLifecycleState } from "../rules/format";
import { useRef } from "react";
import type { KeyboardEvent } from "react";
import {
	PRIMARY_REVIEW_TABS,
	formatReingestionDiffCategory,
	truncateStatement,
	type LifecycleTabId,
} from "./format";
import { catalogApproveDisabled, catalogRejectDisabled, canEditCandidateRules } from "./decisions";
import type { AuthenticatedPrincipal } from "../shared/auth/types";
import StatusPill, {
	enforceabilityToPillVariant,
	lifecycleToPillVariant,
	type StatusPillVariant,
} from "../shared/ui/StatusPill";
import FilterTabs from "../shared/ui/FilterTabs";

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

function reingestionDiffToPillVariant(
	category: CandidateRuleReview["reingestion_diff_category"],
): StatusPillVariant {
	if (category === "changed") {
		return "warning";
	}
	if (category === "added") {
		return "success";
	}
	if (category === "removed") {
		return "danger";
	}
	return "neutral";
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
	const reviewRowRefs = useRef<Array<HTMLButtonElement | null>>([]);
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
		event: KeyboardEvent<HTMLButtonElement>,
		index: number,
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
				<p className="review-ledger-scope">{scopeLabel}</p>

				<FilterTabs
					tabs={PRIMARY_REVIEW_TABS.map((tab) => ({
						id: tab.id,
						label: tab.label,
						count: tabCounts[tab.id],
					}))}
					activeTabId={lifecycleTab}
					onTabChange={(tabId) => onLifecycleTabChange(tabId as LifecycleTabId)}
					ariaLabel="Filter by lifecycle state"
					idPrefix="review-lifecycle-tab"
					panelId="review-rule-panel"
				/>
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
						<div className="review-rule-selection-copy">
							<label className="review-rule-checkbox">
								<input
									type="checkbox"
									aria-label="Select all low-risk visible Candidate Rules"
									checked={allSelectableSelected}
									disabled={selectableCount === 0}
									onChange={onToggleAllCandidateRuleSelections}
								/>
								<span className="review-rule-selection-label">
									{selectedCount > 0
										? `${selectedCount} selected`
										: "Select low-risk visible rules"}
								</span>
							</label>
							<span className="review-rule-selection-hint">
								{canBulkApprove
									? selectableCount > 0
										? `${selectableCount} low-risk rule${selectableCount === 1 ? "" : "s"} ready for batch approval`
										: "No low-risk rules in this view"
									: "Viewers can inspect the queue but cannot approve rules"}
							</span>
						</div>
						{selectedCount > 0 ? (
							<div className="review-rule-selection-actions">
								<button
									type="button"
									className="document-command"
									disabled={isBulkApproving}
									onClick={onClearCandidateRuleSelections}
								>
									Clear
								</button>
								<button
									type="button"
									className="document-command document-command-accent"
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
								<div
									className={`review-row reveal${isSelected ? " selected" : ""}`}
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
										<span className="sr-only">
											Select Candidate Rule {review.candidate_rule_id}
										</span>
									</label>
									<button
										type="button"
										ref={(node) => {
											reviewRowRefs.current[index] = node;
										}}
										className="review-row-open"
										aria-label={`Open Candidate Rule ${review.candidate_rule_id}`}
										onClick={() => onOpenReview(review.candidate_rule_id)}
										onKeyDown={(event) =>
											handleReviewRowKeyDown(event, index)
										}
									>
										<p className="review-statement">{statement}</p>
										<div className="review-row-meta">
											{review.reingestion_diff_category ? (
												<StatusPill
													label={formatReingestionDiffCategory(
														review.reingestion_diff_category,
													)}
													variant={reingestionDiffToPillVariant(
														review.reingestion_diff_category,
													)}
												/>
											) : null}
											<StatusPill
												label={formatLifecycleState(review.lifecycle_state)}
												variant={lifecycleToPillVariant(review.lifecycle_state)}
											/>
											<StatusPill
												label={formatEnforceabilityClass(rule.enforceability_class)}
												variant={enforceabilityToPillVariant(
													rule.enforceability_class,
												)}
											/>
											{rule.scope.expense_category ? (
												<StatusPill
													label={rule.scope.expense_category}
													variant="neutral"
												/>
											) : null}
											<StatusPill
												label={
													qaCount > 0
														? `${qaCount} QA flag${qaCount === 1 ? "" : "s"}`
														: "QA clear"
												}
												variant={qaCount > 0 ? "warning" : "neutral"}
											/>
										</div>
									</button>
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
								</div>
							</li>
						);
					})}
				</ol>
			)}
		</div>
	);
}
