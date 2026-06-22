import { useEffect, useMemo, useState } from "react";
import { fetchCompiledRuleSets } from "../compiled-rule-sets/api";
import CompiledRuleSetPicker from "../compiled-rule-sets/CompiledRuleSetPicker";
import type { CompiledRuleSet } from "../compiled-rule-sets/types";
import { hasAnyRole } from "../shared/permissions";
import type { AuthenticatedPrincipal, Role } from "../shared/auth/types";
import StatusPill from "../shared/ui/StatusPill";
import { shortenId } from "../shared/format/common";
import { formatRelativeTime } from "../shared/format/relativeTime";
import TablePagination, {
  paginateItems,
  TABLE_PAGE_SIZE,
} from "../shared/ui/TablePagination";
import {
  executeComplianceEvaluationRun,
  fetchComplianceEvaluationRuns,
} from "./api";
import {
  describeComplianceEvaluationRunError,
  summarizeComplianceEvaluationRun,
} from "./format";
import type { ComplianceEvaluationRun } from "./types";

const EXECUTE_ALLOWED_ROLES: readonly Role[] = ["admin"];

export interface ComplianceEvaluationSectionProps {
  expenseReportId: string;
  rowCount: number;
  principal: AuthenticatedPrincipal;
  onOpenRun?: (complianceEvaluationRunId: string) => void;
}

