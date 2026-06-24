import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../shared/api/client";
import {
  downloadComplianceEvaluationRunReport,
  fetchAllComplianceEvaluationRuns,
  fetchComplianceEvaluationRun,
} from "./api";
import {
  citationDuplicatesReason,
  complianceOutcomeTone,
  describeComplianceEvaluationRunError,
  formatComplianceOutcome,
  formatEvaluationEvidenceContext,
  formatMatchingRuleIds,
  hasAggregationWindowContext,
  summarizeComplianceEvaluationRun,
} from "./format";
import AggregationWindowDetail from "./AggregationWindowDetail";
import type { ComplianceEvaluationRowOutcome, ComplianceEvaluationRun } from "./types";
import Breadcrumbs from "../shared/ui/Breadcrumbs";
import RecordPageHeader, {
  type RecordPropertyGroup,
} from "../shared/ui/RecordPageHeader";
import StatusPill from "../shared/ui/StatusPill";
import { ExpenseReportPageIcon, RecordPageIcon } from "../shared/ui/PageIcons";
import { formatDateTime, shortenId } from "../shared/format/common";
import { formatRelativeTime } from "../shared/format/relativeTime";
import TablePagination, {
  paginateItems,
  TABLE_PAGE_SIZE,
} from "../shared/ui/TablePagination";
import type { AuthenticatedPrincipal } from "../shared/auth/types";

interface ComplianceEvaluationRunCatalogProps {
  principal: AuthenticatedPrincipal;
  initialRunId?: string | null;
}

type CatalogStatus = "loading" | "ready" | "error";
type DetailStatus = "loading" | "ready" | "error" | "not_found";

function ComplianceEvaluationRuleId({ ruleId }: { ruleId: string }) {
  return (
    <code className="db-mono compliance-evaluation-rule-id" title={ruleId}>
      {shortenId(ruleId, 16)}
    </code>
  );
}

function ComplianceEvaluationComparisonCell({
  value,
}: {
  value: string | null;
}) {
  if (value === null || value.trim() === "") {
    return <>—</>;
  }
  return (
    <span className="compliance-evaluation-comparison-value">{value}</span>
  );
}

function ComplianceEvaluationOutcomeDetail({
  outcome,
}: {
  outcome: ComplianceEvaluationRowOutcome;
}) {
  const secondaryRules = formatMatchingRuleIds(
    outcome.rule_id,
    outcome.matching_rule_ids ?? [],
  );
  const citation = outcome.evidence[0] ?? null;
  const reason = outcome.reason?.trim() ?? null;
  const missingFields =
    outcome.missing_evidence_fields.length > 0
      ? outcome.missing_evidence_fields.join(", ")
      : null;
  const scopeContext = formatEvaluationEvidenceContext(outcome);
  const showAggregation = hasAggregationWindowContext(outcome.aggregation_context);
  const showPolicySource =
    citation !== null &&
    !citationDuplicatesReason(reason, citation.quote);
  const detailClassName =
    outcome.outcome === "needs_review"
      ? "compliance-evaluation-outcome-detail compliance-evaluation-review-detail"
      : outcome.outcome === "missing_evidence"
        ? "compliance-evaluation-outcome-detail compliance-evaluation-missing-evidence-detail"
        : "compliance-evaluation-outcome-detail compliance-evaluation-violation-detail";

  if (!reason && !missingFields && !secondaryRules && !showPolicySource && !scopeContext && !showAggregation) {
    return <>—</>;
  }

  return (
    <div className={detailClassName}>
      {showAggregation ? (
        <AggregationWindowDetail context={outcome.aggregation_context} />
      ) : null}
      {reason ? (
        <p className="compliance-evaluation-outcome-statement">{reason}</p>
      ) : null}
      {scopeContext ? (
        <p className="compliance-evaluation-scope-context">{scopeContext}</p>
      ) : null}
      {missingFields ? (
        <p className="compliance-evaluation-missing-evidence-fields">
          <span className="compliance-evaluation-detail-label">Missing</span>
          {missingFields}
        </p>
      ) : null}
      {secondaryRules ? (
        <p className="compliance-evaluation-secondary-rules">{secondaryRules}</p>
      ) : null}
      {showPolicySource && citation ? (
        <details className="compliance-evaluation-outcome-source">
          <summary>Policy source</summary>
          <blockquote
            className="compliance-evaluation-outcome-citation"
            cite={`${citation.document_id}#${citation.section_id}`}
          >
            {citation.quote}
          </blockquote>
          <p className="compliance-evaluation-outcome-source-meta">
            {citation.document_id} · {citation.section_id}
          </p>
        </details>
      ) : null}
    </div>
  );
}

