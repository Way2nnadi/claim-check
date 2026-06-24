import type { AuditEventFilters, AuditEventListResponse } from "./types";
import { apiRequest } from "../shared/api/client";

function buildAuditEventQuery(filters: AuditEventFilters = {}): string {
  const params = new URLSearchParams();
  const entityType = filters.entityType?.trim();
  const entityId = filters.entityId?.trim();
  const complianceEvaluationRunId = filters.complianceEvaluationRunId?.trim();
  const employeeId = filters.employeeId?.trim();
  const expenseDate = filters.expenseDate?.trim();
  const rowIndex = filters.rowIndex;

  if (entityType) {
    params.set("entity_type", entityType);
  }
  if (entityId) {
    params.set("entity_id", entityId);
  }
  if (complianceEvaluationRunId) {
    params.set("compliance_evaluation_run_id", complianceEvaluationRunId);
  }
  if (employeeId) {
    params.set("employee_id", employeeId);
  }
  if (expenseDate) {
    params.set("expense_date", expenseDate);
  }
  if (rowIndex !== undefined && Number.isInteger(rowIndex) && rowIndex >= 0) {
    params.set("row_index", String(rowIndex));
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function fetchAuditEvents(
  filters: AuditEventFilters = {},
): Promise<AuditEventListResponse> {
  return apiRequest<AuditEventListResponse>(
    `/api/audit-events${buildAuditEventQuery(filters)}`,
  );
}
