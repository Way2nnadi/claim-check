import { useMemo } from "react";
import {
  describeRuleTestRunGate,
  resolveRuleTestRunGateStatus,
} from "../compliance-evaluation-runs/format";
import StatusPill from "../shared/ui/StatusPill";
import { shortenId } from "../shared/format/common";
import { formatRelativeTime } from "../shared/format/relativeTime";
import {
  casePassFailTone,
  evaluationOutcomeTone,
  formatCasePassFail,
  formatEvaluationOutcome,
  formatRuleTestCaseVariant,
  ruleTestCaseVariantTone,
  summarizeRuleTestCaseCoverage,
  summarizeRuleTestRun,
} from "./format";
import {
  buildRuleReadinessRows,
  formatRuleRunReadinessStatus,
  getFailedRuleTestRunResults,
  ruleRunReadinessTone,
  summarizeRuleCaseCounts,
} from "./readiness";
import type { RuleTestCaseGroup, RuleTestRun } from "./types";

export interface RuleTestCoverageReadinessViewProps {
  activeCaseCount: number;
  groups: RuleTestCaseGroup[];
  latestRuleTestRun: RuleTestRun | null;
  ruleTestRunStatus: "idle" | "loading" | "ready" | "error";
  isDownloadingReport: boolean;
  onDownloadReport: () => void;
}

function RuleTestId({ value, visible = 10 }: { value: string; visible?: number }) {
  return (
    <code className="rule-test-id" title={value}>
      {shortenId(value, visible)}
    </code>
  );
}

export default function RuleTestCoverageReadinessView({
  activeCaseCount,
  groups,
  latestRuleTestRun,
  ruleTestRunStatus,
  isDownloadingReport,
  onDownloadReport,
}: RuleTestCoverageReadinessViewProps) {
  const readinessRows = useMemo(
    () => buildRuleReadinessRows(groups, latestRuleTestRun),
    [groups, latestRuleTestRun],
  );
  const failedResults = useMemo(
    () => getFailedRuleTestRunResults(latestRuleTestRun),
    [latestRuleTestRun],
  );
  const statementByRuleId = useMemo(
    () => new Map(groups.map((group) => [group.rule_id, group.statement])),
    [groups],
  );
  const gateStatus = resolveRuleTestRunGateStatus({
    enforceableRuleCount: activeCaseCount,
    latestRun: latestRuleTestRun,
    status: ruleTestRunStatus,
  });
  const gate = describeRuleTestRunGate({
    gateStatus,
    latestRun: latestRuleTestRun,
    hasCompiledRuleSet: true,
  });
  const isGateClosed = gateStatus === "missing_run" || gateStatus === "failed_run";

  return (
    <section className="rule-test-readiness" aria-label="Rule Test Coverage readiness">
      <div className="rule-test-readiness-header">
        <div>
          <h4 className="record-section-heading">Coverage readiness</h4>
          <p className="review-ledger-scope">
            Per-rule variant coverage, case status, and latest run evidence before expense
            evaluation.
          </p>
        </div>
        {latestRuleTestRun !== null ? (
          <button
            type="button"
            className="document-command compact"
            onClick={onDownloadReport}
            disabled={isDownloadingReport}
          >
            {isDownloadingReport ? "Downloading…" : "Download evidence"}
          </button>
        ) : null}
      </div>

      <div
        className={`compliance-evaluation-gate notion-callout rule-test-readiness-gate${
          isGateClosed ? " error" : ""
        }`}
        role="status"
      >
        <p className="compliance-evaluation-gate-title">{gate.title}</p>
        <p className="review-ledger-scope">{gate.detail}</p>
        {latestRuleTestRun !== null ? (
          <p className="rule-test-readiness-run-meta">
            {summarizeRuleTestRun(latestRuleTestRun.summary)} ·{" "}
            {latestRuleTestRun.executed_by} ·{" "}
            {formatRelativeTime(latestRuleTestRun.executed_at)}
          </p>
        ) : null}
      </div>

      <div className="db-table-wrap rule-test-table-wrap">
        <table className="db-table" aria-label="Rule Test Coverage by rule">
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Coverage</th>
              <th scope="col">Cases</th>
              <th scope="col">Latest run</th>
            </tr>
          </thead>
          <tbody>
            {readinessRows.map((row) => (
              <tr key={row.rule_id}>
                <td className="rule-test-readiness-rule-cell">
                  <RuleTestId value={row.rule_id} visible={14} />
                  <p className="rule-test-readiness-statement">{row.statement}</p>
                </td>
                <td className="rule-test-readiness-coverage">
                  {summarizeRuleTestCaseCoverage(
                    row.positive_count,
                    row.negative_count,
                    row.boundary_count,
                    row.exception_count,
                  )}
                </td>
                <td className="rule-test-readiness-cases">
                  {summarizeRuleCaseCounts(
                    row.active_count,
                    row.disabled_count,
                    row.edited_count,
                  )}
                </td>
                <td>
                  <StatusPill
                    label={formatRuleRunReadinessStatus(row.run_status)}
                    variant={ruleRunReadinessTone(row.run_status)}
                  />
                  {row.run_status === "failed" ? (
                    <span className="rule-test-readiness-run-detail">
                      {row.failed_count} failed · {row.passed_count} passed
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {failedResults.length > 0 ? (
        <div className="rule-test-readiness-failures">
          <h5 className="rule-test-readiness-failures-title">
            Failed cases — expected vs actual
          </h5>
          <div className="db-table-wrap rule-test-table-wrap">
            <table className="db-table" aria-label="Failed Rule Test Run results">
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">Variant</th>
                  <th scope="col">Expected</th>
                  <th scope="col">Actual</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {failedResults.map((result) => (
                  <tr key={result.rule_test_case_id} className="rule-test-readiness-failure-row">
                    <td className="rule-test-run-rule-cell">
                      {statementByRuleId.get(result.rule_id) ?? (
                        <RuleTestId value={result.rule_id} />
                      )}
                    </td>
                    <td>
                      <StatusPill
                        label={formatRuleTestCaseVariant(result.variant)}
                        variant={ruleTestCaseVariantTone(result.variant)}
                      />
                    </td>
                    <td>
                      <StatusPill
                        label={formatEvaluationOutcome(result.expected_outcome)}
                        variant={evaluationOutcomeTone(result.expected_outcome)}
                      />
                    </td>
                    <td>
                      <StatusPill
                        label={formatEvaluationOutcome(result.actual_outcome)}
                        variant={evaluationOutcomeTone(result.actual_outcome)}
                      />
                    </td>
                    <td>
                      <StatusPill
                        label={formatCasePassFail(result.passed)}
                        variant={casePassFailTone(result.passed)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