function ComplianceEvaluationOutcomesColGroup() {
  return (
    <colgroup>
      <col className="compliance-evaluation-col-row" />
      <col className="compliance-evaluation-col-employee" />
      <col className="compliance-evaluation-col-date" />
      <col className="compliance-evaluation-col-outcome" />
      <col className="compliance-evaluation-col-rule" />
      <col className="compliance-evaluation-col-limit" />
      <col className="compliance-evaluation-col-actual" />
      <col className="compliance-evaluation-col-detail" />
    </colgroup>
  );
}

function ComplianceEvaluationOutcomeRow({
  runId,
  outcome,
}: {
  runId: string;
  outcome: ComplianceEvaluationRowOutcome;
}) {
  return (
    <tr key={`${runId}:${outcome.row_index}`}>
      <td className="db-mono">{outcome.row_index + 1}</td>
      <td className="db-mono">{outcome.employee_id}</td>
      <td>{outcome.expense_date}</td>
      <td>
        <StatusPill
          label={formatComplianceOutcome(outcome.outcome)}
          variant={complianceOutcomeTone(outcome.outcome)}
        />
      </td>
      <td>
        {outcome.rule_id ? (
          <ComplianceEvaluationRuleId ruleId={outcome.rule_id} />
        ) : (
          "—"
        )}
      </td>
      <td>
        <ComplianceEvaluationComparisonCell value={outcome.policy_limit} />
      </td>
      <td>
        <ComplianceEvaluationComparisonCell value={outcome.actual_value} />
      </td>
      <td>
        {outcome.outcome === "violation" ||
        outcome.outcome === "needs_review" ||
        outcome.outcome === "missing_evidence" ? (
          <ComplianceEvaluationOutcomeDetail outcome={outcome} />
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

function ComplianceEvaluationRunDetail({
  complianceEvaluationRunId,
  onBack,
}: {
  complianceEvaluationRunId: string;
  onBack: () => void;
}) {
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [run, setRun] = useState<ComplianceEvaluationRun | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDownloadingReport, setIsDownloadingReport] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [outcomesPage, setOutcomesPage] = useState(1);

  useEffect(() => {
    setOutcomesPage(1);
  }, [complianceEvaluationRunId]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrorMessage(null);
    setRun(null);

    void fetchComplianceEvaluationRun(complianceEvaluationRunId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setRun(response);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          setStatus("not_found");
          setErrorMessage("Compliance Evaluation Run was not found.");
          return;
        }
        setErrorMessage(
          describeComplianceEvaluationRunError(
            error,
            "Unable to load Compliance Evaluation Run.",
          ),
        );
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [complianceEvaluationRunId]);

  const paginatedOutcomes = useMemo(
    () =>
      run === null
        ? paginateItems([], outcomesPage, TABLE_PAGE_SIZE)
        : paginateItems(run.row_outcomes, outcomesPage, TABLE_PAGE_SIZE),
    [run, outcomesPage],
  );

  async function handleDownloadReport(): Promise<void> {
    setIsDownloadingReport(true);
    setDownloadError(null);
    try {
      await downloadComplianceEvaluationRunReport(complianceEvaluationRunId);
    } catch (error: unknown) {
      setDownloadError(
        describeComplianceEvaluationRunError(
          error,
          "Unable to download Compliance Evaluation Run report.",
        ),
      );
    } finally {
      setIsDownloadingReport(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="compliance-evaluation-run-detail content-enter">
        <Breadcrumbs
          items={[
            {
              label: "Evaluation Runs",
              icon: <ExpenseReportPageIcon size={14} />,
              onClick: onBack,
            },
          ]}
        />
        <p className="catalog-status">Loading evaluation run…</p>
      </div>
    );
  }

  if (status === "not_found" || status === "error" || run === null) {
    return (
      <div className="compliance-evaluation-run-detail content-enter">
        <Breadcrumbs
          items={[
            {
              label: "Evaluation Runs",
              icon: <ExpenseReportPageIcon size={14} />,
              onClick: onBack,
            },
          ]}
        />
        <p className="error-banner">
          {errorMessage ?? "Compliance Evaluation Run was not found."}
        </p>
      </div>
    );
  }

  const headerPropertyGroups: RecordPropertyGroup[] = [
    {
      title: "Run",
      properties: [
        {
          label: "Run ID",
          value: (
            <code className="db-mono">{run.compliance_evaluation_run_id}</code>
          ),
        },
        {
          label: "Executed by",
          value: run.executed_by,
        },
        {
          label: "Executed at",
          value: formatDateTime(run.executed_at),
        },
        {
          label: "Outcomes",
          value: summarizeComplianceEvaluationRun(run.summary),
        },
      ],
    },
    {
      title: "Inputs",
      properties: [
        {
          label: "Expense Report",
          value: <code className="db-mono">{run.expense_report_id}</code>,
        },
        ...(run.expense_input_fingerprint
          ? [
              {
                label: "Source file",
                value: run.expense_input_fingerprint.source_filename,
              },
              {
                label: "Row count",
                value: String(run.expense_input_fingerprint.row_count),
              },
              {
                label: "Content hash",
                value: (
                  <code className="db-mono" title={run.expense_input_fingerprint.content_hash}>
                    {run.expense_input_fingerprint.content_hash}
                  </code>
                ),
              },
            ]
          : []),
        {
          label: "Policy Version",
          value: <code className="db-mono">{run.policy_version_id}</code>,
        },
        {
          label: "Compiled Rule Set",
          value: <code className="db-mono">{run.compiled_rule_set_id}</code>,
        },
      ],
    },
  ];

  return (
    <div className="compliance-evaluation-run-detail content-enter">
      <RecordPageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              {
                label: "Evaluation Runs",
                icon: <ExpenseReportPageIcon size={14} />,
                onClick: onBack,
              },
              {
                label: shortenId(run.compliance_evaluation_run_id, 12),
                icon: <ExpenseReportPageIcon size={14} />,
              },
            ]}
          />
        }
        icon={<RecordPageIcon icon={<ExpenseReportPageIcon size={22} />} />}
        title={run.compliance_evaluation_run_id}
        subtitle={summarizeComplianceEvaluationRun(run.summary)}
        recordId={run.compliance_evaluation_run_id}
        lastUpdated={run.executed_at}
        propertyGroups={headerPropertyGroups}
        propertyLayout="stacked"
      />

      {downloadError ? <p className="error-banner">{downloadError}</p> : null}

      <div className="compliance-evaluation-outcomes-header">
        <div className="compliance-evaluation-outcomes-intro">
          <h4 className="record-section-heading">Expense outcomes</h4>
          <p className="review-ledger-scope">
            Per-expense outcomes from the batch compliance check.
          </p>
        </div>
        <div className="compliance-evaluation-outcomes-actions">
          <button
            type="button"
            className="document-command compact"
            disabled={isDownloadingReport}
            onClick={() => void handleDownloadReport()}
          >
            {isDownloadingReport ? "Downloading…" : "Download JSON"}
          </button>
        </div>
      </div>
      <div className="db-table-wrap compliance-evaluation-runs-wrap">
        <table
          id="compliance-evaluation-outcomes-panel"
          className="db-table"
          aria-label="Compliance Evaluation row outcomes"
          aria-describedby={
            paginatedOutcomes.totalCount > TABLE_PAGE_SIZE
              ? "compliance-evaluation-outcomes-pagination-range"
              : undefined
          }
        >
          <ComplianceEvaluationOutcomesColGroup />
          <thead>
            <tr>
              <th scope="col">Row</th>
              <th scope="col">Employee</th>
              <th scope="col">Date</th>
              <th scope="col">Outcome</th>
              <th scope="col">Rule</th>
              <th scope="col">Limit</th>
              <th scope="col">Actual</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {paginatedOutcomes.items.map((outcome) => (
              <ComplianceEvaluationOutcomeRow
                key={`${run.compliance_evaluation_run_id}:${outcome.row_index}`}
                runId={run.compliance_evaluation_run_id}
                outcome={outcome}
              />
            ))}
          </tbody>
        </table>
        <TablePagination
          page={paginatedOutcomes.page}
          pageSize={TABLE_PAGE_SIZE}
          totalCount={paginatedOutcomes.totalCount}
          onPageChange={setOutcomesPage}
          itemLabel="outcomes"
          idPrefix="compliance-evaluation-outcomes-pagination"
        />
      </div>
    </div>
  );
}

export default function ComplianceEvaluationRunCatalog({
  principal: _principal,
  initialRunId = null,
}: ComplianceEvaluationRunCatalogProps) {
  const [status, setStatus] = useState<CatalogStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [runs, setRuns] = useState<ComplianceEvaluationRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId);
  const [runsPage, setRunsPage] = useState(1);

  const paginatedRuns = useMemo(
    () => paginateItems(runs, runsPage, TABLE_PAGE_SIZE),
    [runs, runsPage],
  );

  useEffect(() => {
    setSelectedRunId(initialRunId);
  }, [initialRunId]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrorMessage(null);

    void fetchAllComplianceEvaluationRuns()
      .then((items) => {
        if (cancelled) {
          return;
        }
        setRuns(items);
        setRunsPage(1);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setErrorMessage(
          describeComplianceEvaluationRunError(
            error,
            "Unable to load Compliance Evaluation Runs.",
          ),
        );
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (selectedRunId) {
    return (
      <ComplianceEvaluationRunDetail
        complianceEvaluationRunId={selectedRunId}
        onBack={() => setSelectedRunId(null)}
      />
    );
  }

  return (
    <div className="catalog-page compliance-evaluation-run-catalog content-enter">
      {status === "loading" ? (
        <p className="catalog-status">
          <span className="catalog-status-rule" aria-hidden="true" />
          Loading evaluation runs…
        </p>
      ) : null}

      {status === "error" ? <p className="error-banner">{errorMessage}</p> : null}

      {status === "ready" ? (
        <>
          <div className="catalog-toolbar">
            <p className="catalog-scope">
              {runs.length === 0
                ? "No evaluation runs"
                : `${runs.length} evaluation run${runs.length === 1 ? "" : "s"}`}
            </p>
          </div>

          {runs.length === 0 ? (
            <div className="catalog-empty reveal">
              <h3>No Evaluation Runs yet</h3>
              <p>
                An admin executes a Compliance Evaluation Run from an Expense
                Report detail page after compiling a Policy Version.
              </p>
            </div>
          ) : (
            <div className="db-table-wrap compliance-evaluation-runs-wrap">
              <table
                id="compliance-evaluation-run-catalog-panel"
                className="db-table"
                aria-label="Compliance Evaluation Runs"
                aria-describedby={
                  paginatedRuns.totalCount > TABLE_PAGE_SIZE
                    ? "compliance-evaluation-run-catalog-pagination-range"
                    : undefined
                }
              >
                <thead>
                  <tr>
                    <th scope="col">Run</th>
                    <th scope="col">Expense Report</th>
                    <th scope="col">Policy Version</th>
                    <th scope="col">Outcomes</th>
                    <th scope="col">Executed by</th>
                    <th scope="col">Executed</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRuns.items.map((run) => (
                    <tr key={run.compliance_evaluation_run_id}>
                      <td className="db-mono">
                        <button
                          type="button"
                          className="db-row-button"
                          aria-label={`Open ${run.compliance_evaluation_run_id}`}
                          onClick={() =>
                            setSelectedRunId(run.compliance_evaluation_run_id)
                          }
                        >
                          {run.compliance_evaluation_run_id}
                        </button>
                      </td>
                      <td className="db-mono">{run.expense_report_id}</td>
                      <td className="db-mono">{run.policy_version_id}</td>
                      <td>
                        <span className="compliance-evaluation-outcome-summary">
                          <StatusPill
                            label={`${run.summary.pass_count} pass`}
                            variant="success"
                          />
                          <StatusPill
                            label={`${run.summary.violation_count} violation`}
                            variant={
                              run.summary.violation_count > 0
                                ? "danger"
                                : "neutral"
                            }
                          />
                          <StatusPill
                            label={`${run.summary.needs_review_count} needs review`}
                            variant={
                              run.summary.needs_review_count > 0
                                ? "warning"
                                : "neutral"
                            }
                          />
                          <StatusPill
                            label={`${run.summary.missing_evidence_count} missing evidence`}
                            variant={
                              run.summary.missing_evidence_count > 0
                                ? "warning"
                                : "neutral"
                            }
                          />
                        </span>
                      </td>
                      <td>{run.executed_by}</td>
                      <td title={new Date(run.executed_at).toLocaleString()}>
                        {formatRelativeTime(run.executed_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePagination
                page={paginatedRuns.page}
                pageSize={TABLE_PAGE_SIZE}
                totalCount={paginatedRuns.totalCount}
                onPageChange={setRunsPage}
                itemLabel="runs"
                idPrefix="compliance-evaluation-run-catalog-pagination"
              />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
