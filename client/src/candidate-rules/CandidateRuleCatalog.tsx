import { approveCandidateRulesBulk, fetchCandidateRules } from "./api";
import type { CandidateRuleFilters, CandidateRuleReview } from "./types";
import { fetchExtractionRuns } from "../extraction-runs/api";
import type {
	ExtractionRun,
	ExtractionRunFilters,
} from "../extraction-runs/types";
import { fetchPolicyDocuments } from "../policy-documents/api";
import type { PolicyDocumentSummary } from "../policy-documents/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	bulkApproveDisabled,
	bulkSelectableCandidateRuleIds,
	pruneSelectedCandidateRuleIds,
	resolveCandidateRuleDecision,
	resolveDecisionErrorMessage,
	selectedBulkCandidateRuleIds,
	toggleAllCandidateRuleSelections,
	toggleCandidateRuleSelection,
	validateDecisionComment,
} from "./decisions";
import {
	PRIMARY_REVIEW_TABS,
	REVIEW_QUEUE_LIFECYCLE_STATES,
	describeCandidateRuleError,
	filterReviewsForTab,
	resolveReviewEmptyHint,
	resolveReviewEmptyMessage,
	type LifecycleTabId,
	type ReviewEmptyContext,
} from "./format";
import { hasAnyRole } from "../shared/permissions";
import { useReviewQueueScopeFilters } from "./reviewQueueFilters";
import { useAsyncResource } from "../shared/ui/useAsyncResource";
import type { AuthenticatedPrincipal } from "../shared/auth/types";
import type { BulkCandidateRuleApprovalFailure } from "./types";

import CandidateRuleDecisionModal from "./CandidateRuleDecisionModal";
import CandidateRuleDetail from "./CandidateRuleDetail";
import CandidateRuleLedger from "./CandidateRuleLedger";

import DocumentFilterPicker from "../policy-documents/DocumentFilterPicker";

interface CandidateRuleCatalogProps {
	principal: AuthenticatedPrincipal;
	extractionRunId?: string | null;
	onClearExtractionRunScope?: () => void;
}

type CatalogStatus = "loading" | "ready" | "error";
type DecisionMode = "approve" | "reject";

type BulkFeedbackTone = "success" | "warning";

interface BulkFeedbackState {
	tone: BulkFeedbackTone;
	message: string;
	failures: BulkCandidateRuleApprovalFailure[];
}

function resolveQueueScopeLabel(
	lifecycleTab: LifecycleTabId,
	displayedCount: number,
): string {
	if (lifecycleTab === "queue") {
		return `${displayedCount} awaiting review`;
	}
	if (lifecycleTab === "flagged") {
		return `${displayedCount} flagged`;
	}
	if (lifecycleTab === "archive") {
		return `${displayedCount} in archive`;
	}
	if (lifecycleTab === "all") {
		return `${displayedCount} total`;
	}
	return `${displayedCount} rule${displayedCount === 1 ? "" : "s"}`;
}

