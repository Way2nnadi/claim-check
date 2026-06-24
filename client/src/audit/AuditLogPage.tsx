import type { AuditEvent, AuditEventFilters } from "./types";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchAuditEvents } from "./api";

import EntityTypeFilterPicker from "./EntityTypeFilterPicker";
import { shortenId } from "../shared/format/common";
import {
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
	complianceEvaluationRunId: string;
	employeeId: string;
	expenseDate: string;
	rowIndex: string;
}

function createEmptyDraft(): AuditFilterDraft {
	return {
		entityType: "",
		entityId: "",
		complianceEvaluationRunId: "",
		employeeId: "",
		expenseDate: "",
		rowIndex: "",
	};
}

function normalizeFilters(draft: AuditFilterDraft): AuditEventFilters {
	const entityType = draft.entityType.trim();
	const entityId = draft.entityId.trim();
	const complianceEvaluationRunId = draft.complianceEvaluationRunId.trim();
	const employeeId = draft.employeeId.trim();
	const expenseDate = draft.expenseDate.trim();
	const rowIndexRaw = draft.rowIndex.trim();
	const parsedRowIndex =
		rowIndexRaw === "" ? undefined : Number.parseInt(rowIndexRaw, 10);

	return {
		entityType: entityType || undefined,
		entityId: entityId || undefined,
		complianceEvaluationRunId: complianceEvaluationRunId || undefined,
		employeeId: employeeId || undefined,
		expenseDate: expenseDate || undefined,
		rowIndex:
			parsedRowIndex !== undefined &&
			Number.isInteger(parsedRowIndex) &&
			parsedRowIndex >= 0
				? parsedRowIndex
				: undefined,
	};
}

