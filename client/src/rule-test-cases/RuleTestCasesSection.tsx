import { useMemo, useState } from "react";
import RuleTestCaseStatusModal, {
  type RuleTestCaseStatusAction,
} from "./RuleTestCaseStatusModal";
import {
  casePassFailTone,
  evaluationOutcomeTone,
  filterRuleTestCaseGroups,
  formatCasePassFail,
  formatEvaluationOutcome,
  formatFixtureDetail,
  formatRuleTestCaseStatus,
  formatRuleTestCaseVariant,
  ruleTestCaseStatusTone,
  ruleTestCaseVariantTone,
  summarizeRuleTestCaseCoverage,
  summarizeRuleTestRun,
  type RuleTestCaseStatusFilter,
} from "./format";
import type { RuleTestCase, RuleTestCaseGroup, RuleTestRun } from "./types";
import FilterTabs from "../shared/ui/FilterTabs";
import StatusPill from "../shared/ui/StatusPill";
import { shortenId } from "../shared/format/common";
import { formatRelativeTime } from "../shared/format/relativeTime";

export type { RuleTestCaseStatusFilter };

function RuleTestId({ value, visible = 10 }: { value: string; visible?: number }) {
  return (
    <code className="rule-test-id" title={value}>
      {shortenId(value, visible)}
    </code>
  );
}

function RuleTestRunCaseResultRow({
  result,
}: {
  result: RuleTestRun["case_results"][number];
}) {
  return (
    <tr>
      <td>
        <RuleTestId value={result.rule_id} visible={12} />
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
  );
}

function RuleTestCaseColGroup({
  showStatus,
  showActions,
}: {
  showStatus: boolean;
  showActions: boolean;
}) {
  return (
    <colgroup>
      {showStatus ? <col className="rule-test-col-status" /> : null}
      <col className="rule-test-col-variant" />
      <col className="rule-test-col-expected" />
      <col className="rule-test-col-category" />
      <col className="rule-test-col-fixture" />
      <col className="rule-test-col-notes" />
      {showActions ? <col className="rule-test-col-actions" /> : null}
    </colgroup>
  );
}

