import { fetchCandidateRules } from "../candidate-rules/api";
import type { CandidateRuleReview } from "../candidate-rules/types";
import { fetchExtractionRuns } from "../extraction-runs/api";
import type { ExtractionRun } from "../extraction-runs/types";
import { fetchPolicyVersions } from "../policy-versions/api";
import type { PolicyVersionSummary } from "../policy-versions/types";
import { fetchExpenseReports } from "../api";
import { fetchAllComplianceEvaluationRuns } from "../compliance-evaluation-runs/api";
import type { ComplianceEvaluationRun } from "../compliance-evaluation-runs/types";
import { fetchComplianceReviews } from "../compliance-review/api";
import {
	formatExtractionRunStatus,
	shortenId,
} from "../extraction-runs/format";
import { useCallback, useMemo } from "react";
import { REVIEW_QUEUE_LIFECYCLE_STATES } from "../candidate-rules/format";
import { formatUploadDate } from "../policy-documents/format";
import {
	formatPolicyVersionDate,
	formatRuleCount,
	latestPolicyVersionId,
} from "../policy-versions/format";
import { useAsyncResource } from "../shared/ui/useAsyncResource";
import type { DashboardSectionId } from "../app/navigation";

interface DashboardPageProps {
	onOpenRun: (extractionRunId: string) => void;
	onOpenSection: (section: DashboardSectionId) => void;
	onStartGuidedTour: () => void;
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
	expenseReportCount: number;
	evaluationRuns: ComplianceEvaluationRun[];
	complianceReviewCount: number;
}

function formatPassRate(run: ComplianceEvaluationRun | null): string {
	if (!run || run.summary.total_count === 0) {
		return "—";
	}
	const passRate = Math.round(
		(run.summary.pass_count / run.summary.total_count) * 100,
	);
	return `${passRate}% pass`;
}

function passRateTone(run: ComplianceEvaluationRun | null): "neutral" | "good" | "alert" {
	if (!run || run.summary.total_count === 0) {
		return "neutral";
	}
	const passRate = Math.round(
		(run.summary.pass_count / run.summary.total_count) * 100,
	);
	if (passRate >= 80) {
		return "good";
	}
	if (passRate === 0) {
		return "alert";
	}
	return "neutral";
}