export default function AuditLogPage() {
	const [status, setStatus] = useState<AuditStatus>("loading");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [events, setEvents] = useState<AuditEvent[]>([]);
	const [filterDraft, setFilterDraft] =
		useState<AuditFilterDraft>(createEmptyDraft);
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
	const filtersApplied = Boolean(
		appliedFilters.entityType ||
			appliedFilters.entityId ||
			appliedFilters.complianceEvaluationRunId ||
			appliedFilters.employeeId ||
			appliedFilters.expenseDate ||
			appliedFilters.rowIndex !== undefined,
	);
	const activeFilterCount =
		Number(Boolean(appliedFilters.entityType)) +
		Number(Boolean(appliedFilters.entityId)) +
		Number(Boolean(appliedFilters.complianceEvaluationRunId)) +
		Number(Boolean(appliedFilters.employeeId)) +
		Number(Boolean(appliedFilters.expenseDate)) +
		Number(Boolean(appliedFilters.rowIndex !== undefined));
	const showRowIdentityFilters =
		filterDraft.entityType === "compliance_review" ||
		appliedFilters.entityType === "compliance_review" ||
		Boolean(
			filterDraft.complianceEvaluationRunId ||
				filterDraft.employeeId ||
				filterDraft.expenseDate ||
				filterDraft.rowIndex ||
				appliedFilters.complianceEvaluationRunId ||
				appliedFilters.employeeId ||
				appliedFilters.expenseDate ||
				appliedFilters.rowIndex !== undefined,
		);

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
			<section className="db-properties" aria-label="Audit overview">
				<article className="db-property">
					<span className="db-property-label">Events</span>
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
					<span className="db-property-label">Entity types</span>
					<span className="db-property-value">
						{status === "loading" ? "…" : uniqueEntityTypeCount}
					</span>
				</article>
			</section>

			<details className="review-scope-panel notion-scope-panel audit-filter-panel">
				<summary>
					Scope filters
					{activeFilterCount > 0 ? (
						<span className="review-scope-panel-badge">
							{activeFilterCount} active
						</span>
					) : null}
				</summary>
				<form
					className="review-scope-form audit-filter"
					onSubmit={handleFilterSubmit}
				>
					<div className="review-filter-grid audit-filter-grid">
						<EntityTypeFilterPicker
							value={filterDraft.entityType}
							onChange={(entityType) =>
								setFilterDraft((current) => ({
									...current,
									entityType,
								}))
							}
						/>

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
								placeholder="rule-123 or cer-abc:0"
							/>
						</label>

						{showRowIdentityFilters ? (
							<>
								<label htmlFor="audit-compliance-evaluation-run-id">
									Evaluation run id
									<input
										id="audit-compliance-evaluation-run-id"
										name="audit-compliance-evaluation-run-id"
										type="text"
										value={filterDraft.complianceEvaluationRunId}
										onChange={(event) =>
											setFilterDraft((current) => ({
												...current,
												complianceEvaluationRunId: event.target.value,
											}))
										}
										placeholder="cer-abc123"
									/>
								</label>

								<label htmlFor="audit-employee-id">
									Employee id
									<input
										id="audit-employee-id"
										name="audit-employee-id"
										type="text"
										value={filterDraft.employeeId}
										onChange={(event) =>
											setFilterDraft((current) => ({
												...current,
												employeeId: event.target.value,
											}))
										}
										placeholder="emp-001"
									/>
								</label>

								<label htmlFor="audit-expense-date">
									Expense date
									<input
										id="audit-expense-date"
										name="audit-expense-date"
										type="date"
										value={filterDraft.expenseDate}
										onChange={(event) =>
											setFilterDraft((current) => ({
												...current,
												expenseDate: event.target.value,
											}))
										}
									/>
								</label>

								<label htmlFor="audit-row-index">
									Row index
									<input
										id="audit-row-index"
										name="audit-row-index"
										type="number"
										min={0}
										step={1}
										value={filterDraft.rowIndex}
										onChange={(event) =>
											setFilterDraft((current) => ({
												...current,
												rowIndex: event.target.value,
											}))
										}
										placeholder="0"
									/>
								</label>
							</>
						) : null}
					</div>

					<div className="review-filter-actions">
						<button
							type="submit"
							className="document-command document-command-accent"
						>
							Apply scope
						</button>
						<button
							type="button"
							className="document-command"
							disabled={
								!filtersApplied &&
								!filterDraft.entityType &&
								!filterDraft.entityId &&
								!filterDraft.complianceEvaluationRunId &&
								!filterDraft.employeeId &&
								!filterDraft.expenseDate &&
								!filterDraft.rowIndex
							}
							onClick={handleClearFilters}
						>
							Clear scope
						</button>
						<p className="audit-filter-active">
							{filtersApplied
								? `Scoped to ${formatAuditEntityType(
										appliedFilters.entityType ?? "entity",
									)}${appliedFilters.entityId ? ` · ${appliedFilters.entityId}` : ""}`
								: "All events"}
						</p>
					</div>
				</form>
			</details>

			<section className="catalog-stage">
				{status === "loading" ? (
					<p className="catalog-status">
						<span className="catalog-status-rule" aria-hidden="true" />
						Loading…
					</p>
				) : null}

				{status === "error" ? (
					<div className="review-empty" role="alert">
						<h4>Unable to load audit events</h4>
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
					<div className="db-table-wrap">
						<table
							className="db-table audit-events-table"
							aria-label="Audit events"
						>
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
									<tr
										key={`${event.occurred_at}-${event.action}-${event.entity_id}`}
									>
										<td>
											<time dateTime={event.occurred_at}>
												{formatAuditTimestamp(event.occurred_at)}
											</time>
										</td>
										<td>
											<span className="db-primary">{event.actor_subject}</span>
											<span className="db-secondary">
												{event.actor_roles.join(" · ")}
											</span>
										</td>
										<td>
											<span className="db-primary">
												{formatAuditAction(event.action)}
											</span>
											<span className="db-secondary db-mono">
												{event.action}
											</span>
										</td>
										<td>
											<span className="db-primary">
												{formatAuditEntityType(event.entity_type)}
											</span>
											<span
												className="db-secondary db-mono"
												title={event.entity_id}
											>
												{shortenId(event.entity_id)}
											</span>
										</td>
										<td>{summarizeAuditPayload(event)}</td>
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
