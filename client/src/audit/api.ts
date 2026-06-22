import type { AuditEventFilters, AuditEventListResponse } from "./types";
import { apiRequest } from "../shared/api/client";

function buildAuditEventQuery(filters: AuditEventFilters = {}): string {
  const params = new URLSearchParams();
  const entityType = filters.entityType?.trim();
  const entityId = filters.entityId?.trim();

  if (entityType) {
    params.set("entity_type", entityType);
  }
  if (entityId) {
    params.set("entity_id", entityId);
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
