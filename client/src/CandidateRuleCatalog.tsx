import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
	approveCandidateRule,
	fetchCandidateRule,
	fetchCandidateRules,
	fetchExtractionRuns,
	fetchPolicyDocuments,
	rejectCandidateRule,
} from "./api";
import CandidateRuleDecisionModal from "./CandidateRuleDecisionModal";
import CandidateRuleDetail from "./CandidateRuleDetail";
import CandidateRuleLedger from "./CandidateRuleLedger";
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
import type {
	AuthenticatedPrincipal,
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
	const [rulesStatus, setRulesStatus] = useState<CatalogStatus>("loading");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [documents, setDocuments] = useState<PolicyDocumentSummary[]>([]);
	const [activeRun, setActiveRun] = useState<ExtractionRun | null>(null);
	const [reviews, setReviews] = useState<CandidateRuleReview[]>([]);
	const [lifecycleTab, setLifecycleTab] = useState<LifecycleTabId>("queue");
	const [scopeDraft, setScopeDraft] = useState<RuleScopeFilters>({
		documentId: "",
		documentVersionId: "",
	});
	const [appliedScopeFilters, setAppliedScopeFilters] =
		useState<CandidateRuleFilters>({});
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

	if (selectedCandidateRuleId) {
		return (
			<CandidateRuleDetail
				candidateRuleId={selectedCandidateRuleId}
				principal={principal}
				backLabel="← Queue"
				onBack={() => setSelectedCandidateRuleId(null)}
				onReviewChange={(updatedReview) => {
					setReviews((current) =>
						current.map((review) =>
							review.candidate_rule_id === updatedReview.candidate_rule_id
								? updatedReview
								: review,
						),
					);
				}}
				onReviewResolved={(candidateRuleId) => {
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
		</div>
	);
}
