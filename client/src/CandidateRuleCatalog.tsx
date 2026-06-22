import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
	approveCandidateRulesBulk,
	fetchCandidateRules,
	fetchExtractionRuns,
	fetchPolicyDocuments,
} from "./api";
import CandidateRuleDetail from "./CandidateRuleDetail";
import CandidateRuleLedger from "./CandidateRuleLedger";
import {
	ALL_LIFECYCLE_STATES,
	LIFECYCLE_TABS,
	REVIEW_QUEUE_LIFECYCLE_STATES,
	describeCandidateRuleError,
	filterReviewsForTab,
	formatLifecycleState,
	isDefaultCustomSelection,
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
	LifecycleState,
	PolicyDocumentSummary,
} from "./types";

interface CandidateRuleCatalogProps {
	principal: AuthenticatedPrincipal;
	extractionRunId?: string | null;
	onClearExtractionRunScope?: () => void;
}

type CatalogStatus = "loading" | "ready" | "error";

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
	const [customLifecycleSelection, setCustomLifecycleSelection] = useState<
		Set<LifecycleState>
	>(() => new Set(REVIEW_QUEUE_LIFECYCLE_STATES));
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

	const customSelection = useMemo(
		() => [...customLifecycleSelection],
		[customLifecycleSelection],
	);

	const displayedReviews = useMemo(
		() => filterReviewsForTab(reviews, lifecycleTab, customSelection),
		[customSelection, lifecycleTab, reviews],
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
		for (const tab of LIFECYCLE_TABS) {
			counts[tab.id] = filterReviewsForTab(
				reviews,
				tab.id,
				customSelection,
			).length;
		}
		return counts;
	}, [customSelection, reviews, rulesStatus]);

	function applyLifecycleTab(tab: LifecycleTabId): void {
		setSelectedCandidateRuleIds(new Set());
		setLifecycleTab(tab);
	}

	function handleCustomLifecycleToggle(state: LifecycleState): void {
		setCustomLifecycleSelection((current) => {
			const next = new Set(current);
			if (next.has(state)) {
				next.delete(state);
			} else {
				next.add(state);
			}
			return next;
		});
		setSelectedCandidateRuleIds(new Set());
		setLifecycleTab("custom");
	}

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

	const scopeFilterCount = countScopeFilters(appliedScopeFilters);

	const scopeActiveInDraft =
		Boolean(scopeDraft.documentId.trim()) ||
		Boolean(scopeDraft.documentVersionId.trim());

	const hasNonDefaultLifecycleFilters =
		lifecycleTab === "custom" && !isDefaultCustomSelection(customSelection);

	const emptyContext = useMemo(
		() => ({
			lifecycleTab,
			reviews,
			displayedReviews,
			scopeFilterCount,
			extractionRunId,
			hasNonDefaultLifecycleFilters,
		}),
		[
			displayedReviews,
			extractionRunId,
			hasNonDefaultLifecycleFilters,
			lifecycleTab,
			reviews,
			scopeFilterCount,
		],
	);

	const selectableCandidateRuleIds = useMemo(
		() =>
			new Set(
				displayedReviews
					.filter((review) =>
						REVIEW_QUEUE_LIFECYCLE_STATES.includes(review.lifecycle_state),
					)
					.map((review) => review.candidate_rule_id),
			),
		[displayedReviews],
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

	const selectedBulkCount = useMemo(
		() =>
			[...selectedCandidateRuleIds].filter((candidateRuleId) =>
				selectableCandidateRuleIds.has(candidateRuleId),
			).length,
		[selectedCandidateRuleIds, selectableCandidateRuleIds],
	);

	const canBulkApprove = hasAnyRole(principal, ["admin", "approver"]);
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
				candidate_rule_ids: [...selectedCandidateRuleIds],
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

	return (
		<div className="catalog-page review-catalog content-enter">
			<details className="review-scope-panel reveal">
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

			{scopeFilterCount > 0 || extractionRunId ? (
				<div className="review-active-scope reveal">
					{scopeFilterCount > 0 ? (
						<p className="review-scope-chips">
							{appliedScopeFilters.documentId ?? null}
							{appliedScopeFilters.documentId &&
							appliedScopeFilters.documentVersionId
								? " · "
								: null}
							{appliedScopeFilters.documentVersionId ?? null}
						</p>
					) : null}
					{extractionRunId ? (
						<p className="review-scope-chips review-run-scope-chip">
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
				</div>
			) : null}

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
								className={`catalog-tab${isSelected ? " active" : ""}`}
								data-tab-id={tab.id}
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
			</div>

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
				<div
					id="review-rule-panel"
					role="tabpanel"
					aria-labelledby={`review-lifecycle-tab-${lifecycleTab}`}
				>
					<section className="review-bulk-rail reveal">
						<div className="review-bulk-copy">
							<span className="review-save-kicker">Bulk approval</span>
							<p className="review-save-note">
								{canBulkApprove
									? selectedBulkCount > 0
										? `${selectedBulkCount} Candidate Rule${selectedBulkCount === 1 ? "" : "s"} selected for approval.`
										: "Select unchanged or low-risk Candidate Rules to approve them together with one rationale."
									: "Viewer role can inspect queue deltas but cannot bulk approve Candidate Rules."}
							</p>
						</div>
						<div className="review-bulk-actions">
							<button
								type="button"
								className="review-save-button"
								disabled={bulkApproveDisabled}
								onClick={openBulkApproval}
							>
								Approve selected Candidate Rules
							</button>
						</div>
					</section>

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

					<div className="review-workbench">
						<div className="review-workbench-ledger">
							<CandidateRuleLedger
								reviews={displayedReviews}
								onOpenReview={(candidateRuleId) =>
									setSelectedCandidateRuleId(candidateRuleId)
								}
								emptyMessage={resolveReviewEmptyMessage(emptyContext)}
								emptyHint={resolveReviewEmptyHint(emptyContext)}
								selectedCandidateRuleIds={selectedCandidateRuleIds}
								selectableCandidateRuleIds={selectableCandidateRuleIds}
								onToggleCandidateRuleSelection={toggleCandidateRuleSelection}
								onToggleAllCandidateRuleSelections={
									toggleAllCandidateRuleSelections
								}
							/>
						</div>
						<div className="review-workbench-detail">
							{selectedCandidateRuleId ? (
								<CandidateRuleDetail
									candidateRuleId={selectedCandidateRuleId}
									principal={principal}
									backLabel="Clear selection"
									onBack={() => setSelectedCandidateRuleId(null)}
									onReviewChange={(updatedReview) => {
										setReviews((current) =>
											current.map((review) =>
												review.candidate_rule_id ===
												updatedReview.candidate_rule_id
													? updatedReview
													: review,
											),
										);
									}}
									onReviewResolved={(candidateRuleId) => {
										const currentIndex = displayedReviews.findIndex(
											(review) =>
												review.candidate_rule_id === candidateRuleId,
										);
										const nextCandidateRuleId =
											currentIndex >= 0
												? displayedReviews[currentIndex + 1]
														?.candidate_rule_id ?? null
												: null;
										setSelectedCandidateRuleId(nextCandidateRuleId);
									}}
								/>
							) : (
								<div className="review-selection-empty reveal">
									<span className="folio">Decision desk</span>
									<p>
										Choose a Candidate Rule to inspect source, QA flags, and
										review deltas.
									</p>
								</div>
							)}
						</div>
					</div>
				</div>
			) : null}

			{bulkApprovalOpen ? (
				<div className="review-decision-backdrop" role="presentation">
					<div
						className="review-decision-dialog"
						role="dialog"
						aria-modal="true"
						aria-label="Bulk approve Candidate Rules"
					>
						<div className="review-decision-head">
							<h4>Bulk approval record</h4>
							<p>
								Record the rationale for approving the selected Candidate
								Rules into the Structured Policy Store.
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
					</div>
				</div>
			) : null}
		</div>
	);
}
