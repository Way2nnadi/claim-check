import type { AuditEvent, AuditEventFilters } from "./types";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchAuditEvents } from "./api";

import {
  AUDIT_ENTITY_TYPE_OPTIONS,
  describeAuditError,
  formatAuditAction,
  formatAuditEntityType,
  formatAuditTimestamp,
  resolveAuditEmptyHint,
  resolveAuditEmptyMessage,
  summarizeAuditPayload,
} from "./format";

type AuditStatus = "loading" | "ready" | "error";

interface AuditFilterDraft {
  entityType: string;
  entityId: string;
}

function createEmptyDraft(): AuditFilterDraft {
  return {
    entityType: "",
    entityId: "",
  };
}

function normalizeFilters(draft: AuditFilterDraft): AuditEventFilters {
  const entityType = draft.entityType.trim();
  const entityId = draft.entityId.trim();

  return {
    entityType: entityType || undefined,
    entityId: entityId || undefined,
  };
}

export default function AuditLogPage() {
  const [status, setStatus] = useState<AuditStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [filterDraft, setFilterDraft] = useState<AuditFilterDraft>(createEmptyDraft);
  const [appliedFilters, setAppliedFilters] = useState<AuditEventFilters>({});

  useEffect(() => {
    let cancelled = false;

    async function loadAuditEvents(): Promise<void> {
      setStatus("loading");
      setErrorMessage(null);

      try {
        const response = await fetchAuditEvents(appliedFilters);
        if (cancelled) {
          return;
        }
        setEvents(response.items);
        setStatus("ready");
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        setEvents([]);
        setErrorMessage(describeAuditError(error));
        setStatus("error");
      }
    }

    void loadAuditEvents();

    return () => {
      cancelled = true;
    };
  }, [appliedFilters]);

  const uniqueActorCount = useMemo(
    () => new Set(events.map((event) => event.actor_subject)).size,
    [events],
  );
  const uniqueEntityTypeCount = useMemo(
    () => new Set(events.map((event) => event.entity_type)).size,
    [events],
  );
  const filtersApplied = Boolean(appliedFilters.entityType || appliedFilters.entityId);
  const activeFilterCount =
    Number(Boolean(appliedFilters.entityType)) + Number(Boolean(appliedFilters.entityId));

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setAppliedFilters(normalizeFilters(filterDraft));
  }

  function handleClearFilters(): void {
    setFilterDraft(createEmptyDraft());
    setAppliedFilters({});
  }

  return (
    <div className="catalog-page audit-page">
      <header className="catalog-head audit-head">
        <h3>Audit log</h3>
        <p className="audit-lede">
          Browse immutable system events.
        </p>
      </header>

      <section className="db-properties" aria-label="Audit overview">
        <article className="db-property">
          <span className="db-property-label">Events in scope</span>
          <span className="db-property-value">
            {status === "loading" ? "…" : events.length}
          </span>
        </article>
        <article className="db-property">
          <span className="db-property-label">Actors</span>
          <span className="db-property-value">
            {status === "loading" ? "…" : uniqueActorCount}
          </span>
        </article>
        <article className="db-property">
          <span className="db-property-label">Entity classes</span>
          <span className="db-property-value">
            {status === "loading" ? "…" : uniqueEntityTypeCount}
          </span>
        </article>
      </section>

      <details className="review-scope-panel audit-filter-panel">
        <summary>
          Code filters
          {activeFilterCount > 0 ? (
            <span className="review-scope-panel-badge">
              {activeFilterCount} active
            </span>
          ) : null}
        </summary>
        <form className="review-scope-form audit-filter" onSubmit={handleFilterSubmit}>
          <div className="review-filter-grid audit-filter-grid">
            <label htmlFor="audit-entity-type">
              Entity type
              <select
                id="audit-entity-type"
                name="audit-entity-type"
                value={filterDraft.entityType}
                onChange={(event) =>
                  setFilterDraft((current) => ({
                    ...current,
                    entityType: event.target.value,
                  }))
                }
              >
                {AUDIT_ENTITY_TYPE_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label htmlFor="audit-entity-id">
              Entity id
              <input
                id="audit-entity-id"
                name="audit-entity-id"
                type="text"
                value={filterDraft.entityId}
                onChange={(event) =>
                  setFilterDraft((current) => ({
                    ...current,
                    entityId: event.target.value,
                  }))
                }
                placeholder="rule-123 or policy-v3"
              />
            </label>
          </div>

          <div className="review-filter-actions">
            <button type="submit" className="review-filter-apply">
              Apply filters
            </button>
            <button
              type="button"
              className="review-filter-clear"
              disabled={!filtersApplied && !filterDraft.entityType && !filterDraft.entityId}
              onClick={handleClearFilters}
            >
              Clear filters
            </button>
            <p className="audit-filter-active">
              {filtersApplied
                ? `Scoped to ${formatAuditEntityType(
                    appliedFilters.entityType ?? "entity",
                  )}${appliedFilters.entityId ? ` · ${appliedFilters.entityId}` : ""}`
                : "Showing the full audit ledger."}
            </p>
          </div>
        </form>
      </details>

      <section className="catalog-stage">
        <div className="catalog-header">
          <p className="catalog-count">
            {status === "loading"
              ? "Synchronizing audit ledger…"
              : `${events.length} event${events.length === 1 ? "" : "s"} loaded`}
          </p>
        </div>

        {status === "error" ? (
          <div className="review-empty" role="alert">
            <h4>Audit ledger unavailable</h4>
            <p>{errorMessage}</p>
          </div>
        ) : null}

        {status === "ready" && events.length === 0 ? (
          <div className="review-empty">
            <h4>{resolveAuditEmptyMessage(appliedFilters)}</h4>
            <p className="review-empty-hint">
              {resolveAuditEmptyHint(appliedFilters)}
            </p>
          </div>
        ) : null}

        {events.length > 0 ? (
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th scope="col">Timestamp</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Entity</th>
                  <th scope="col">Payload summary</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={`${event.occurred_at}-${event.action}-${event.entity_id}`}>
                    <td>
                      <time
                        className="audit-timestamp"
                        dateTime={event.occurred_at}
                      >
                        {formatAuditTimestamp(event.occurred_at)}
                      </time>
                    </td>
                    <td>
                      <div className="audit-actor">
                        <span className="audit-actor-subject">
                          {event.actor_subject}
                        </span>
                        <span className="audit-actor-roles">
                          {event.actor_roles.join(" · ")}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="audit-action-cell">
                        <span className="audit-action-label">
                          {formatAuditAction(event.action)}
                        </span>
                        <code>{event.action}</code>
                      </div>
                    </td>
                    <td>
                      <div className="audit-entity-cell">
                        <span className="audit-entity-type">
                          {formatAuditEntityType(event.entity_type)}
                        </span>
                        <code>{event.entity_id}</code>
                      </div>
                    </td>
                    <td>
                      <p className="audit-payload-summary">
                        {summarizeAuditPayload(event)}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
