import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
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
import type {
	AuthenticatedPrincipal,
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

type ReviewView =
	| { screen: "rules" }
	| { screen: "detail"; candidateRuleId: string };

interface RuleScopeFilters {
	documentId: string;
	documentVersionId: string;
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
	const [view, setView] = useState<ReviewView>({ screen: "rules" });
	const [rulesStatus, setRulesStatus] = useState<CatalogStatus>("loading");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [documents, setDocuments] = useState<PolicyDocumentSummary[]>([]);
	const [activeRun, setActiveRun] = useState<ExtractionRun | null>(null);
	const [reviews, setReviews] = useState<CandidateRuleReview[]>([]);
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
		setView({ screen: "rules" });
	}, [extractionRunId, loadActiveRun]);

	const customSelection = useMemo(
		() => [...customLifecycleSelection],
		[customLifecycleSelection],
	);

	const displayedReviews = useMemo(
		() => filterReviewsForTab(reviews, lifecycleTab, customSelection),
		[customSelection, lifecycleTab, reviews],
	);

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
		setLifecycleTab("custom");
	}

	function handleScopeSubmit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		setAppliedScopeFilters(buildRuleFilters(scopeDraft));
	}

	function handleClearScope(): void {
		const clearedScope: RuleScopeFilters = {
			documentId: "",
			documentVersionId: "",
		};
		setScopeDraft(clearedScope);
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

	if (view.screen === "detail") {
		return (
			<CandidateRuleDetail
				candidateRuleId={view.candidateRuleId}
				principal={principal}
				backLabel="← Back to rules"
				onBack={() => setView({ screen: "rules" })}
				onReviewChange={(updatedReview) => {
					setReviews((current) =>
						current.map((review) =>
							review.candidate_rule_id === updatedReview.candidate_rule_id
								? updatedReview
								: review,
						),
					);
				}}
			/>
		);
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
					<CandidateRuleLedger
						reviews={displayedReviews}
						onOpenReview={(candidateRuleId) =>
							setView({ screen: "detail", candidateRuleId })
						}
						emptyMessage={resolveReviewEmptyMessage(emptyContext)}
						emptyHint={resolveReviewEmptyHint(emptyContext)}
					/>
				</div>
			) : null}
		</div>
	);
}
