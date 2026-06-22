import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCandidateRules, fetchExtractionRuns, fetchPolicyVersions } from "./api";
import { REVIEW_QUEUE_LIFECYCLE_STATES } from "./candidateRuleFormat";
import { describeFetchError } from "./documentFormat";
import { formatExtractionRunStatus, shortenId } from "./extractionRunFormat";
import {
  formatPolicyVersionDate,
  formatRuleCount,
  latestPolicyVersionId,
} from "./policyVersionFormat";
import type {
  CandidateRuleReview,
  ExtractionRun,
  PolicyVersionSummary,
} from "./types";

type DashboardStatus = "loading" | "ready" | "error";
type DashboardSection = "documents" | "extraction-runs" | "review" | "policy-versions";

interface DashboardPageProps {
  onOpenRun: (extractionRunId: string) => void;
  onOpenSection: (section: DashboardSection) => void;
}

function sortNewestFirst<T extends { created_at: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    return Date.parse(right.created_at) - Date.parse(left.created_at);
  });
}

export default function DashboardPage({
  onOpenRun,
  onOpenSection,
}: DashboardPageProps) {
  const [status, setStatus] = useState<DashboardStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingReviews, setPendingReviews] = useState<CandidateRuleReview[]>([]);
  const [policyVersions, setPolicyVersions] = useState<PolicyVersionSummary[]>([]);
  const [extractionRuns, setExtractionRuns] = useState<ExtractionRun[]>([]);

  const loadDashboard = useCallback(async (): Promise<void> => {
    setStatus("loading");
    setErrorMessage(null);

    try {
      const [reviewsResponse, versionsResponse, runsResponse] = await Promise.all([
        fetchCandidateRules({ lifecycleStates: [...REVIEW_QUEUE_LIFECYCLE_STATES] }),
        fetchPolicyVersions(),
        fetchExtractionRuns(),
      ]);

      setPendingReviews(reviewsResponse.items);
      setPolicyVersions(sortNewestFirst(versionsResponse.items));
      setExtractionRuns(sortNewestFirst(runsResponse.items));
      setStatus("ready");
    } catch (error: unknown) {
      setErrorMessage(describeFetchError(error, "Unable to load dashboard summary."));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const latestPolicyVersion = policyVersions[0] ?? null;
  const recentRuns = useMemo(() => extractionRuns.slice(0, 4), [extractionRuns]);
  const flaggedPendingCount = pendingReviews.filter(
    (review) => (review.qa_flags?.length ?? 0) > 0,
  ).length;
  const completedRunCount = extractionRuns.filter(
    (run) => run.status === "completed",
  ).length;
  const failedRunCount = extractionRuns.length - completedRunCount;

  return (
    <div className="dashboard-page content-enter">
      <section className="dashboard-hero reveal">
        <div className="dashboard-hero-copy">
          <span className="folio">Editorial desk · Policy Pipeline</span>
          <h3>Policy Pipeline at a glance</h3>
          <p>
            Track pending Candidate Rules, the latest published Policy Version,
            and recent Extraction Runs without leaving the front page.
          </p>
        </div>
        <div className="dashboard-hero-actions">
          <button
            type="button"
            className="dashboard-action"
            onClick={() => onOpenSection("review")}
          >
            Open review queue
          </button>
          <button
            type="button"
            className="dashboard-action secondary"
            onClick={() => onOpenSection("policy-versions")}
          >
            Open Policy Versions
          </button>
        </div>
      </section>

      {status === "loading" ? (
        <p className="catalog-status">
          <span className="catalog-status-rule" aria-hidden="true" />
          Building the dashboard ledger…
        </p>
      ) : null}

      {status === "error" ? (
        <div className="dashboard-error">
          <p className="error-banner">{errorMessage}</p>
          <button type="button" className="dashboard-action secondary" onClick={() => void loadDashboard()}>
            Retry dashboard
          </button>
        </div>
      ) : null}

      {status === "ready" ? (
        <>
          <section className="dashboard-stat-grid" aria-label="Dashboard summary">
            <button
              type="button"
              className="dashboard-stat-card reveal"
              onClick={() => onOpenSection("review")}
            >
              <span className="dashboard-stat-kicker">Pending review</span>
              <strong className="dashboard-stat-value">
                {pendingReviews.length} Candidate Rule
                {pendingReviews.length === 1 ? "" : "s"}
              </strong>
              <p>
                {flaggedPendingCount > 0
                  ? `${flaggedPendingCount} with QA Flags still need editorial review.`
                  : "No pending QA Flags in the active queue."}
              </p>
            </button>

            <button
              type="button"
              className="dashboard-stat-card reveal"
              onClick={() => onOpenSection("policy-versions")}
            >
              <span className="dashboard-stat-kicker">Latest Policy Version</span>
              <strong className="dashboard-stat-value">
                {latestPolicyVersionId(policyVersions) ?? "Not published"}
              </strong>
              <p>
                {latestPolicyVersion
                  ? `${formatRuleCount(latestPolicyVersion.rule_count)} · ${formatPolicyVersionDate(
                      latestPolicyVersion.created_at,
                    )}`
                  : "Publish approved Rules to create the first immutable snapshot."}
              </p>
            </button>

            <button
              type="button"
              className="dashboard-stat-card reveal"
              onClick={() => onOpenSection("extraction-runs")}
            >
              <span className="dashboard-stat-kicker">Recent Extraction Runs</span>
              <strong className="dashboard-stat-value">{extractionRuns.length}</strong>
              <p>
                {completedRunCount} completed
                {failedRunCount > 0 ? ` · ${failedRunCount} failed` : " · no failures"}
              </p>
            </button>
          </section>

          <section className="dashboard-run-panel reveal">
            <div className="dashboard-run-panel-head">
              <div>
                <span className="dashboard-stat-kicker">Recent Extraction Runs</span>
                <h4>Latest machine output</h4>
              </div>
              <button
                type="button"
                className="dashboard-inline-link"
                onClick={() => onOpenSection("extraction-runs")}
              >
                View full ledger
              </button>
            </div>

            {recentRuns.length === 0 ? (
              <p className="dashboard-empty">
                No Extraction Runs have been recorded yet.
              </p>
            ) : (
              <ol className="dashboard-run-list">
                {recentRuns.map((run) => (
                  <li key={run.extraction_run_id}>
                    <button
                      type="button"
                      className="dashboard-run-card"
                      onClick={() => onOpenRun(run.extraction_run_id)}
                    >
                      <div className="dashboard-run-card-head">
                        <code>{shortenId(run.extraction_run_id)}</code>
                        <span
                          className={`extraction-status ${run.status}`}
                        >
                          {formatExtractionRunStatus(run.status)}
                        </span>
                      </div>
                      <p className="dashboard-run-document">{run.document_id}</p>
                      <p className="dashboard-run-meta">
                        {run.document_version_id} · {run.candidate_rule_count} Candidate Rule
                        {run.candidate_rule_count === 1 ? "" : "s"}
                      </p>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : null}

      <section className="dashboard-quick-links reveal">
        <button
          type="button"
          className="dashboard-inline-link"
          onClick={() => onOpenSection("documents")}
        >
          Browse Document Versions
        </button>
        <button
          type="button"
          className="dashboard-inline-link"
          onClick={() => onOpenSection("review")}
        >
          Review Candidate Rules
        </button>
      </section>
    </div>
  );
}
