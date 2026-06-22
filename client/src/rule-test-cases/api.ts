import type {
  EvaluationOutcome,
  RuleTestCase,
  RuleTestCaseDisableRequest,
  RuleTestCaseEnableRequest,
  RuleTestCaseGenerateResponse,
  RuleTestCaseListResponse,
  RuleTestCaseStatus,
  RuleTestCaseVariant,
  RuleTestRun,
  RuleTestRunListResponse,
} from "./types";
import { apiRequest, downloadAttachment } from "../shared/api/client";

export function fetchRuleTestCases(
  compiledRuleSetId: string,
  status?: RuleTestCaseStatus,
): Promise<RuleTestCaseListResponse> {
  const params = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiRequest<RuleTestCaseListResponse>(
    `/api/compiled-rule-sets/${encodeURIComponent(compiledRuleSetId)}/rule-test-cases${params}`,
  );
}

export function disableRuleTestCase(
  ruleTestCaseId: string,
  request: RuleTestCaseDisableRequest,
): Promise<RuleTestCase> {
  return apiRequest<RuleTestCase>(
    `/api/rule-test-cases/${encodeURIComponent(ruleTestCaseId)}/disable`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}

export function enableRuleTestCase(
  ruleTestCaseId: string,
  request: RuleTestCaseEnableRequest,
): Promise<RuleTestCase> {
  return apiRequest<RuleTestCase>(
    `/api/rule-test-cases/${encodeURIComponent(ruleTestCaseId)}/enable`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}

export function generateRuleTestCases(
  compiledRuleSetId: string,
): Promise<RuleTestCaseGenerateResponse> {
  return apiRequest<RuleTestCaseGenerateResponse>(
    `/api/compiled-rule-sets/${encodeURIComponent(compiledRuleSetId)}/rule-test-cases/generate`,
    { method: "POST" },
  );
}

export function executeRuleTestRun(compiledRuleSetId: string): Promise<RuleTestRun> {
  return apiRequest<RuleTestRun>(
    `/api/compiled-rule-sets/${encodeURIComponent(compiledRuleSetId)}/rule-test-runs`,
    { method: "POST" },
  );
}

export function fetchRuleTestRuns(
  compiledRuleSetId: string,
): Promise<RuleTestRunListResponse> {
  return apiRequest<RuleTestRunListResponse>(
    `/api/compiled-rule-sets/${encodeURIComponent(compiledRuleSetId)}/rule-test-runs`,
  );
}

export function fetchRuleTestRun(ruleTestRunId: string): Promise<RuleTestRun> {
  return apiRequest<RuleTestRun>(
    `/api/rule-test-runs/${encodeURIComponent(ruleTestRunId)}`,
  );
}

function buildRuleTestRunReportFilename(ruleTestRunId: string): string {
  const safeStem = ruleTestRunId
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
  return `${safeStem || "rule-test-run"}.json`;
}

export async function downloadRuleTestRunReport(ruleTestRunId: string): Promise<void> {
  await downloadAttachment(
    `/api/rule-test-runs/${encodeURIComponent(ruleTestRunId)}/report`,
    buildRuleTestRunReportFilename(ruleTestRunId),
  );
}

export type {
  EvaluationOutcome,
  RuleTestCase,
  RuleTestCaseDisableRequest,
  RuleTestCaseEnableRequest,
  RuleTestCaseGenerateResponse,
  RuleTestCaseGroup,
  RuleTestCaseListResponse,
  RuleTestCaseStatus,
  RuleTestCaseVariant,
  RuleTestRun,
  RuleTestRunCaseResult,
  RuleTestRunListResponse,
  RuleTestRunSummary,
} from "./types";
