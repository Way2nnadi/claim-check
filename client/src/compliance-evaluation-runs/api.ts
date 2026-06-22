import { fetchExpenseReports } from "../api";
import { apiRequest, downloadAttachment } from "../shared/api/client";
import type {
  ComplianceEvaluationRun,
  ComplianceEvaluationRunListResponse,
  ComplianceEvaluationRunStartRequest,
} from "./types";

export function executeComplianceEvaluationRun(
  expenseReportId: string,
  request: ComplianceEvaluationRunStartRequest,
): Promise<ComplianceEvaluationRun> {
  return apiRequest<ComplianceEvaluationRun>(
    `/api/expense-reports/${encodeURIComponent(expenseReportId)}/compliance-evaluation-runs`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}

export function fetchComplianceEvaluationRuns(
  expenseReportId: string,
): Promise<ComplianceEvaluationRunListResponse> {
  return apiRequest<ComplianceEvaluationRunListResponse>(
    `/api/expense-reports/${encodeURIComponent(expenseReportId)}/compliance-evaluation-runs`,
  );
}

export function fetchComplianceEvaluationRun(
  complianceEvaluationRunId: string,
): Promise<ComplianceEvaluationRun> {
  return apiRequest<ComplianceEvaluationRun>(
    `/api/compliance-evaluation-runs/${encodeURIComponent(complianceEvaluationRunId)}`,
  );
}

function buildComplianceEvaluationRunReportFilename(
  complianceEvaluationRunId: string,
): string {
  const safeStem = complianceEvaluationRunId
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
  return `${safeStem || "compliance-evaluation-run"}.json`;
}

export async function downloadComplianceEvaluationRunReport(
  complianceEvaluationRunId: string,
): Promise<void> {
  await downloadAttachment(
    `/api/compliance-evaluation-runs/${encodeURIComponent(complianceEvaluationRunId)}/report`,
    buildComplianceEvaluationRunReportFilename(complianceEvaluationRunId),
  );
}

export async function fetchAllComplianceEvaluationRuns(): Promise<
  ComplianceEvaluationRun[]
> {
  const expenseReports = await fetchExpenseReports();
  const runLists = await Promise.all(
    expenseReports.items.map((report) =>
      fetchComplianceEvaluationRuns(report.expense_report_id),
    ),
  );
  return runLists
    .flatMap((response) => response.items)
    .sort(
      (left, right) =>
        new Date(right.executed_at).getTime() -
        new Date(left.executed_at).getTime(),
    );
}

export type {
  ComplianceEvaluationRun,
  ComplianceEvaluationRunListResponse,
  ComplianceEvaluationRunStartRequest,
  ComplianceEvaluationRowOutcome,
  ComplianceEvaluationRunSummary,
  ComplianceOutcome,
} from "./types";