export default function DashboardPage({
	onOpenRun,
	onOpenSection,
	onStartGuidedTour,
}: DashboardPageProps) {
	const fetchDashboard = useCallback(async (): Promise<DashboardData> => {
		const [
			reviewsResponse,
			versionsResponse,
			runsResponse,
			expenseReportsResponse,
			evaluationRuns,
			complianceReviewsResponse,
		] = await Promise.all([
			fetchCandidateRules({
				lifecycleStates: [...REVIEW_QUEUE_LIFECYCLE_STATES],
			}),
			fetchPolicyVersions(),
			fetchExtractionRuns(),
			fetchExpenseReports(),
			fetchAllComplianceEvaluationRuns(),
			fetchComplianceReviews(),
		]);

		return {
			pendingReviews: reviewsResponse.items,
			policyVersions: sortNewestFirst(versionsResponse.items),
			extractionRuns: sortNewestFirst(runsResponse.items),
			expenseReportCount: expenseReportsResponse.items.length,
			evaluationRuns,
			complianceReviewCount: complianceReviewsResponse.items.length,
		};
	}, []);

	const {
		status,
		data,
		error: errorMessage,
		reload: loadDashboard,
	} = useAsyncResource(fetchDashboard, "Unable to load dashboard summary.");

	const pendingReviews = data?.pendingReviews ?? [];
	const policyVersions = data?.policyVersions ?? [];
	const extractionRuns = data?.extractionRuns ?? [];
	const expenseReportCount = data?.expenseReportCount ?? 0;
	const evaluationRuns = data?.evaluationRuns ?? [];
	const complianceReviewCount = data?.complianceReviewCount ?? 0;

	const latestPolicyVersion = policyVersions[0] ?? null;
	const latestVersionId = latestPolicyVersionId(policyVersions);
	const recentRuns = useMemo(
		() => extractionRuns.slice(0, 6),
		[extractionRuns],
	);
	const latestEvaluationRun = evaluationRuns[0] ?? null;
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
					`${expenseReportCount} expense report${expenseReportCount === 1 ? "" : "s"}`,
					`${evaluationRuns.length} evaluation run${evaluationRuns.length === 1 ? "" : "s"}`,
					`${complianceReviewCount} in review queue`,
					`${pendingReviews.length} rules pending`,
				].join(" · ")
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
					<div className="dashboard-hero">
						<p className="dashboard-hero-summary">{scopeSummary}</p>
						<div className="dashboard-hero-actions">
							<button
								type="button"
								className="guided-tour-btn guided-tour-btn-primary"
								onClick={onStartGuidedTour}
							>
								Start guided tour
							</button>
							<button
								type="button"
								className="desk-action"
								onClick={() => onOpenSection("review")}
							>
								Review queue
							</button>
						</div>
					</div>

					<div className="dashboard-columns">
						<section
							className="dashboard-column dashboard-column-operate reveal"
							style={{ animationDelay: "40ms" }}
							aria-label="Operate summary"
						>
							<header className="dashboard-column-head">
								<span className="dashboard-column-kicker">Operate</span>
								<h3 className="dashboard-column-title">Run compliance</h3>
								<p className="dashboard-column-summary">
									Evaluate expenses and resolve outcomes needing review.
								</p>
							</header>

							<div className="dashboard-column-metrics">
								<button
									type="button"
									className="dashboard-metric"
									onClick={() => onOpenSection("expense-reports")}
								>
									<span className="dashboard-metric-label">
										Expense reports
									</span>
									<span className="dashboard-metric-value">
										{expenseReportCount}
									</span>
									<span className="dashboard-metric-meta">
										Imported batches
									</span>
								</button>

								<button
									type="button"
									className="dashboard-metric"
									onClick={() => onOpenSection("evaluation-runs")}
								>
									<span className="dashboard-metric-label">
										Evaluation runs
									</span>
									<span className="dashboard-metric-value">
										{evaluationRuns.length}
									</span>
									<span
										className={`dashboard-metric-meta is-${passRateTone(latestEvaluationRun)}`}
									>
										{latestEvaluationRun
											? `Latest ${formatPassRate(latestEvaluationRun)}`
											: "No runs yet"}
									</span>
								</button>

								<button
									type="button"
									className="dashboard-metric"
									onClick={() => onOpenSection("compliance-review")}
								>
									<span className="dashboard-metric-label">Review queue</span>
									<span
										className={`dashboard-metric-value${complianceReviewCount > 0 ? " is-emphasis" : ""}`}
									>
										{complianceReviewCount}
									</span>
									<span className="dashboard-metric-meta">
										Needs human resolution
									</span>
								</button>
							</div>
						</section>

						<section
							className="dashboard-column dashboard-column-author reveal"
							style={{ animationDelay: "120ms" }}
							aria-label="Author policy summary"
						>
							<header className="dashboard-column-head">
								<span className="dashboard-column-kicker">Author Policy</span>
								<h3 className="dashboard-column-title">
									Build executable rules
								</h3>
								<p className="dashboard-column-summary">
									Extract rules from policy and publish compiled sets.
								</p>
							</header>

							<div className="dashboard-column-metrics">
								<button
									type="button"
									className="dashboard-metric"
									onClick={() => onOpenSection("review")}
								>
									<span className="dashboard-metric-label">Rule review</span>
									<span className="dashboard-metric-value">
										{pendingReviews.length}
									</span>
									{flaggedPendingCount > 0 ? (
										<span className="dashboard-metric-meta is-caution">
											{flaggedPendingCount} flagged
										</span>
									) : (
										<span className="dashboard-metric-meta">
											Awaiting approver
										</span>
									)}
								</button>

								<button
									type="button"
									className="dashboard-metric"
									onClick={() => onOpenSection("policy-versions")}
								>
									<span className="dashboard-metric-label">
										Policy version
									</span>
									<span
										className="dashboard-metric-value dashboard-metric-value-mono"
										title={latestVersionId ?? undefined}
									>
										{latestVersionId ?? "—"}
									</span>
									{latestPolicyVersion ? (
										<span className="dashboard-metric-meta">
											{formatRuleCount(latestPolicyVersion.rule_count)} ·{" "}
											{formatPolicyVersionDate(latestPolicyVersion.created_at)}
										</span>
									) : (
										<span className="dashboard-metric-meta">Not published</span>
									)}
								</button>

								<button
									type="button"
									className="dashboard-metric"
									onClick={() => onOpenSection("extraction-runs")}
								>
									<span className="dashboard-metric-label">
										Extraction runs
									</span>
									<span className="dashboard-metric-value">
										{extractionRuns.length}
									</span>
									<span
										className={`dashboard-metric-meta${failedRunCount > 0 ? " is-caution" : ""}`}
									>
										{failedRunCount > 0
											? `${completedRunCount} completed · ${failedRunCount} failed`
											: `${completedRunCount} completed`}
									</span>
								</button>
							</div>
						</section>
					</div>

					<section className="desk-ledger" aria-label="Recent Extraction Runs">
						<div className="catalog-toolbar">
							<p className="catalog-scope">
								{recentRuns.length} recent extraction run
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
														onClick={() => onOpenRun(run.extraction_run_id)}
													>
														{shortenId(run.extraction_run_id)}
													</button>
												</td>
												<td>
													<span className={`extraction-status ${run.status}`}>
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