export default function CandidateRuleCatalog({
	principal,
	extractionRunId = null,
	onClearExtractionRunScope,
}: CandidateRuleCatalogProps) {
	const [selectedCandidateRuleId, setSelectedCandidateRuleId] = useState<
		string | null
	>(null);
	const [activeRun, setActiveRun] = useState<ExtractionRun | null>(null);
	const [documents, setDocuments] = useState<PolicyDocumentSummary[]>([]);
	const [selectedCandidateRuleIds, setSelectedCandidateRuleIds] = useState<
		Set<string>
	>(() => new Set());
	const [lifecycleTab, setLifecycleTab] = useState<LifecycleTabId>("queue");
	const [bulkApprovalOpen, setBulkApprovalOpen] = useState(false);
	const [bulkApprovalRationale, setBulkApprovalRationale] = useState("");
	const [bulkApprovalError, setBulkApprovalError] = useState<string | null>(
		null,
	);
	const [bulkFeedback, setBulkFeedback] = useState<BulkFeedbackState | null>(
		null,
	);
	const [isBulkApproving, setIsBulkApproving] = useState(false);
	const [decisionReview, setDecisionReview] =
		useState<CandidateRuleReview | null>(null);
	const [decisionMode, setDecisionMode] = useState<DecisionMode | null>(null);
	const [decisionComment, setDecisionComment] = useState("");
	const [decisionError, setDecisionError] = useState<string | null>(null);
	const [isResolving, setIsResolving] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);

	const clearCandidateRuleSelections = useCallback((): void => {
		setSelectedCandidateRuleIds(new Set());
	}, []);

	const {
		scopeDraft,
		setScopeDraft,
		appliedScopeFilters,
		activeRuleFilters,
		scopeFilterCount,
		activeFilterCount,
		hasActiveFilters,
		applyScope,
		clearScope,
	} = useReviewQueueScopeFilters({
		extractionRunId,
		onScopeChange: clearCandidateRuleSelections,
		onClearExtractionRunScope,
	});

	const loadDocuments = useCallback(async (): Promise<void> => {
		try {
			const documentsResponse = await fetchPolicyDocuments();
			setDocuments(documentsResponse.items);
		} catch {
			// Scope picker degrades gracefully when documents cannot be loaded.
		}
	}, []);

	const fetchRules = useCallback(async (): Promise<CandidateRuleReview[]> => {
		const reviewsResponse = await fetchCandidateRules(activeRuleFilters);
		return reviewsResponse.items;
	}, [activeRuleFilters]);

	const {
		status: rulesStatus,
		data: reviewsData,
		error: errorMessage,
		reload: reloadRules,
		setData: setReviews,
	} = useAsyncResource(fetchRules, "Unable to load Candidate Rules.", {
		loadOnMount: false,
	});
	const reviews = reviewsData ?? [];

	const loadActiveRun = useCallback(
		async (
			runId: string,
			scopeFilters: CandidateRuleFilters,
		): Promise<void> => {
			try {
				const runFilters: ExtractionRunFilters = {};
				if (scopeFilters.documentId) {
					runFilters.documentId = scopeFilters.documentId;
				}
				if (scopeFilters.documentVersionId) {
					runFilters.documentVersionId = scopeFilters.documentVersionId;
				}

				const runsResponse = await fetchExtractionRuns(runFilters);
				setActiveRun(
					runsResponse.items.find((run) => run.extraction_run_id === runId) ??
						null,
				);
			} catch {
				setActiveRun(null);
			}
		},
		[],
	);

	useEffect(() => {
		void loadDocuments();
	}, [loadDocuments]);

	useEffect(() => {
		void reloadRules();
	}, [reloadRules]);

	useEffect(() => {
		if (extractionRunId) {
			void loadActiveRun(extractionRunId, appliedScopeFilters);
		} else {
			setActiveRun(null);
		}
		setSelectedCandidateRuleId(null);
	}, [appliedScopeFilters, extractionRunId, loadActiveRun]);

	const displayedReviews = useMemo(
		() =>
			filterReviewsForTab(reviews, lifecycleTab, REVIEW_QUEUE_LIFECYCLE_STATES),
		[lifecycleTab, reviews],
	);

	useEffect(() => {
		if (
			selectedCandidateRuleId !== null &&
			!displayedReviews.some(
				(review) => review.candidate_rule_id === selectedCandidateRuleId,
			)
		) {
			setSelectedCandidateRuleId(null);
		}
	}, [displayedReviews, selectedCandidateRuleId]);

	const tabCounts = useMemo(() => {
		if (rulesStatus !== "ready") {
			return {} as Partial<Record<LifecycleTabId, number>>;
		}

		const counts: Partial<Record<LifecycleTabId, number>> = {};
		for (const tab of PRIMARY_REVIEW_TABS) {
			counts[tab.id] = filterReviewsForTab(
				reviews,
				tab.id,
				REVIEW_QUEUE_LIFECYCLE_STATES,
			).length;
		}
		return counts;
	}, [reviews, rulesStatus]);

	function openDecisionModal(
		review: CandidateRuleReview,
		mode: DecisionMode,
	): void {
		setDecisionReview(review);
		setDecisionMode(mode);
		setDecisionComment("");
		setDecisionError(null);
	}

	function closeDecisionModal(): void {
		setDecisionReview(null);
		setDecisionMode(null);
		setDecisionComment("");
		setDecisionError(null);
	}

	async function handleResolveReview(): Promise<void> {
		if (decisionReview === null || decisionMode === null || isResolving) {
			return;
		}

		const validationError = validateDecisionComment(
			decisionMode,
			decisionComment,
		);
		if (validationError) {
			setDecisionError(validationError);
			return;
		}

		setIsResolving(true);
		setDecisionError(null);

		try {
			const updatedReview = await resolveCandidateRuleDecision(
				decisionReview.candidate_rule_id,
				decisionMode,
				decisionComment,
			);
			setReviews((current) =>
				(current ?? []).map((review) =>
					review.candidate_rule_id === updatedReview.candidate_rule_id
						? updatedReview
						: review,
				),
			);
			closeDecisionModal();
		} catch (error: unknown) {
			setDecisionError(
				describeCandidateRuleError(
					error,
					resolveDecisionErrorMessage(decisionMode),
				),
			);
		} finally {
			setIsResolving(false);
		}
	}

	const emptyContext = useMemo<ReviewEmptyContext>(
		() => ({
			lifecycleTab,
			reviews,
			displayedReviews,
			scopeFilterCount,
			extractionRunId: extractionRunId ?? null,
			hasNonDefaultLifecycleFilters: false,
		}),
		[
			displayedReviews,
			extractionRunId,
			lifecycleTab,
			reviews,
			scopeFilterCount,
		],
	);

	const canBulkApprove = hasAnyRole(principal, ["admin", "approver"]);
	const selectableCandidateRuleIds = useMemo(
		() => bulkSelectableCandidateRuleIds(displayedReviews, canBulkApprove),
		[canBulkApprove, displayedReviews],
	);

	useEffect(() => {
		setSelectedCandidateRuleIds((current) => {
			const next = pruneSelectedCandidateRuleIds(
				current,
				selectableCandidateRuleIds,
			);
			if (next.size === current.size) {
				return current;
			}
			return next;
		});
	}, [selectableCandidateRuleIds]);

	const selectedBulkCandidateRuleIdsList = useMemo(
		() =>
			selectedBulkCandidateRuleIds(
				selectedCandidateRuleIds,
				selectableCandidateRuleIds,
			),
		[selectedCandidateRuleIds, selectableCandidateRuleIds],
	);
	const selectedBulkCount = selectedBulkCandidateRuleIdsList.length;

	const bulkApproveDisabledValue = bulkApproveDisabled(
		canBulkApprove,
		selectedBulkCount,
		isBulkApproving,
	);

	function clearBulkFeedback(): void {
		setBulkFeedback(null);
	}

	function handleToggleCandidateRuleSelection(candidateRuleId: string): void {
		clearBulkFeedback();
		setSelectedCandidateRuleIds((current) =>
			toggleCandidateRuleSelection(
				current,
				candidateRuleId,
				selectableCandidateRuleIds,
			),
		);
	}

	function handleToggleAllCandidateRuleSelections(): void {
		clearBulkFeedback();
		setSelectedCandidateRuleIds((current) =>
			toggleAllCandidateRuleSelections(current, selectableCandidateRuleIds),
		);
	}

	function handleClearCandidateRuleSelections(): void {
		clearBulkFeedback();
		clearCandidateRuleSelections();
	}

	function openBulkApproval(): void {
		clearBulkFeedback();
		setBulkApprovalOpen(true);
		setBulkApprovalRationale("");
		setBulkApprovalError(null);
	}

	function closeBulkApproval(): void {
		setBulkApprovalOpen(false);
		setBulkApprovalRationale("");
		setBulkApprovalError(null);
	}

	async function handleBulkApprovalSubmit(): Promise<void> {
		if (bulkApproveDisabledValue) {
			return;
		}

		const trimmedRationale = bulkApprovalRationale.trim();
		if (!trimmedRationale) {
			setBulkApprovalError(
				"Enter approval rationale before approving these Candidate Rules.",
			);
			return;
		}

		setIsBulkApproving(true);
		setBulkApprovalError(null);
		setActionError(null);

		try {
			const response = await approveCandidateRulesBulk({
				candidate_rule_ids: selectedBulkCandidateRuleIdsList,
				rationale: trimmedRationale,
			});
			await reloadRules();

			const approvedCount = response.approved_candidate_rule_ids.length;
			const failureCount = response.failed_candidate_rules.length;
			setSelectedCandidateRuleIds(
				new Set(
					response.failed_candidate_rules.map(
						(failure) => failure.candidate_rule_id,
					),
				),
			);
			setBulkFeedback({
				tone: failureCount > 0 ? "warning" : "success",
				message:
					failureCount === 0
						? `${approvedCount} Candidate Rule${approvedCount === 1 ? "" : "s"} approved. The queue has been refreshed.`
						: approvedCount === 0
							? `No Candidate Rules were approved. ${failureCount} could not be approved.`
							: `${approvedCount} Candidate Rule${approvedCount === 1 ? "" : "s"} approved. ${failureCount} could not be approved.`,
				failures: response.failed_candidate_rules,
			});
			closeBulkApproval();
		} catch (error: unknown) {
			setActionError(
				describeCandidateRuleError(
					error,
					"Unable to bulk approve Candidate Rules.",
				),
			);
		} finally {
			setIsBulkApproving(false);
		}
	}

	const handleDetailReviewChange = useCallback(
		(updatedReview: CandidateRuleReview) => {
			setReviews((current) =>
				(current ?? []).map((review) =>
					review.candidate_rule_id === updatedReview.candidate_rule_id
						? updatedReview
						: review,
				),
			);
		},
		[setReviews],
	);

	const handleDetailReviewResolved = useCallback(
		(candidateRuleId: string, _outcome: "approved" | "rejected") => {
			const currentIndex = displayedReviews.findIndex(
				(review) => review.candidate_rule_id === candidateRuleId,
			);
			const nextCandidateRuleId =
				currentIndex >= 0
					? (displayedReviews[currentIndex + 1]?.candidate_rule_id ?? null)
					: null;
			setSelectedCandidateRuleId(nextCandidateRuleId);
		},
		[displayedReviews],
	);

	if (selectedCandidateRuleId) {
		return (
			<CandidateRuleDetail
				candidateRuleId={selectedCandidateRuleId}
				principal={principal}
				backLabel="Queue"
				onBack={() => setSelectedCandidateRuleId(null)}
				onReviewChange={handleDetailReviewChange}
				onReviewResolved={handleDetailReviewResolved}
			/>
		);
	}

	return (
		<div className="catalog-page review-catalog-page content-enter">
			<details className="review-scope-panel notion-scope-panel">
				<summary>
					Scope filters
					{activeFilterCount > 0 ? (
						<span className="review-scope-panel-badge">
							{activeFilterCount} active
						</span>
					) : null}
				</summary>
				{activeFilterCount > 0 ? (
					<div className="scope-applied-filters">
						{appliedScopeFilters.documentId ? (
							<p className="scope-applied-filter">
								<span className="scope-applied-filter-label">Document</span>
								<code>{appliedScopeFilters.documentId}</code>
							</p>
						) : null}
						{appliedScopeFilters.documentVersionId ? (
							<p className="scope-applied-filter">
								<span className="scope-applied-filter-label">Version</span>
								<code>{appliedScopeFilters.documentVersionId}</code>
							</p>
						) : null}
						{extractionRunId ? (
							<p className="scope-applied-filter">
								<span className="scope-applied-filter-label">Extraction run</span>
								<span className="scope-applied-filter-copy">
									{activeRun?.document_id ? (
										<>
											<code>{activeRun.document_id}</code>
											<span aria-hidden="true"> · </span>
										</>
									) : null}
									<code>{extractionRunId}</code>
								</span>
							</p>
						) : null}
					</div>
				) : null}
				<form className="review-scope-form" onSubmit={applyScope}>
					<div className="review-filter-grid">
						<DocumentFilterPicker
							value={scopeDraft.documentId}
							documents={documents}
							onChange={(value) =>
								setScopeDraft((current) => ({ ...current, documentId: value }))
							}
						/>
						<label htmlFor="review-filter-version">
							Document version
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
					</div>
					<div className="review-filter-actions">
						<button
							type="submit"
							className="document-command document-command-accent"
						>
							Apply scope
						</button>
						<button
							type="button"
							className="document-command"
							disabled={!hasActiveFilters}
							onClick={clearScope}
						>
							Clear filters
						</button>
					</div>
				</form>
			</details>

			{rulesStatus === "loading" ? (
				<p className="catalog-status">
					<span className="catalog-status-rule" aria-hidden="true" />
					Loading Candidate Rules…
				</p>
			) : null}

			{rulesStatus === "error" ? (
				<p className="error-banner">{errorMessage ?? actionError}</p>
			) : null}

			{rulesStatus === "ready" ? (
				<>
					{bulkFeedback ? (
						<section
							className={`notion-callout review-bulk-feedback ${bulkFeedback.tone}`}
						>
							<p>{bulkFeedback.message}</p>
							{bulkFeedback.failures.length > 0 ? (
								<ul className="review-bulk-failure-list">
									{bulkFeedback.failures.map((failure) => (
										<li key={failure.candidate_rule_id}>
											{failure.candidate_rule_id}: {failure.detail}
										</li>
									))}
								</ul>
							) : null}
						</section>
					) : null}

					<CandidateRuleLedger
						allReviews={reviews}
						reviews={displayedReviews}
						lifecycleTab={lifecycleTab}
						tabCounts={tabCounts}
						scopeLabel={resolveQueueScopeLabel(
							lifecycleTab,
							displayedReviews.length,
						)}
						principal={principal}
						onLifecycleTabChange={setLifecycleTab}
						onOpenReview={(candidateRuleId) =>
							setSelectedCandidateRuleId(candidateRuleId)
						}
						onApproveReview={(review) => openDecisionModal(review, "approve")}
						onRejectReview={(review) => openDecisionModal(review, "reject")}
						emptyMessage={resolveReviewEmptyMessage(emptyContext)}
						emptyHint={resolveReviewEmptyHint(emptyContext)}
						selectedCandidateRuleIds={selectedCandidateRuleIds}
						selectableCandidateRuleIds={selectableCandidateRuleIds}
						canBulkApprove={canBulkApprove}
						bulkApproveDisabled={bulkApproveDisabledValue}
						isBulkApproving={isBulkApproving}
						onToggleCandidateRuleSelection={handleToggleCandidateRuleSelection}
						onToggleAllCandidateRuleSelections={
							handleToggleAllCandidateRuleSelections
						}
						onClearCandidateRuleSelections={handleClearCandidateRuleSelections}
						onBulkApprove={openBulkApproval}
					/>

					{decisionMode && decisionReview ? (
						<CandidateRuleDecisionModal
							mode={decisionMode}
							isResolving={isResolving}
							comment={decisionComment}
							error={decisionError}
							onCommentChange={(value) => {
								setDecisionComment(value);
								if (decisionError !== null) {
									setDecisionError(null);
								}
							}}
							onConfirm={() => void handleResolveReview()}
							onCancel={closeDecisionModal}
						/>
					) : null}
				</>
			) : null}

			{bulkApprovalOpen ? (
				<div className="review-decision-backdrop" role="presentation">
					<dialog
						open
						className="review-decision-dialog"
						aria-label="Bulk approve Candidate Rules"
					>
						<div className="review-decision-head">
							<h4>
								Approve {selectedBulkCount} selected Candidate Rule
								{selectedBulkCount === 1 ? "" : "s"}
							</h4>
							<p>
								Use one rationale for this low-risk batch. Changed or flagged
								Candidate Rules should still be reviewed one at a time.
							</p>
						</div>
						<label
							className="review-decision-field"
							htmlFor="candidate-rule-bulk-approval-rationale"
						>
							Bulk approval rationale
							<textarea
								id="candidate-rule-bulk-approval-rationale"
								rows={5}
								value={bulkApprovalRationale}
								placeholder="Why these Candidate Rules are safe to approve together."
								onChange={(event) =>
									setBulkApprovalRationale(event.target.value)
								}
							/>
						</label>
						{bulkApprovalError ? (
							<p className="error-banner compact">{bulkApprovalError}</p>
						) : null}
						<div className="review-decision-actions">
							<button
								type="button"
								className="document-command"
								disabled={isBulkApproving}
								onClick={closeBulkApproval}
							>
								Cancel
							</button>
							<button
								type="button"
								className="document-command document-command-accent"
								disabled={isBulkApproving}
								onClick={() => {
									void handleBulkApprovalSubmit();
								}}
							>
								{isBulkApproving ? "Approving…" : "Confirm bulk approval"}
							</button>
						</div>
					</dialog>
				</div>
			) : null}
		</div>
	);
}
