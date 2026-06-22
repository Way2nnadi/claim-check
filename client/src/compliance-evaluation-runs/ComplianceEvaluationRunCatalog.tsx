import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../shared/api/client";
import {
  downloadComplianceEvaluationRunReport,
  fetchAllComplianceEvaluationRuns,
  fetchComplianceEvaluationRun,
} from "./api";
import {
  complianceOutcomeTone,
  describeComplianceEvaluationRunError,
  formatComplianceOutcome,
  summarizeComplianceEvaluationRun,
} from "./format";
import type { ComplianceEvaluationRun } from "./types";
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
          <thead>
            <tr>
              <th scope="col">Row</th>
              <th scope="col">Employee</th>
              <th scope="col">Date</th>
              <th scope="col">Outcome</th>
              <th scope="col">Rule</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {paginatedOutcomes.items.map((outcome) => (
              <tr key={`${run.compliance_evaluation_run_id}:${outcome.row_index}`}>
                <td className="db-mono">{outcome.row_index + 1}</td>
                <td className="db-mono">{outcome.employee_id}</td>
                <td>{outcome.expense_date}</td>
                <td>
                  <StatusPill
                    label={formatComplianceOutcome(outcome.outcome)}
                    variant={complianceOutcomeTone(outcome.outcome)}
                  />
                </td>
                <td className="db-mono">{outcome.rule_id ?? "—"}</td>
                <td>{outcome.reason ?? "—"}</td>
              </tr>
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