export default function ComplianceEvaluationSection({
  expenseReportId,
  rowCount,
  principal,
  onOpenRun,
}: ComplianceEvaluationSectionProps) {
  const canExecute = hasAnyRole(principal, EXECUTE_ALLOWED_ROLES);
  const [compiledRuleSets, setCompiledRuleSets] = useState<CompiledRuleSet[]>([]);
  const [compiledRuleSetStatus, setCompiledRuleSetStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [compiledRuleSetError, setCompiledRuleSetError] = useState<string | null>(
    null,
  );
  const [selectedCompiledRuleSetId, setSelectedCompiledRuleSetId] = useState("");
  const [runs, setRuns] = useState<ComplianceEvaluationRun[]>([]);
  const [runStatus, setRunStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [runsPage, setRunsPage] = useState(1);

  const runnableRuleSets = useMemo(
    () => compiledRuleSets.filter((item) => item.summary.compiled > 0),
    [compiledRuleSets],
  );

  useEffect(() => {
    let cancelled = false;
    setCompiledRuleSetStatus("loading");
    setCompiledRuleSetError(null);

    void fetchCompiledRuleSets()
      .then((response) => {
        if (cancelled) {
          return;
        }
        setCompiledRuleSets(response.items);
        setCompiledRuleSetStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setCompiledRuleSetError(
          describeComplianceEvaluationRunError(
            error,
            "Unable to load Compiled Rule Sets.",
          ),
        );
        setCompiledRuleSetStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRunStatus("loading");
    setRunError(null);

    void fetchComplianceEvaluationRuns(expenseReportId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setRuns(response.items);
        setRunStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setRunError(
          describeComplianceEvaluationRunError(
            error,
            "Unable to load Compliance Evaluation Runs.",
          ),
        );
        setRunStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [expenseReportId]);

  useEffect(() => {
    setRunsPage(1);
  }, [expenseReportId]);

  const paginatedRuns = useMemo(
    () => paginateItems(runs, runsPage, TABLE_PAGE_SIZE),
    [runs, runsPage],
  );

  useEffect(() => {
    if (
      selectedCompiledRuleSetId ||
      runnableRuleSets.length === 0 ||
      compiledRuleSetStatus !== "ready"
    ) {
      return;
    }
    setSelectedCompiledRuleSetId(runnableRuleSets[0].compiled_rule_set_id);
  }, [
    compiledRuleSetStatus,
    runnableRuleSets,
    selectedCompiledRuleSetId,
  ]);

  async function handleExecute(): Promise<void> {
    if (!canExecute || !selectedCompiledRuleSetId || rowCount === 0) {
      return;
    }

    setIsExecuting(true);
    setExecuteError(null);

    try {
      const run = await executeComplianceEvaluationRun(expenseReportId, {
        compiled_rule_set_id: selectedCompiledRuleSetId,
      });
      setRuns((current) => [run, ...current]);
      setRunsPage(1);
    } catch (error: unknown) {
      setExecuteError(
        describeComplianceEvaluationRunError(
          error,
          "Unable to execute Compliance Evaluation Run.",
        ),
      );
    } finally {
      setIsExecuting(false);
    }
  }

  const emptyReportMessage =
    rowCount === 0
      ? "This Expense Report has no expense rows to evaluate."
      : null;

  return (
    <section
      className="compliance-evaluation-section"
      aria-label="Compliance Evaluation Runs"
    >
      <div className="compliance-evaluation-section-header">
        <div>
          <h4 className="record-section-heading">Compliance Evaluation</h4>
          <p className="review-ledger-scope">
            Batch-check expense rows against a pinned Compiled Rule Set.
          </p>
        </div>
      </div>

      {!canExecute ? (
        <p className="notion-callout">
          View-only — admin role required to execute Compliance Evaluation Runs.
        </p>
      ) : null}

      {canExecute ? (
        <div className="compliance-evaluation-trigger extraction-trigger reveal">
          {compiledRuleSetStatus === "loading" ? (
            <p className="catalog-status compact">
              <span className="catalog-status-rule" aria-hidden="true" />
              Loading Compiled Rule Sets…
            </p>
          ) : null}
          {compiledRuleSetError ? (
            <p className="error-banner" role="alert">
              {compiledRuleSetError}
            </p>
          ) : null}
          {compiledRuleSetStatus === "ready" && runnableRuleSets.length === 0 ? (
            <p className="extraction-trigger-empty">
              No Compiled Rule Sets with enforceable rules are available. Compile
              a published Policy Version first.
            </p>
          ) : null}
          {compiledRuleSetStatus === "ready" && runnableRuleSets.length > 0 ? (
            <form
              className="extraction-trigger-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleExecute();
              }}
            >
              <div className="extraction-trigger-fields">
                <CompiledRuleSetPicker
                  value={selectedCompiledRuleSetId}
                  compiledRuleSets={runnableRuleSets}
                  disabled={isExecuting}
                  onChange={setSelectedCompiledRuleSetId}
                />
                <div className="extraction-trigger-actions">
                  <button
                    type="submit"
                    className="extraction-trigger-submit extraction-trigger-submit-notion"
                    disabled={
                      isExecuting ||
                      rowCount === 0 ||
                      selectedCompiledRuleSetId.length === 0
                    }
                  >
                    {isExecuting ? "Running…" : "Run compliance check"}
                  </button>
                </div>
              </div>
            </form>
          ) : null}
          {emptyReportMessage ? (
            <output className="extraction-trigger-feedback">{emptyReportMessage}</output>
          ) : null}
          {executeError ? (
            <p className="extraction-trigger-feedback error" role="alert">
              {executeError}
            </p>
          ) : null}
        </div>
      ) : null}

      {runError ? <p className="error-banner">{runError}</p> : null}

      {runStatus === "loading" ? (
        <p className="catalog-status">Loading evaluation runs…</p>
      ) : null}

      {runStatus === "ready" && runs.length === 0 ? (
        <div className="extraction-empty compact reveal">
          <p>
            {canExecute
              ? "No Compliance Evaluation Runs yet for this Expense Report."
              : "No Compliance Evaluation Runs have been recorded for this Expense Report."}
          </p>
        </div>
      ) : null}

      {runStatus === "ready" && runs.length > 0 ? (
        <div className="db-table-wrap compliance-evaluation-runs-wrap">
          <table
            id="compliance-evaluation-runs-panel"
            className="db-table"
            aria-label="Compliance Evaluation Runs for this Expense Report"
            aria-describedby={
              paginatedRuns.totalCount > TABLE_PAGE_SIZE
                ? "compliance-evaluation-runs-pagination-range"
                : undefined
            }
          >
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">Policy Version</th>
                <th scope="col">Outcomes</th>
                <th scope="col">Executed by</th>
                <th scope="col">Executed</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRuns.items.map((run) => (
                <tr key={run.compliance_evaluation_run_id}>
                  <td className="db-mono">
                    {shortenId(run.compliance_evaluation_run_id, 12)}
                  </td>
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
                          run.summary.violation_count > 0 ? "danger" : "neutral"
                        }
                      />
                    </span>
                  </td>
                  <td>{run.executed_by}</td>
                  <td title={new Date(run.executed_at).toLocaleString()}>
                    {formatRelativeTime(run.executed_at)}
                  </td>
                  <td>
                    {onOpenRun ? (
                      <button
                        type="button"
                        className="rule-test-inline-action"
                        aria-label={`Open run ${run.compliance_evaluation_run_id}`}
                        onClick={() => onOpenRun(run.compliance_evaluation_run_id)}
                      >
                        View details
                      </button>
                    ) : (
                      <span
                        className="review-ledger-scope"
                        title={summarizeComplianceEvaluationRun(run.summary)}
                      >
                        {summarizeComplianceEvaluationRun(run.summary)}
                      </span>
                    )}
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
            idPrefix="compliance-evaluation-runs-pagination"
          />
        </div>
      ) : null}
    </section>
  );
}
