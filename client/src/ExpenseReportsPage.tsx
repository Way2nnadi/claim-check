import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiError, fetchExpenseReport, fetchExpenseReports, importExpenseReportCsv } from "./api";
import { hasAnyRole } from "./shared/permissions";
import type { AuthenticatedPrincipal } from "./shared/auth/types";
import type { ExpenseReport, ExpenseReportImportErrorResponse, ExpenseReportRow, ExpenseReportSummary } from "./types";
import Breadcrumbs from "./shared/ui/Breadcrumbs";
import RecordPageHeader, {
	type RecordPropertyGroup,
} from "./shared/ui/RecordPageHeader";
import StatusPill from "./shared/ui/StatusPill";
import { ExpenseReportPageIcon, RecordPageIcon } from "./shared/ui/PageIcons";
import { ComplianceEvaluationSection } from "./compliance-evaluation-runs";
import { formatExpenseRowValue } from "./compliance-review/format";
import { formatDateTime } from "./shared/format/common";
import { formatRelativeTime } from "./shared/format/relativeTime";
import TablePagination, {
  paginateItems,
  TABLE_PAGE_SIZE,
} from "./shared/ui/TablePagination";

const REQUIRED_CSV_COLUMNS = [
	"employee_id",
	"expense_date",
	"expense_category",
	"amount",
	"currency",
] as const;

const OPTIONAL_CSV_COLUMNS = [
	"country",
	"travel_type",
	"business_purpose",
	"attendee_list",
	"manager_approval",
	"receipt_attached",
	"trip_id",
	"submission_days",
] as const;

const DEFERRED_SCOPE_DIMENSIONS = [
	"employee_group",
	"department",
	"role",
	"seniority",
	"state",
	"city",
	"region",
] as const;

const EXPENSE_ROW_TABLE_COLUMNS: {
	key: keyof ExpenseReportRow;
	label: string;
}[] = [
	{ key: "employee_id", label: "Employee" },
	{ key: "expense_date", label: "Date" },
	{ key: "expense_category", label: "Category" },
	{ key: "amount", label: "Amount" },
	{ key: "currency", label: "Currency" },
	{ key: "country", label: "Country" },
	{ key: "travel_type", label: "Travel type" },
	{ key: "business_purpose", label: "Business purpose" },
	{ key: "attendee_list", label: "Attendees" },
	{ key: "manager_approval", label: "Manager approval" },
	{ key: "receipt_attached", label: "Receipt attached" },
	{ key: "trip_id", label: "Trip ID" },
	{ key: "submission_days", label: "Submission days" },
];

interface ExpenseReportsPageProps {
	principal: AuthenticatedPrincipal;
	onOpenEvaluationRun?: (complianceEvaluationRunId: string) => void;
	onOpenCompiledRuleSet?: (compiledRuleSetId: string) => void;
}

const ADMIN_ONLY_ROLES = ["admin"] as const;

function emptyImportErrors(): ExpenseReportImportErrorResponse {
	return {
		detail: "Expense Report import rejected.",
		file_errors: [],
		row_errors: [],
	};
}

function coerceImportErrors(
	error: unknown,
): ExpenseReportImportErrorResponse | null {
	if (
		!(error instanceof ApiError) ||
		typeof error.payload !== "object" ||
		error.payload === null
	) {
		return null;
	}

	const payload = error.payload as Partial<ExpenseReportImportErrorResponse>;
	if (
		!Array.isArray(payload.file_errors) ||
		!Array.isArray(payload.row_errors)
	) {
		return null;
	}

	return {
		detail:
			typeof payload.detail === "string"
				? payload.detail
				: "Expense Report import rejected.",
		file_errors: payload.file_errors.filter(
			(item): item is string => typeof item === "string",
		),
		row_errors: payload.row_errors
			.filter(
				(
					item,
				): item is ExpenseReportImportErrorResponse["row_errors"][number] =>
					typeof item === "object" &&
					item !== null &&
					typeof item.row_number === "number" &&
					Array.isArray(item.errors),
			)
			.map((item) => ({
				row_number: item.row_number,
				errors: item.errors.filter(
					(message): message is string => typeof message === "string",
				),
			})),
	};
}

