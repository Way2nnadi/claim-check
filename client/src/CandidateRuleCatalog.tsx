import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
	approveCandidateRule,
	approveCandidateRulesBulk,
	fetchCandidateRule,
	fetchCandidateRules,
	fetchExtractionRuns,
	fetchPolicyDocuments,
	rejectCandidateRule,
} from "./api";
import CandidateRuleDecisionModal from "./CandidateRuleDecisionModal";
import CandidateRuleDetail from "./CandidateRuleDetail";
import CandidateRuleLedger from "./CandidateRuleLedger";
import { catalogApproveDisabled } from "./candidateRuleDecisions";
import { describeCandidateRuleError } from "./candidateRuleFormat";
import {
	PRIMARY_REVIEW_TABS,
	REVIEW_QUEUE_LIFECYCLE_STATES,
	filterReviewsForTab,
	resolveReviewEmptyHint,
	resolveReviewEmptyMessage,
	type LifecycleTabId,
} from "./candidateRuleFormat";
import DocumentFilterPicker from "./DocumentFilterPicker";
import { shortenId } from "./extractionRunFormat";
import { hasAnyRole } from "./permissions";
import type {
	AuthenticatedPrincipal,
	BulkCandidateRuleApprovalFailure,
	CandidateRuleFilters,
	CandidateRuleReview,
	ExtractionRun,
	PolicyDocumentSummary,
} from "./types";

interface CandidateRuleCatalogProps {
	principal: AuthenticatedPrincipal;
	extractionRunId?: string | null;
	onClearExtractionRunScope?: () => void;
}

type CatalogStatus = "loading" | "ready" | "error";
type DecisionMode = "approve" | "reject";

type BulkFeedbackTone = "success" | "warning";

interface RuleScopeFilters {
	documentId: string;
	documentVersionId: string;
}

interface BulkFeedbackState {
	tone: BulkFeedbackTone;
	message: string;
	failures: BulkCandidateRuleApprovalFailure[];
}

function buildRuleFilters(
	scope: RuleScopeFilters,
	extractionRunId?: string | null,
): CandidateRuleFilters {
	const filters: CandidateRuleFilters = {};
	const trimmedDocumentId = scope.documentId.trim();
	const trimmedVersionId = scope.documentVersionId.trim();

	if (trimmedDocumentId) {
		filters.documentId = trimmedDocumentId;
	}
	if (trimmedVersionId) {
		filters.documentVersionId = trimmedVersionId;
	}
	if (extractionRunId) {
		filters.extractionRunId = extractionRunId;
	}

	return filters;
}

