export interface AuditEvent {
  action: string;
  actor_subject: string;
  actor_roles: string[];
  entity_type: string;
  entity_id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface AuditEventListResponse {
  items: AuditEvent[];
}

export interface AuditEventFilters {
  entityType?: string;
  entityId?: string;
  complianceEvaluationRunId?: string;
  employeeId?: string;
  expenseDate?: string;
  rowIndex?: number;
}
