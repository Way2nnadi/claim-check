import { useEffect, useMemo, useState } from "react";
import { fetchCompiledRuleSetsForPolicyVersion } from "../compiled-rule-sets/api";
import type { CompiledRuleSet } from "../compiled-rule-sets/types";
import { fetchPolicyVersions } from "../policy-versions/api";
import PolicyVersionPicker from "../policy-versions/PolicyVersionPicker";
import type { PolicyVersionSummary } from "../policy-versions/types";
import { hasAnyRole } from "../shared/permissions";
import type { AuthenticatedPrincipal, Role } from "../shared/auth/types";
import StatusPill from "../shared/ui/StatusPill";
import { shortenId } from "../shared/format/common";
import { formatRelativeTime } from "../shared/format/relativeTime";
import TablePagination, {
  paginateItems,
  TABLE_PAGE_SIZE,
} from "../shared/ui/TablePagination";
import { fetchRuleTestRuns } from "../rule-test-cases/api";
import type { RuleTestRun } from "../rule-test-cases/types";
import {
  executeComplianceEvaluationRun,
  fetchComplianceEvaluationRuns,
} from "./api";
import {
  describeComplianceEvaluationRunError,
  describeRuleTestRunGate,
  resolveRuleTestRunGateStatus,
  summarizeComplianceEvaluationRun,
} from "./format";
import type { ComplianceEvaluationRun } from "./types";

const EXECUTE_ALLOWED_ROLES: readonly Role[] = ["admin"];

export interface ComplianceEvaluationSectionProps {
  expenseReportId: string;
  rowCount: number;
  principal: AuthenticatedPrincipal;
  onOpenRun?: (complianceEvaluationRunId: string) => void;
  onOpenCompiledRuleSet?: (compiledRuleSetId: string) => void;
}