function countScopeFilters(filters: CandidateRuleFilters): number {
	return (
		Number(Boolean(filters.documentId)) +
		Number(Boolean(filters.documentVersionId))
	);
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

function isLowRiskBulkApprovalCandidate(
	review: CandidateRuleReview,
	canBulkApprove: boolean,
): boolean {
	const diffCategory = review.reingestion_diff_category;

	return (
		canBulkApprove &&
		!catalogApproveDisabled(review, canBulkApprove) &&
		review.qa_flags.length === 0 &&
		diffCategory !== "changed" &&
		diffCategory !== "removed"
	);
}

export default function CandidateRuleCatalog({
	principal,
	extractionRunId = null,
	onClearExtractionRunScope,
}: CandidateRuleCatalogProps) {
	const [selectedCandidateRuleId, setSelectedCandidateRuleId] = useState<
		string | null
	>(null);
	const [rulesStatus, setRulesStatus] = useState<CatalogStatus>("loading");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [documents, setDocuments] = useState<PolicyDocumentSummary[]>([]);
	const [activeRun, setActiveRun] = useState<ExtractionRun | null>(null);
	const [reviews, setReviews] = useState<CandidateRuleReview[]>([]);
	const [selectedCandidateRuleIds, setSelectedCandidateRuleIds] = useState<
		Set<string>
	>(() => new Set());
	const [lifecycleTab, setLifecycleTab] = useState<LifecycleTabId>("queue");
	const [scopeDraft, setScopeDraft] = useState<RuleScopeFilters>({
		documentId: "",
		documentVersionId: "",
	});
	const [appliedScopeFilters, setAppliedScopeFilters] =
		useState<CandidateRuleFilters>({});
	const [bulkApprovalOpen, setBulkApprovalOpen] = useState(false);
	const [bulkApprovalRationale, setBulkApprovalRationale] = useState("");
	const [bulkApprovalError, setBulkApprovalError] = useState<string | null>(null);
	const [bulkFeedback, setBulkFeedback] = useState<BulkFeedbackState | null>(null);
	const [isBulkApproving, setIsBulkApproving] = useState(false);
	const [decisionReview, setDecisionReview] =
		useState<CandidateRuleReview | null>(null);
	const [decisionMode, setDecisionMode] = useState<DecisionMode | null>(null);
	const [decisionComment, setDecisionComment] = useState("");
	const [decisionError, setDecisionError] = useState<string | null>(null);
	const [isResolving, setIsResolving] = useState(false);

	const loadDocuments = useCallback(async (): Promise<void> => {
		try {
			const documentsResponse = await fetchPolicyDocuments();
			setDocuments(documentsResponse.items);
		} catch {
			// Scope picker degrades gracefully when documents cannot be loaded.
		}
	}, []);

	const loadRules = useCallback(
		async (scopeFilters: CandidateRuleFilters): Promise<void> => {
			setRulesStatus("loading");
			setErrorMessage(null);

			try {
				const reviewsResponse = await fetchCandidateRules(scopeFilters);
				setReviews(reviewsResponse.items);
				setRulesStatus("ready");
			} catch (error: unknown) {
				setErrorMessage(
					describeCandidateRuleError(error, "Unable to load Candidate Rules."),
				);
				setRulesStatus("error");
			}
		},
		[],
	);

	const loadActiveRun = useCallback(async (runId: string): Promise<void> => {
		try {
			const runsResponse = await fetchExtractionRuns();
			setActiveRun(
				runsResponse.items.find((run) => run.extraction_run_id === runId) ??
					null,
			);
		} catch {
			setActiveRun(null);
		}
	}, []);

	useEffect(() => {
		void loadDocuments();
	}, [loadDocuments]);

	const activeRuleFilters = useMemo(
		() =>
			buildRuleFilters(
				{
					documentId: appliedScopeFilters.documentId ?? "",
					documentVersionId: appliedScopeFilters.documentVersionId ?? "",
				},
				extractionRunId,
			),
		[appliedScopeFilters, extractionRunId],
	);

	useEffect(() => {
		void loadRules(activeRuleFilters);
	}, [activeRuleFilters, loadRules]);

	useEffect(() => {
		if (extractionRunId) {
			void loadActiveRun(extractionRunId);
		} else {
			setActiveRun(null);
		}
		setSelectedCandidateRuleId(null);
	}, [extractionRunId, loadActiveRun]);

	const displayedReviews = useMemo(
		() => filterReviewsForTab(reviews, lifecycleTab, REVIEW_QUEUE_LIFECYCLE_STATES),
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

	function handleScopeSubmit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		setSelectedCandidateRuleIds(new Set());
		setAppliedScopeFilters(buildRuleFilters(scopeDraft));
	}

	function handleClearScope(): void {
		const clearedScope: RuleScopeFilters = {
			documentId: "",
			documentVersionId: "",
		};
		setScopeDraft(clearedScope);
		setSelectedCandidateRuleIds(new Set());
		setAppliedScopeFilters({});
	}

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

		const trimmedComment = decisionComment.trim();
		if (!trimmedComment) {
			setDecisionError(
				decisionMode === "approve" ? "Rationale is required." : "Reason is required.",
			);
			return;
		}

		setIsResolving(true);
		setDecisionError(null);

		try {
			const candidateRuleId = decisionReview.candidate_rule_id;

			if (decisionMode === "approve") {
				await approveCandidateRule(candidateRuleId, {
					rationale: trimmedComment,
				});
			} else {
				await rejectCandidateRule(candidateRuleId, {
					reason: trimmedComment,
				});
			}

			const updatedReview = await fetchCandidateRule(candidateRuleId);
			setReviews((current) =>
				current.map((review) =>
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
					decisionMode === "approve"
						? "Unable to approve Candidate Rule."
						: "Unable to reject Candidate Rule.",
				),
			);
		} finally {
			setIsResolving(false);
		}
	}

	const scopeFilterCount = countScopeFilters(appliedScopeFilters);

	const scopeActiveInDraft =
		Boolean(scopeDraft.documentId.trim()) ||
		Boolean(scopeDraft.documentVersionId.trim());

	const emptyContext = useMemo(
		() => ({
			lifecycleTab,
			reviews,
			displayedReviews,
			scopeFilterCount,
			extractionRunId,
			hasNonDefaultLifecycleFilters: false,
		}),
		[displayedReviews, extractionRunId, lifecycleTab, reviews, scopeFilterCount],
	);

	const canBulkApprove = hasAnyRole(principal, ["admin", "approver"]);
	const selectableCandidateRuleIds = useMemo(
		() =>
			new Set(
				displayedReviews
					.filter((review) =>
						isLowRiskBulkApprovalCandidate(review, canBulkApprove),
					)
					.map((review) => review.candidate_rule_id),
			),
		[canBulkApprove, displayedReviews],
	);

	useEffect(() => {
		setSelectedCandidateRuleIds((current) => {
			const next = new Set(
				[...current].filter((candidateRuleId) =>
					selectableCandidateRuleIds.has(candidateRuleId),
				),
			);
			if (next.size === current.size) {
				return current;
			}
			return next;
		});
	}, [selectableCandidateRuleIds]);

	const selectedBulkCandidateRuleIds = useMemo(
		() =>
			[...selectedCandidateRuleIds].filter((candidateRuleId) =>
				selectableCandidateRuleIds.has(candidateRuleId),
			),
		[selectedCandidateRuleIds, selectableCandidateRuleIds],
	);
	const selectedBulkCount = selectedBulkCandidateRuleIds.length;

	const bulkApproveDisabled =
		!canBulkApprove || selectedBulkCount === 0 || isBulkApproving;

	function clearBulkFeedback(): void {
		setBulkFeedback(null);
	}

	function toggleCandidateRuleSelection(candidateRuleId: string): void {
		clearBulkFeedback();
		setSelectedCandidateRuleIds((current) => {
			const next = new Set(current);
			if (next.has(candidateRuleId)) {
				next.delete(candidateRuleId);
			} else if (selectableCandidateRuleIds.has(candidateRuleId)) {
				next.add(candidateRuleId);
			}
			return next;
		});
	}

	function toggleAllCandidateRuleSelections(): void {
		clearBulkFeedback();
		setSelectedCandidateRuleIds((current) => {
			const allSelected =
				selectableCandidateRuleIds.size > 0 &&
				[...selectableCandidateRuleIds].every((candidateRuleId) =>
					current.has(candidateRuleId),
				);
			if (allSelected) {
				return new Set();
			}
			return new Set(selectableCandidateRuleIds);
		});
	}

	function clearCandidateRuleSelections(): void {
		clearBulkFeedback();
		setSelectedCandidateRuleIds(new Set());
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
		if (bulkApproveDisabled) {
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
		setErrorMessage(null);

		try {
			const response = await approveCandidateRulesBulk({
				candidate_rule_ids: selectedBulkCandidateRuleIds,
				rationale: trimmedRationale,
			});
			await loadRules(activeRuleFilters);

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
			setErrorMessage(
				describeCandidateRuleError(
					error,
					"Unable to bulk approve Candidate Rules.",
				),
			);
		} finally {
			setIsBulkApproving(false);
		}
	}

	if (selectedCandidateRuleId) {
		return (
			<CandidateRuleDetail
				candidateRuleId={selectedCandidateRuleId}
				principal={principal}
				backLabel="← Queue"
				onBack={() => setSelectedCandidateRuleId(null)}
				onReviewChange={(updatedReview: CandidateRuleReview) => {
					setReviews((current) =>
						current.map((review) =>
							review.candidate_rule_id === updatedReview.candidate_rule_id
								? updatedReview
								: review,
						),
					);
				}}
				onReviewResolved={(candidateRuleId: string) => {
					const currentIndex = displayedReviews.findIndex(
						(review) => review.candidate_rule_id === candidateRuleId,
					);
					const nextCandidateRuleId =
						currentIndex >= 0
							? (displayedReviews[currentIndex + 1]?.candidate_rule_id ?? null)
							: null;
					setSelectedCandidateRuleId(nextCandidateRuleId);
				}}
			/>
		);
	}

	return (
		<div className="catalog-page review-catalog content-enter">
			<details className="review-scope-panel">
				<summary>
					Scope filters
					{scopeFilterCount > 0 ? (
						<span className="review-scope-panel-badge">
							{scopeFilterCount} active
						</span>
					) : null}
				</summary>
				<form className="review-scope-form" onSubmit={handleScopeSubmit}>
					<div className="review-filter-grid">
						<DocumentFilterPicker
							value={scopeDraft.documentId}
							documents={documents}
							onChange={(value) =>
								setScopeDraft((current) => ({ ...current, documentId: value }))
							}
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

			{rulesStatus === "loading" ? (
				<p className="catalog-status">
					<span className="catalog-status-rule" aria-hidden="true" />
					Loading Candidate Rules…
				</p>
			) : null}

			{rulesStatus === "error" ? (
				<p className="error-banner">{errorMessage}</p>
			) : null}

			{rulesStatus === "ready" ? (
				<>
					{scopeFilterCount > 0 ? (
						<p className="catalog-scope">
							{appliedScopeFilters.documentId ?? null}
							{appliedScopeFilters.documentId &&
							appliedScopeFilters.documentVersionId
								? " · "
								: null}
							{appliedScopeFilters.documentVersionId ?? null}
						</p>
					) : null}

					{extractionRunId ? (
						<p className="catalog-scope review-run-scope-chip">
							<span>{activeRun?.document_id ?? "Extraction run"}</span>
							<span aria-hidden="true"> · </span>
							<code title={extractionRunId}>{shortenId(extractionRunId)}</code>
							{onClearExtractionRunScope ? (
								<button
									type="button"
									className="review-scope-chip-action"
									onClick={onClearExtractionRunScope}
								>
									Show all rules
								</button>
							) : null}
						</p>
					) : null}

					{bulkFeedback ? (
						<section
							className={`review-bulk-feedback reveal ${bulkFeedback.tone}`}
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
						bulkApproveDisabled={bulkApproveDisabled}
						isBulkApproving={isBulkApproving}
						onToggleCandidateRuleSelection={toggleCandidateRuleSelection}
						onToggleAllCandidateRuleSelections={
							toggleAllCandidateRuleSelections
						}
						onClearCandidateRuleSelections={clearCandidateRuleSelections}
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
								className="review-secondary-button"
								disabled={isBulkApproving}
								onClick={closeBulkApproval}
							>
								Cancel
							</button>
							<button
								type="button"
								className="review-save-button"
								disabled={isBulkApproving}
								onClick={() => {
									void handleBulkApprovalSubmit();
								}}
							>
								{isBulkApproving
									? "Approving…"
									: "Confirm bulk approval"}
							</button>
						</div>
					</dialog>
				</div>
			) : null}
		</div>
	);
}
