import { fetchCandidateRules } from "../candidate-rules/api";
import type { CandidateRuleReview } from "../candidate-rules/types";
import { fetchExtractionRuns } from "../extraction-runs/api";
import type { ExtractionRun } from "../extraction-runs/types";
import { fetchPolicyVersions } from "../policy-versions/api";
import type { PolicyVersionSummary } from "../policy-versions/types";
import { formatExtractionRunStatus, shortenId } from "../extraction-runs/format";
import { useCallback, useMemo } from "react";
import { REVIEW_QUEUE_LIFECYCLE_STATES } from "../candidate-rules/format";
import { formatUploadDate } from "../policy-documents/format";
import { formatPolicyVersionDate, formatRuleCount, latestPolicyVersionId } from "../policy-versions/format";
import { useAsyncResource } from "../shared/ui/useAsyncResource";

type DashboardSection =
	| "documents"
	| "extraction-runs"
	| "review"
	| "policy-versions";

interface DashboardPageProps {
	onOpenRun: (extractionRunId: string) => void;
	onOpenSection: (section: DashboardSection) => void;
}

function sortNewestFirst<T extends { created_at: string }>(
	items: readonly T[],
): T[] {
	return [...items].sort((left, right) => {
		return Date.parse(right.created_at) - Date.parse(left.created_at);
	});
}

interface DashboardData {
	pendingReviews: CandidateRuleReview[];
	policyVersions: PolicyVersionSummary[];
	extractionRuns: ExtractionRun[];
}

export default function DashboardPage({
	onOpenRun,
	onOpenSection,
}: DashboardPageProps) {
	const fetchDashboard = useCallback(async (): Promise<DashboardData> => {
		const [reviewsResponse, versionsResponse, runsResponse] =
			await Promise.all([
				fetchCandidateRules({
					lifecycleStates: [...REVIEW_QUEUE_LIFECYCLE_STATES],
				}),
				fetchPolicyVersions(),
				fetchExtractionRuns(),
			]);

		return {
			pendingReviews: reviewsResponse.items,
			policyVersions: sortNewestFirst(versionsResponse.items),
			extractionRuns: sortNewestFirst(runsResponse.items),
		};
	}, []);

	const { status, data, error: errorMessage, reload: loadDashboard } =
		useAsyncResource(fetchDashboard, "Unable to load dashboard summary.");

	const pendingReviews = data?.pendingReviews ?? [];
	const policyVersions = data?.policyVersions ?? [];
	const extractionRuns = data?.extractionRuns ?? [];

	const latestPolicyVersion = policyVersions[0] ?? null;
	const latestVersionId = latestPolicyVersionId(policyVersions);
	const recentRuns = useMemo(
		() => extractionRuns.slice(0, 6),
		[extractionRuns],
	);
	const flaggedPendingCount = pendingReviews.filter(
		(review) => (review.qa_flags?.length ?? 0) > 0,
	).length;
	const completedRunCount = extractionRuns.filter(
		(run) => run.status === "completed",
	).length;
	const failedRunCount = extractionRuns.length - completedRunCount;

	const scopeSummary =
		status === "ready"
			? [
					`${pendingReviews.length} pending`,
					flaggedPendingCount > 0 ? `${flaggedPendingCount} flagged` : null,
					latestVersionId ? `latest ${latestVersionId}` : "no Policy Version",
					`${extractionRuns.length} run${extractionRuns.length === 1 ? "" : "s"}`,
				]
					.filter(Boolean)
					.join(" · ")
			: null;

	return (
		<div className="dashboard-page catalog-page">
			{status === "loading" ? (
				<p className="catalog-status">
					<span className="catalog-status-rule" aria-hidden="true" />
					Loading…
				</p>
			) : null}

			{status === "error" ? (
				<div className="desk-error">
					<p className="error-banner">{errorMessage}</p>
					<button
						type="button"
						className="desk-action"
						onClick={() => void loadDashboard()}
					>
						Retry
					</button>
				</div>
			) : null}

			{status === "ready" ? (
				<>
					<div className="catalog-toolbar">
						<p className="catalog-scope">{scopeSummary}</p>
						<button
							type="button"
							className="document-command"
							onClick={() => onOpenSection("review")}
						>
							Review queue
						</button>
					</div>

					<section className="db-properties" aria-label="Summary">
						<button
							type="button"
							className="db-property"
							onClick={() => onOpenSection("review")}
						>
							<span className="db-property-label">Review queue</span>
							<span className="db-property-value">{pendingReviews.length}</span>
							{flaggedPendingCount > 0 ? (
								<span className="db-property-meta">
									{flaggedPendingCount} flagged
								</span>
							) : null}
						</button>

						<button
							type="button"
							className="db-property"
							onClick={() => onOpenSection("policy-versions")}
						>
							<span className="db-property-label">Policy version</span>
							<span className="db-property-value">
								{latestVersionId ?? "—"}
							</span>
							{latestPolicyVersion ? (
								<span className="db-property-meta">
									{formatRuleCount(latestPolicyVersion.rule_count)} ·{" "}
									{formatPolicyVersionDate(latestPolicyVersion.created_at)}
								</span>
							) : null}
						</button>

						<button
							type="button"
							className="db-property"
							onClick={() => onOpenSection("extraction-runs")}
						>
							<span className="db-property-label">Extraction runs</span>
							<span className="db-property-value">
								{extractionRuns.length}
							</span>
							<span className="db-property-meta">
								{failedRunCount > 0
									? `${completedRunCount} completed · ${failedRunCount} failed`
									: `${completedRunCount} completed`}
							</span>
						</button>
					</section>

					<section className="desk-ledger" aria-label="Recent Extraction Runs">
						<div className="catalog-toolbar">
							<p className="catalog-scope">
								{recentRuns.length} recent run
								{recentRuns.length === 1 ? "" : "s"}
							</p>
							<button
								type="button"
								className="desk-inline-link"
								onClick={() => onOpenSection("extraction-runs")}
							>
								View all
							</button>
						</div>

						{recentRuns.length === 0 ? (
							<p className="desk-empty">No runs recorded.</p>
						) : (
							<div className="db-table-wrap">
								<table className="db-table desk-run-table">
									<thead>
										<tr>
											<th scope="col">Run ID</th>
											<th scope="col">Status</th>
											<th scope="col">Document Version</th>
											<th scope="col">Rules</th>
											<th scope="col">Recorded</th>
										</tr>
									</thead>
									<tbody>
										{recentRuns.map((run) => (
											<tr key={run.extraction_run_id}>
												<td>
													<button
														type="button"
														className="desk-row-link mono"
														onClick={() =>
															onOpenRun(run.extraction_run_id)
														}
													>
														{shortenId(run.extraction_run_id)}
													</button>
												</td>
												<td>
													<span
														className={`extraction-status ${run.status}`}
													>
														{formatExtractionRunStatus(run.status)}
													</span>
												</td>
												<td>
													<span className="desk-cell-primary">
														{run.document_id}
													</span>
													<code className="desk-cell-secondary">
														{run.document_version_id}
													</code>
												</td>
												<td className="desk-metric">
													{run.candidate_rule_count}
												</td>
												<td>
													<time dateTime={run.created_at}>
														{formatUploadDate(run.created_at)}
													</time>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</section>
				</>
			) : null}
		</div>
	);
}