function RuleTestCaseLedger({
  groups,
  canDisable,
  showStatus,
  onDisable,
  onEnable,
}: {
  groups: RuleTestCaseGroup[];
  canDisable: boolean;
  showStatus: boolean;
  onDisable: (testCase: RuleTestCase) => void;
  onEnable: (testCase: RuleTestCase) => void;
}) {
  const columnCount = (showStatus ? 1 : 0) + 5 + (canDisable ? 1 : 0);

  return (
    <div className="db-table-wrap rule-test-table-wrap">
      <table className="db-table rule-test-case-ledger" aria-label="Rule Test Cases">
        <RuleTestCaseColGroup showStatus={showStatus} showActions={canDisable} />
        <thead>
          <tr>
            {showStatus ? <th scope="col">Status</th> : null}
            <th scope="col">Variant</th>
            <th scope="col">Expected</th>
            <th scope="col">Category</th>
            <th scope="col">Fixture</th>
            <th scope="col">Notes</th>
            {canDisable ? <th scope="col">Actions</th> : null}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.rule_id} className="rule-test-group-body">
            <tr className="rule-test-group-header">
              <td colSpan={columnCount}>
                <div className="rule-test-group-header-inner">
                  <div className="rule-test-group-header-top">
                    <span className="rule-test-rule-group-title">
                      <RuleTestId value={group.rule_id} visible={14} />
                    </span>
                    <span className="rule-test-rule-group-meta">
                      {summarizeRuleTestCaseCoverage(
                        group.positive_count,
                        group.negative_count,
                        group.boundary_count,
                        group.exception_count,
                      )}
                    </span>
                  </div>
                  <p className="rule-test-rule-group-statement">{group.statement}</p>
                </div>
              </td>
            </tr>
            {group.cases.map((testCase) => (
              <RuleTestCaseRow
                key={testCase.rule_test_case_id}
                testCase={testCase}
                canDisable={canDisable}
                showStatus={showStatus}
                onDisable={onDisable}
                onEnable={onEnable}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function RuleTestCaseRow({
  testCase,
  canDisable,
  showStatus,
  onDisable,
  onEnable,
}: {
  testCase: RuleTestCase;
  canDisable: boolean;
  showStatus: boolean;
  onDisable: (testCase: RuleTestCase) => void;
  onEnable: (testCase: RuleTestCase) => void;
}) {
  const isDisabled = testCase.status === "disabled";

  return (
    <tr className={isDisabled ? "rule-test-case-row-disabled" : undefined}>
      {showStatus ? (
        <td>
          <StatusPill
            label={formatRuleTestCaseStatus(testCase.status)}
            variant={ruleTestCaseStatusTone(testCase.status)}
          />
        </td>
      ) : null}
      <td>
        <StatusPill
          label={formatRuleTestCaseVariant(testCase.variant)}
          variant={ruleTestCaseVariantTone(testCase.variant)}
        />
      </td>
      <td>
        <StatusPill
          label={formatEvaluationOutcome(testCase.expected_outcome)}
          variant={evaluationOutcomeTone(testCase.expected_outcome)}
        />
      </td>
      <td>{testCase.expense_fixture.expense_category}</td>
      <td
        className="rule-test-fixture"
        title={formatFixtureDetail(testCase.expense_fixture)}
      >
        {formatFixtureDetail(testCase.expense_fixture)}
      </td>
      <td className="rule-test-row-notes">
        {isDisabled && testCase.disable_rationale ? (
          <span className="rule-test-rationale" title={testCase.disable_rationale}>
            {testCase.disable_rationale}
          </span>
        ) : (
          "—"
        )}
      </td>
      {canDisable ? (
        <td className="rule-test-row-actions">
          {!isDisabled ? (
            <button
              type="button"
              className="rule-test-inline-action"
              onClick={() => onDisable(testCase)}
            >
              Disable
            </button>
          ) : (
            <button
              type="button"
              className="rule-test-inline-action rule-test-inline-action-enable"
              onClick={() => onEnable(testCase)}
            >
              Enable
            </button>
          )}
        </td>
      ) : null}
    </tr>
  );
}

export interface RuleTestCasesSectionProps {
  canGenerate: boolean;
  canRun: boolean;
  canDisable: boolean;
  compiledCount: number;
  ruleTestCaseGroups: RuleTestCaseGroup[];
  ruleTestCaseTotal: number;
  ruleTestCaseActiveCount: number;
  ruleTestCaseDisabledCount: number;
  ruleTestCaseStatus: "idle" | "loading" | "ready" | "error";
  ruleTestCaseError: string | null;
  isGenerating: boolean;
  isRunning: boolean;
  isDownloadingReport: boolean;
  latestRuleTestRun: RuleTestRun | null;
  ruleTestRunStatus: "idle" | "loading" | "ready" | "error";
  ruleTestRunError: string | null;
  statusActionTarget: { testCase: RuleTestCase; mode: RuleTestCaseStatusAction } | null;
  statusActionRationale: string;
  statusActionError: string | null;
  isStatusActionSubmitting: boolean;
  onGenerate: () => void;
  onRun: () => void;
  onDownloadReport: () => void;
  onStatusActionRequest: (testCase: RuleTestCase, mode: RuleTestCaseStatusAction) => void;
  onStatusActionConfirm: () => void;
  onStatusActionCancel: () => void;
  onStatusActionRationaleChange: (value: string) => void;
}

export default function RuleTestCasesSection({
  canGenerate,
  canRun,
  canDisable,
  compiledCount,
  ruleTestCaseGroups,
  ruleTestCaseTotal,
  ruleTestCaseActiveCount,
  ruleTestCaseDisabledCount,
  ruleTestCaseStatus,
  ruleTestCaseError,
  isGenerating,
  isRunning,
  isDownloadingReport,
  latestRuleTestRun,
  ruleTestRunStatus,
  ruleTestRunError,
  statusActionTarget,
  statusActionRationale,
  statusActionError,
  isStatusActionSubmitting,
  onGenerate,
  onRun,
  onDownloadReport,
  onStatusActionRequest,
  onStatusActionConfirm,
  onStatusActionCancel,
  onStatusActionRationaleChange,
}: RuleTestCasesSectionProps) {
  const [statusFilter, setStatusFilter] = useState<RuleTestCaseStatusFilter>("all");
  const filteredGroups = useMemo(
    () => filterRuleTestCaseGroups(ruleTestCaseGroups, statusFilter),
    [ruleTestCaseGroups, statusFilter],
  );
  const showStatusColumn = statusFilter === "all" || ruleTestCaseDisabledCount > 0;
  const filterTabs = [
    { id: "all" as const, label: "All", count: ruleTestCaseTotal },
    { id: "active" as const, label: "Active", count: ruleTestCaseActiveCount },
    { id: "disabled" as const, label: "Disabled", count: ruleTestCaseDisabledCount },
  ];
  const visibleCaseCount = filteredGroups.reduce(
    (total, group) => total + group.cases.length,
    0,
  );
  const isInitialCaseLoad = ruleTestCaseStatus === "loading" && ruleTestCaseTotal === 0;

  return (
    <section className="rule-test-suite" aria-label="Rule Test Cases">
      <div className="rule-test-suite-header">
        <div className="rule-test-suite-intro">
          <h4 className="record-section-heading">Rule Test Cases</h4>
          {ruleTestCaseTotal > 0 ? (
            <p className="review-ledger-scope">
              {ruleTestCaseActiveCount} active
              {ruleTestCaseDisabledCount > 0
                ? ` · ${ruleTestCaseDisabledCount} disabled`
                : ""}
            </p>
          ) : (
            <p className="review-ledger-scope">
              Generated coverage for each compiled enforceable rule.
            </p>
          )}
        </div>
        <div className="rule-test-suite-actions">
          {canGenerate && ruleTestCaseTotal === 0 ? (
            <button
              type="button"
              className="document-command"
              onClick={onGenerate}
              disabled={isGenerating || compiledCount === 0}
            >
              {isGenerating ? "Generating…" : "Generate cases"}
            </button>
          ) : null}
          {canRun && ruleTestCaseActiveCount > 0 ? (
            <button
              type="button"
              className="extraction-trigger-submit extraction-trigger-submit-notion"
              onClick={onRun}
              disabled={isRunning}
            >
              {isRunning ? "Running…" : "Run test cases"}
            </button>
          ) : null}
        </div>
      </div>

      {ruleTestRunError ? <p className="error-banner">{ruleTestRunError}</p> : null}
      {ruleTestCaseError ? <p className="error-banner">{ruleTestCaseError}</p> : null}

      {isInitialCaseLoad ? (
        <p className="catalog-status">
          <span className="catalog-status-rule" aria-hidden="true" />
          Loading test cases…
        </p>
      ) : null}

      {ruleTestCaseStatus === "ready" && ruleTestCaseTotal === 0 ? (
        <div className="notion-empty reveal">
          <p>
            {compiledCount === 0
              ? "No enforceable rules were compiled, so no test cases can be generated."
              : canGenerate
                ? "Generate positive, negative, boundary, and exception cases for each compiled enforceable rule."
                : "An admin generates rule test cases for each compiled enforceable rule."}
          </p>
        </div>
      ) : null}

      {ruleTestCaseStatus === "ready" && ruleTestCaseTotal > 0 ? (
        <div className="extraction-ledger-wrap rule-test-ledger-wrap">
          <div className="review-ledger-head">
            <FilterTabs
              tabs={filterTabs}
              activeTabId={statusFilter}
              onTabChange={(tabId) => setStatusFilter(tabId as RuleTestCaseStatusFilter)}
              ariaLabel="Filter test cases by status"
              idPrefix="rule-test-status-tab"
              panelId="rule-test-case-panel"
            />
          </div>

          <div
            id="rule-test-case-panel"
            className="rule-test-case-panel"
            role="tabpanel"
            aria-labelledby={`rule-test-status-tab-${statusFilter}`}
          >
            {visibleCaseCount === 0 ? (
              <div className="extraction-empty compact reveal">
                <p>
                  {statusFilter === "disabled"
                    ? "No disabled test cases."
                    : "No active test cases in this view."}
                </p>
              </div>
            ) : (
              <RuleTestCaseLedger
                groups={filteredGroups}
                canDisable={canDisable}
                showStatus={showStatusColumn}
                onDisable={(testCase) => onStatusActionRequest(testCase, "disable")}
                onEnable={(testCase) => onStatusActionRequest(testCase, "enable")}
              />
            )}
          </div>
        </div>
      ) : null}

      {ruleTestRunStatus === "ready" && latestRuleTestRun !== null ? (
        <details className="rule-test-run-panel notion-collapsible" open>
          <summary className="rule-test-run-summary">
            <span className="rule-test-run-summary-title">Latest run</span>
            <span className="rule-test-run-summary-meta">
              {summarizeRuleTestRun(latestRuleTestRun.summary)} ·{" "}
              {latestRuleTestRun.executed_by} ·{" "}
              {formatRelativeTime(latestRuleTestRun.executed_at)}
            </span>
          </summary>
          <div className="rule-test-run-body">
            <div className="rule-test-run-toolbar">
              <p className="review-ledger-scope">
                Per-case results from the most recent execution.
              </p>
              <button
                type="button"
                className="document-command compact"
                onClick={onDownloadReport}
                disabled={isDownloadingReport}
              >
                {isDownloadingReport ? "Downloading…" : "Download JSON"}
              </button>
            </div>
            <div className="db-table-wrap rule-test-table-wrap">
              <table className="db-table" aria-label="Rule Test Run results">
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
                  {latestRuleTestRun.case_results.map((result) => (
                    <RuleTestRunCaseResultRow
                      key={result.rule_test_case_id}
                      result={result}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      ) : null}

      {statusActionTarget !== null ? (
        <RuleTestCaseStatusModal
          mode={statusActionTarget.mode}
          ruleTestCaseId={statusActionTarget.testCase.rule_test_case_id}
          isSubmitting={isStatusActionSubmitting}
          rationale={statusActionRationale}
          error={statusActionError}
          onRationaleChange={onStatusActionRationaleChange}
          onConfirm={onStatusActionConfirm}
          onCancel={onStatusActionCancel}
        />
      ) : null}
    </section>
  );
}