function formatRowCount(count: number): string {
	return `${count} ${count === 1 ? "row" : "rows"}`;
}

interface ExpenseReportDetailProps {
	report: ExpenseReport;
	principal: AuthenticatedPrincipal;
	onBack: () => void;
	onOpenEvaluationRun?: (complianceEvaluationRunId: string) => void;
	onOpenCompiledRuleSet?: (compiledRuleSetId: string) => void;
}

function ExpenseReportDetailLoading({ onBack }: { onBack: () => void }) {
	return (
		<div className="expense-report-detail content-enter">
			<Breadcrumbs
				items={[
					{
						label: "Expense Reports",
						icon: <ExpenseReportPageIcon size={14} />,
						onClick: onBack,
					},
				]}
			/>
			<p className="catalog-status">Loading expense report…</p>
		</div>
	);
}

function ExpenseReportDetailError({
	message,
	onBack,
}: {
	message: string;
	onBack: () => void;
}) {
	return (
		<div className="expense-report-detail content-enter">
			<Breadcrumbs
				items={[
					{
						label: "Expense Reports",
						icon: <ExpenseReportPageIcon size={14} />,
						onClick: onBack,
					},
				]}
			/>
			<p className="error-banner">{message}</p>
		</div>
	);
}

function ExpenseReportDetail({
	report,
	principal,
	onBack,
	onOpenEvaluationRun,
	onOpenCompiledRuleSet,
}: ExpenseReportDetailProps) {
	const [rowsPage, setRowsPage] = useState(1);

	useEffect(() => {
		setRowsPage(1);
	}, [report.expense_report_id]);

	const paginatedRows = useMemo(
		() => paginateItems(report.rows, rowsPage, TABLE_PAGE_SIZE),
		[report.rows, rowsPage],
	);

	const propertyGroups: RecordPropertyGroup[] = [
		{
			title: "Import",
			properties: [
				{ label: "Source file", value: report.source_filename },
				{ label: "Rows", value: formatRowCount(report.row_count) },
				{ label: "Imported by", value: report.imported_by },
				{
					label: "Status",
					value: <StatusPill label="Immutable" variant="neutral" />,
				},
			],
		},
		...(report.input_fingerprint
			? [
					{
						title: "Input fingerprint",
						properties: [
							{
								label: "Content hash",
								value: (
									<code className="db-mono">{report.input_fingerprint.content_hash}</code>
								),
							},
							{
								label: "Pinned rows",
								value: String(report.input_fingerprint.row_count),
							},
						],
					},
				]
			: []),
		{
			title: "Report",
			properties: [
				{
					label: "Report ID",
					value: <code className="db-mono">{report.expense_report_id}</code>,
				},
				{
					label: "Imported at",
					value: formatDateTime(report.created_at),
				},
			],
		},
	];

	return (
		<div className="expense-report-detail content-enter">
			<RecordPageHeader
				breadcrumbs={
					<Breadcrumbs
						items={[
							{
								label: "Expense Reports",
								icon: <ExpenseReportPageIcon size={14} />,
								onClick: onBack,
							},
							{
								label: report.expense_report_id,
								icon: <ExpenseReportPageIcon size={14} />,
							},
						]}
					/>
				}
				icon={<RecordPageIcon icon={<ExpenseReportPageIcon size={22} />} />}
				title={report.expense_report_id}
				subtitle={report.source_filename}
				recordId={report.expense_report_id}
				lastUpdated={report.created_at}
				propertyGroups={propertyGroups}
				propertyLayout="stacked"
			/>

			<h4 className="record-section-heading">Expense rows</h4>
			<p className="expense-report-table-note">
				Imported reports are immutable — upload a new CSV to change inputs. Optional
				fields normalize to null when blank. Compliance Evaluation Runs pin the
				content hash shown above.
			</p>
			<div className="db-table-wrap expense-report-rows-wrap">
				<table
					id="expense-report-rows-panel"
					className="db-table expense-report-rows-table"
					aria-label="Expense rows"
					aria-describedby={
						paginatedRows.totalCount > TABLE_PAGE_SIZE
							? "expense-report-rows-pagination-range"
							: undefined
					}
				>
					<thead>
						<tr>
							{EXPENSE_ROW_TABLE_COLUMNS.map((column) => (
								<th key={column.key} scope="col">
									{column.label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{paginatedRows.items.map((row, index) => {
							const rowIndex = paginatedRows.startIndex + index;
							return (
								<tr
									key={`${report.expense_report_id}:${row.employee_id}:${rowIndex}`}
								>
									{EXPENSE_ROW_TABLE_COLUMNS.map((column) => (
										<td
											key={column.key}
											className={
												column.key === "employee_id" || column.key === "trip_id"
													? "db-mono"
													: undefined
											}
										>
											{formatExpenseRowValue(row[column.key])}
										</td>
									))}
								</tr>
							);
						})}
					</tbody>
				</table>
				<TablePagination
					page={paginatedRows.page}
					pageSize={TABLE_PAGE_SIZE}
					totalCount={paginatedRows.totalCount}
					onPageChange={setRowsPage}
					idPrefix="expense-report-rows-pagination"
				/>
			</div>

			<ComplianceEvaluationSection
				expenseReportId={report.expense_report_id}
				rowCount={report.row_count}
				principal={principal}
				onOpenRun={onOpenEvaluationRun}
				onOpenCompiledRuleSet={onOpenCompiledRuleSet}
			/>
		</div>
	);
}

export default function ExpenseReportsPage({
	principal,
	onOpenEvaluationRun,
	onOpenCompiledRuleSet,
}: ExpenseReportsPageProps) {
	const [reports, setReports] = useState<ExpenseReportSummary[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
	const [selectedReport, setSelectedReport] = useState<ExpenseReport | null>(null);
	const [detailStatus, setDetailStatus] = useState<
		"idle" | "loading" | "ready" | "error"
	>("idle");
	const [detailError, setDetailError] = useState<string | null>(null);
	const [importOpen, setImportOpen] = useState(false);
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [validationErrors, setValidationErrors] =
		useState<ExpenseReportImportErrorResponse | null>(null);

	const canImport = hasAnyRole(principal, ADMIN_ONLY_ROLES);

	useEffect(() => {
		if (!selectedReportId) {
			setSelectedReport(null);
			setDetailStatus("idle");
			setDetailError(null);
			return;
		}

		if (selectedReport?.expense_report_id === selectedReportId) {
			setDetailStatus("ready");
			setDetailError(null);
			return;
		}

		let cancelled = false;
		setDetailStatus("loading");
		setDetailError(null);
		setSelectedReport(null);

		void fetchExpenseReport(selectedReportId)
			.then((report) => {
				if (cancelled) {
					return;
				}
				setSelectedReport(report);
				setDetailStatus("ready");
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return;
				}
				setDetailError(
					error instanceof Error
						? error.message
						: "Failed to load Expense Report.",
				);
				setDetailStatus("error");
			});

		return () => {
			cancelled = true;
		};
	}, [selectedReportId, selectedReport?.expense_report_id]);

	useEffect(() => {
		let cancelled = false;
		setIsLoading(true);
		setLoadError(null);

		void fetchExpenseReports()
			.then((response) => {
				if (cancelled) {
					return;
				}
				setReports(response.items);
				setIsLoading(false);
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return;
				}
				setLoadError(
					error instanceof Error
						? error.message
						: "Failed to load Expense Reports.",
				);
				setIsLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (canImport && !isLoading && reports.length === 0) {
			setImportOpen(true);
		}
	}, [canImport, isLoading, reports.length]);

	async function handleSubmit(
		event: FormEvent<HTMLFormElement>,
	): Promise<void> {
		event.preventDefault();

		if (!canImport) {
			return;
		}
		if (!selectedFile) {
			setUploadError("Choose a CSV file before importing.");
			setValidationErrors(null);
			return;
		}

		setIsUploading(true);
		setUploadError(null);
		setValidationErrors(null);

		try {
			const report = await importExpenseReportCsv(selectedFile);
			const summary: ExpenseReportSummary = {
				expense_report_id: report.expense_report_id,
				imported_by: report.imported_by,
				source_filename: report.source_filename,
				row_count: report.row_count,
				created_at: report.created_at,
			};
			setReports((current) => [summary, ...current]);
			setSelectedReport(report);
			setDetailStatus("ready");
			setSelectedReportId(report.expense_report_id);
			setSelectedFile(null);
			setImportOpen(false);
			const input = document.getElementById(
				"expense-report-csv",
			) as HTMLInputElement | null;
			if (input) {
				input.value = "";
			}
		} catch (error: unknown) {
			const nextValidationErrors = coerceImportErrors(error);
			if (nextValidationErrors) {
				setValidationErrors(nextValidationErrors);
			} else {
				setUploadError(
					error instanceof Error ? error.message : "Import failed.",
				);
				setValidationErrors(emptyImportErrors());
			}
		} finally {
			setIsUploading(false);
		}
	}

	if (selectedReportId) {
		if (detailStatus === "loading" || detailStatus === "idle") {
			return (
				<ExpenseReportDetailLoading
					onBack={() => setSelectedReportId(null)}
				/>
			);
		}
		if (detailStatus === "error" || !selectedReport) {
			return (
				<ExpenseReportDetailError
					message={detailError ?? "Expense Report was not found."}
					onBack={() => setSelectedReportId(null)}
				/>
			);
		}
		return (
			<ExpenseReportDetail
				report={selectedReport}
				principal={principal}
				onBack={() => setSelectedReportId(null)}
				onOpenEvaluationRun={onOpenEvaluationRun}
				onOpenCompiledRuleSet={onOpenCompiledRuleSet}
			/>
		);
	}

	return (
		<div className="catalog-page expense-report-page content-enter">
			<header className="expense-report-intro">
				{!canImport ? (
					<p className="expense-report-permission-note notion-callout">
						View-only — admin role required to import.
					</p>
				) : null}
			</header>

			{canImport ? (
				<div className="catalog-toolbar">
					<p className="catalog-scope">
						{isLoading
							? "Loading reports…"
							: reports.length > 0
								? `${reports.length} report${reports.length === 1 ? "" : "s"} imported`
								: "No reports imported yet"}
					</p>
					<button
						type="button"
						className={`document-command${importOpen ? " active" : ""}`}
						aria-expanded={importOpen}
						onClick={() => setImportOpen((current) => !current)}
					>
						Import CSV
					</button>
				</div>
			) : null}

			{canImport && importOpen ? (
				<section
					className="expense-report-import reveal"
					aria-label="Import CSV"
				>
					<h4 className="record-section-heading">Import CSV</h4>
					<p className="expense-report-import-note">
						Choose a UTF-8 CSV with a header row. Import is all-or-nothing: fix
						file-level and row-level validation errors before anything is saved.
						Employee group and jurisdiction scope dimensions (department, role,
						seniority, state, city, region) are preserved on Rules but are not
						carried on Expense Report rows in v1 — evaluation routes those Rules
						to needs review when other scope dimensions match.
					</p>

					<div
						className="expense-report-column-guide"
						aria-label="CSV column guide"
					>
						<div>
							<span className="expense-report-column-label">
								Required columns
							</span>
							<p className="expense-report-column-list">
								{REQUIRED_CSV_COLUMNS.map((column) => (
									<code key={column}>{column}</code>
								))}
							</p>
						</div>
						<div>
							<span className="expense-report-column-label">
								Optional columns
							</span>
							<p className="expense-report-column-list">
								{OPTIONAL_CSV_COLUMNS.map((column) => (
									<code key={column}>{column}</code>
								))}
							</p>
						</div>
						<div>
							<span className="expense-report-column-label">
								Deferred scope dimensions
							</span>
							<p className="expense-report-column-list expense-report-deferred-note">
								{DEFERRED_SCOPE_DIMENSIONS.map((column) => (
									<code key={column}>{column}</code>
								))}
								<span>
									Not on CSV rows in v1 — carried on Rule scope and resolved via
									future HR or jurisdiction lookup.
								</span>
							</p>
						</div>
					</div>

					<form
						className="expense-report-import-form"
						onSubmit={(event) => void handleSubmit(event)}
					>
						<label
							className="expense-report-dropzone"
							htmlFor="expense-report-csv"
						>
							<input
								id="expense-report-csv"
								type="file"
								accept=".csv,text/csv"
								aria-label="Expense Report CSV"
								disabled={isUploading}
								onChange={(event) => {
									setSelectedFile(event.target.files?.[0] ?? null);
									setUploadError(null);
									setValidationErrors(null);
								}}
							/>
							<span className="expense-report-dropcopy">
								{selectedFile ? (
									<>
										<strong>{selectedFile.name}</strong>
										<span>{`${Math.max(1, Math.round(selectedFile.size / 1024))} KB · ready to import`}</span>
									</>
								) : (
									<>
										<strong>Choose CSV</strong>
										<span>Drop a file here or click to browse</span>
									</>
								)}
							</span>
						</label>

						<button
							type="submit"
							className="document-command document-command-accent"
							disabled={isUploading}
						>
							{isUploading ? "Importing…" : "Import report"}
						</button>
					</form>
				</section>
			) : null}

			{uploadError ? (
				<div className="notion-callout error" role="alert">
					<p className="expense-report-feedback-lede">Import failed</p>
					<p>{uploadError}</p>
				</div>
			) : null}

			{validationErrors && validationErrors.file_errors.length > 0 ? (
				<div
					className="notion-callout error"
					aria-label="File validation errors"
				>
					<p className="expense-report-feedback-lede">
						Fix these file issues and try again
					</p>
					<ul className="expense-report-error-list">
						{validationErrors.file_errors.map((message) => (
							<li key={message}>{message}</li>
						))}
					</ul>
				</div>
			) : null}

			{validationErrors && validationErrors.row_errors.length > 0 ? (
				<section
					className="expense-report-row-errors"
					aria-label="Row validation errors"
				>
					<h4 className="record-section-heading">Row validation errors</h4>
					<p className="expense-report-import-note">
						Correct the rows below in your CSV, then import again.
					</p>
					<div className="db-table-wrap">
						<table className="db-table" aria-label="Row validation errors">
							<thead>
								<tr>
									<th scope="col">Row</th>
									<th scope="col">Errors</th>
								</tr>
							</thead>
							<tbody>
								{validationErrors.row_errors.map((rowError) => (
									<tr key={rowError.row_number}>
										<td className="db-mono">{rowError.row_number}</td>
										<td>
											<ul className="expense-report-error-list">
												{rowError.errors.map((message) => (
													<li key={message}>{message}</li>
												))}
											</ul>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			) : null}

			{loadError ? <p className="error-banner">{loadError}</p> : null}

			{isLoading ? (
				<p className="catalog-status">Loading expense reports…</p>
			) : reports.length === 0 && !importOpen ? (
				<div className="notion-empty reveal">
					<h3>No reports yet</h3>
					<p>
						{canImport
							? "Import a CSV to create your first expense report."
							: "An administrator must import CSV files before reports appear here."}
					</p>
				</div>
			) : reports.length > 0 ? (
				<>
					<h4 className="record-section-heading">Imported reports</h4>
					<p className="expense-report-table-note">
						Open a report to review normalized rows, optional evaluator fields,
						and the pinned input fingerprint used by Compliance Evaluation Runs.
					</p>
					<div className="db-table-wrap">
						<table className="db-table" aria-label="Expense Reports">
							<thead>
								<tr>
									<th scope="col">Report</th>
									<th scope="col">Source file</th>
									<th scope="col">Rows</th>
									<th scope="col">Imported by</th>
									<th scope="col">Imported</th>
								</tr>
							</thead>
							<tbody>
								{reports.map((report) => (
									<tr key={report.expense_report_id}>
										<td>
											<button
												type="button"
												className="db-row-button"
												aria-label={`Open ${report.expense_report_id}`}
												onClick={() =>
													setSelectedReportId(report.expense_report_id)
												}
											>
												<span className="db-primary">
													{report.expense_report_id}
												</span>
											</button>
										</td>
										<td>{report.source_filename}</td>
										<td>{formatRowCount(report.row_count)}</td>
										<td>{report.imported_by}</td>
										<td title={new Date(report.created_at).toLocaleString()}>
											{formatRelativeTime(report.created_at)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			) : null}
		</div>
	);
}