export default function ComplianceEvaluationSection({
  expenseReportId,
  rowCount,
  principal,
  onOpenRun,
  onOpenCompiledRuleSet,
}: ComplianceEvaluationSectionProps) {
  const canExecute = hasAnyRole(principal, EXECUTE_ALLOWED_ROLES);
  const [policyVersions, setPolicyVersions] = useState<PolicyVersionSummary[]>([]);
  const [policyVersionStatus, setPolicyVersionStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [policyVersionError, setPolicyVersionError] = useState<string | null>(
    null,
  );
  const [selectedPolicyVersionId, setSelectedPolicyVersionId] = useState("");
  const [resolvedCompiledRuleSet, setResolvedCompiledRuleSet] =
    useState<CompiledRuleSet | null>(null);
  const [compiledRuleSetStatus, setCompiledRuleSetStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [compiledRuleSetError, setCompiledRuleSetError] = useState<string | null>(
    null,
  );
  const [runs, setRuns] = useState<ComplianceEvaluationRun[]>([]);
  const [runStatus, setRunStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [runsPage, setRunsPage] = useState(1);
  const [ruleTestRuns, setRuleTestRuns] = useState<RuleTestRun[]>([]);
  const [ruleTestRunStatus, setRuleTestRunStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [ruleTestRunError, setRuleTestRunError] = useState<string | null>(null);

  const latestRuleTestRun = ruleTestRuns[0] ?? null;
  const hasResolvedCompiledRuleSet = resolvedCompiledRuleSet !== null;
  const ruleTestRunGateStatus = resolveRuleTestRunGateStatus({
    enforceableRuleCount: resolvedCompiledRuleSet?.summary.compiled ?? 0,
    latestRun: latestRuleTestRun,
    status: hasResolvedCompiledRuleSet ? ruleTestRunStatus : "ready",
  });
  const ruleTestRunGate = describeRuleTestRunGate({
    gateStatus: ruleTestRunGateStatus,
    latestRun: latestRuleTestRun,
    hasCompiledRuleSet: hasResolvedCompiledRuleSet,
  });
  const isRuleTestGateClosed =
    hasResolvedCompiledRuleSet &&
    (ruleTestRunGateStatus === "missing_run" ||
      ruleTestRunGateStatus === "failed_run");

  useEffect(() => {
    let cancelled = false;
    setPolicyVersionStatus("loading");
    setPolicyVersionError(null);

    void fetchPolicyVersions()
      .then((response) => {
        if (cancelled) {
          return;
        }
        setPolicyVersions(response.items);
        setPolicyVersionStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setPolicyVersionError(
          describeComplianceEvaluationRunError(
            error,
            "Unable to load Policy Versions.",
          ),
        );
        setPolicyVersionStatus("error");
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
    if (!selectedPolicyVersionId) {
      setResolvedCompiledRuleSet(null);
      setCompiledRuleSetStatus("ready");
      setCompiledRuleSetError(null);
      return;
    }

    let cancelled = false;
    setCompiledRuleSetStatus("loading");
    setCompiledRuleSetError(null);

    void fetchCompiledRuleSetsForPolicyVersion(selectedPolicyVersionId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setResolvedCompiledRuleSet(response.items[0] ?? null);
        setCompiledRuleSetStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setCompiledRuleSetError(
          describeComplianceEvaluationRunError(
            error,
            "Unable to load Compiled Rule Set for this Policy Version.",
          ),
        );
        setCompiledRuleSetStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPolicyVersionId]);

  useEffect(() => {
    const compiledRuleSetId = resolvedCompiledRuleSet?.compiled_rule_set_id;
    if (
      !compiledRuleSetId ||
      resolvedCompiledRuleSet?.summary.compiled === 0
    ) {
      setRuleTestRuns([]);
      setRuleTestRunStatus("ready");
      setRuleTestRunError(null);
      return;
    }

    let cancelled = false;
    setRuleTestRunStatus("loading");
    setRuleTestRunError(null);

    void fetchRuleTestRuns(compiledRuleSetId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setRuleTestRuns(response.items);
        setRuleTestRunStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setRuleTestRunError(
          describeComplianceEvaluationRunError(
            error,
            "Unable to load Rule Test Runs for this Policy Version.",
          ),
        );
        setRuleTestRunStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [
    resolvedCompiledRuleSet?.compiled_rule_set_id,
    resolvedCompiledRuleSet?.summary.compiled,
  ]);

  useEffect(() => {
    setRunsPage(1);
  }, [expenseReportId]);

  const paginatedRuns = useMemo(
    () => paginateItems(runs, runsPage, TABLE_PAGE_SIZE),
    [runs, runsPage],
  );

  useEffect(() => {
    if (
      selectedPolicyVersionId ||
      policyVersions.length === 0 ||
      policyVersionStatus !== "ready"
    ) {
      return;
    }
    setSelectedPolicyVersionId(policyVersions[0].policy_version_id);
  }, [policyVersionStatus, policyVersions, selectedPolicyVersionId]);

  async function handleExecute(): Promise<void> {
    if (
      !canExecute ||
      !selectedPolicyVersionId ||
      rowCount === 0 ||
      isRuleTestGateClosed
    ) {
      return;
    }

    setIsExecuting(true);
    setExecuteError(null);

    try {
      const run = await executeComplianceEvaluationRun(expenseReportId, {
        policy_version_id: selectedPolicyVersionId,
      });
      setRuns((current) => [run, ...current]);
      setRunsPage(1);

      if (!hasResolvedCompiledRuleSet) {
        const compiledRuleSets = await fetchCompiledRuleSetsForPolicyVersion(
          selectedPolicyVersionId,
        );
        setResolvedCompiledRuleSet(compiledRuleSets.items[0] ?? null);
      }
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
            Batch-check expense rows against a pinned Policy Version. The
            server compiles on first run when needed and records the Compiled
            Rule Set on the run for reproducibility.
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
          {policyVersionStatus === "loading" ? (
            <p className="catalog-status compact">
              <span className="catalog-status-rule" aria-hidden="true" />
              Loading Policy Versions…
            </p>
          ) : null}
          {policyVersionError ? (
            <p className="error-banner" role="alert">
              {policyVersionError}
            </p>
          ) : null}
          {policyVersionStatus === "ready" && policyVersions.length === 0 ? (
            <p className="extraction-trigger-empty">
              No published Policy Versions are available. Publish a Policy
              Version first.
            </p>
          ) : null}
          {policyVersionStatus === "ready" && policyVersions.length > 0 ? (
            <form
              className="extraction-trigger-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleExecute();
              }}
            >
              {compiledRuleSetError ? (
                <p className="extraction-trigger-feedback error" role="alert">
                  {compiledRuleSetError}
                </p>
              ) : null}
              {selectedPolicyVersionId ? (
                <div
                  className={`compliance-evaluation-gate notion-callout${
                    isRuleTestGateClosed ? " error" : ""
                  }`}
                  role="status"
                >
                  <p className="compliance-evaluation-gate-title">
                    {ruleTestRunGate.title}
                  </p>
                  <p className="review-ledger-scope">{ruleTestRunGate.detail}</p>
                  {ruleTestRunError ? (
                    <p className="extraction-trigger-feedback error" role="alert">
                      {ruleTestRunError}
                    </p>
                  ) : null}
                  {onOpenCompiledRuleSet &&
                  resolvedCompiledRuleSet &&
                  (isRuleTestGateClosed || latestRuleTestRun !== null) ? (
                    <button
                      type="button"
                      className="rule-test-inline-action"
                      onClick={() =>
                        onOpenCompiledRuleSet(
                          resolvedCompiledRuleSet.compiled_rule_set_id,
                        )
                      }
                    >
                      {isRuleTestGateClosed
                        ? "Review Rule Test failures"
                        : "View Rule Test Run"}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="extraction-trigger-fields">
                <PolicyVersionPicker
                  value={selectedPolicyVersionId}
                  policyVersions={policyVersions}
                  disabled={isExecuting}
                  onChange={setSelectedPolicyVersionId}
                />
                <div className="extraction-trigger-actions">
                  <button
                    type="submit"
                    className="extraction-trigger-submit extraction-trigger-submit-notion"
                    disabled={
                      isExecuting ||
                      rowCount === 0 ||
                      selectedPolicyVersionId.length === 0 ||
                      compiledRuleSetStatus === "loading" ||
                      ruleTestRunGateStatus === "loading" ||
                      isRuleTestGateClosed
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
                      <StatusPill
                        label={`${run.summary.needs_review_count} needs review`}
                        variant={
                          run.summary.needs_review_count > 0 ? "warning" : "neutral"
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
