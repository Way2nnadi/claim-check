import { useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  fetchExpenseReports,
  importExpenseReportCsv,
} from "./api";
import { hasAnyRole } from "./permissions";
import type {
  AuthenticatedPrincipal,
  ExpenseReport,
  ExpenseReportImportErrorResponse,
} from "./types";

interface ExpenseReportsPageProps {
  principal: AuthenticatedPrincipal;
}

const ADMIN_ONLY_ROLES = ["admin"] as const;

function emptyImportErrors(): ExpenseReportImportErrorResponse {
  return {
    detail: "Expense Report import rejected.",
    file_errors: [],
    row_errors: [],
  };
}

function coerceImportErrors(error: unknown): ExpenseReportImportErrorResponse | null {
  if (!(error instanceof ApiError) || typeof error.payload !== "object" || error.payload === null) {
    return null;
  }

  const payload = error.payload as Partial<ExpenseReportImportErrorResponse>;
  if (!Array.isArray(payload.file_errors) || !Array.isArray(payload.row_errors)) {
    return null;
  }

  return {
    detail: typeof payload.detail === "string" ? payload.detail : "Expense Report import rejected.",
    file_errors: payload.file_errors.filter((item): item is string => typeof item === "string"),
    row_errors: payload.row_errors
      .filter(
        (item): item is ExpenseReportImportErrorResponse["row_errors"][number] =>
          typeof item === "object" &&
          item !== null &&
          typeof item.row_number === "number" &&
          Array.isArray(item.errors),
      )
      .map((item) => ({
        row_number: item.row_number,
        errors: item.errors.filter((message): message is string => typeof message === "string"),
      })),
  };
}

function formatImportTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function formatBoolean(value: boolean | null): string {
  if (value === null) {
    return "Not set";
  }
  return value ? "Yes" : "No";
}

export default function ExpenseReportsPage({ principal }: ExpenseReportsPageProps) {
  const [reports, setReports] = useState<ExpenseReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<ExpenseReportImportErrorResponse | null>(
    null,
  );

  const canImport = hasAnyRole(principal, ADMIN_ONLY_ROLES);

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
        setLoadError(error instanceof Error ? error.message : "Failed to load Expense Reports.");
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
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
      setReports((current) => [report, ...current]);
      setSelectedFile(null);
      const input = document.getElementById("expense-report-csv") as HTMLInputElement | null;
      if (input) {
        input.value = "";
      }
    } catch (error: unknown) {
      const nextValidationErrors = coerceImportErrors(error);
      if (nextValidationErrors) {
        setValidationErrors(nextValidationErrors);
      } else {
        setUploadError(error instanceof Error ? error.message : "Import failed.");
        setValidationErrors(emptyImportErrors());
      }
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="catalog-page expense-report-page">
      <section className="expense-report-intake">
        <div>
          <p className="eyebrow">Immutable Write Path</p>
          <h3>Import fixed-template employee expenses into an Expense Report.</h3>
          <p className="expense-report-copy">
            Validation is all-or-nothing. When any row fails, the API returns row-level errors and
            persists nothing.
          </p>
        </div>
        <form className="expense-report-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="review-field">
            <label htmlFor="expense-report-csv">Expense Report CSV</label>
            <input
              id="expense-report-csv"
              type="file"
              accept=".csv,text/csv"
              disabled={!canImport || isUploading}
              onChange={(event) => {
                setSelectedFile(event.target.files?.[0] ?? null);
                setUploadError(null);
                setValidationErrors(null);
              }}
            />
          </div>
          <div className="expense-report-actions">
            <button
              type="submit"
              disabled={!canImport || isUploading}
            >
              {isUploading ? "Importing..." : "Import Expense Report"}
            </button>
            {!canImport ? (
              <p className="expense-report-permission-note">
                <strong>{principal.roles.includes("viewer") ? "Viewer access" : "Approver access"}</strong>
                {" "}
                can browse imported Expense Reports but cannot import CSV batches.
              </p>
            ) : null}
          </div>
        </form>
      </section>

      {uploadError ? <p className="error-banner">{uploadError}</p> : null}
      {validationErrors && validationErrors.file_errors.length > 0 ? (
        <section className="expense-report-errors">
          <h3>File validation</h3>
          <ul>
            {validationErrors.file_errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {validationErrors && validationErrors.row_errors.length > 0 ? (
        <section className="expense-report-errors">
          <h3>Row validation</h3>
          <div className="ledger-grid">
            {validationErrors.row_errors.map((rowError) => (
              <article key={rowError.row_number} className="ledger-card expense-report-error-card">
                <h4>{`Row ${rowError.row_number}`}</h4>
                <ul>
                  {rowError.errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {loadError ? <p className="error-banner">{loadError}</p> : null}
      {isLoading ? (
        <p>Loading Expense Reports...</p>
      ) : reports.length === 0 ? (
        <p>No Expense Reports imported yet.</p>
      ) : (
        <div className="expense-report-list">
          {reports.map((report) => (
            <article key={report.expense_report_id} className="ledger-card expense-report-card">
              <header className="expense-report-card-header">
                <div>
                  <h3>{report.expense_report_id}</h3>
                  <p>{report.source_filename}</p>
                </div>
                <div className="expense-report-card-meta">
                  <span>{`${report.row_count} ${report.row_count === 1 ? "row" : "rows"}`}</span>
                  <span>{`Imported by ${report.imported_by}`}</span>
                  <span>{formatImportTimestamp(report.created_at)}</span>
                </div>
              </header>

              <div className="audit-table-wrap">
                <table className="audit-table expense-report-table">
                  <thead>
                    <tr>
                      <th scope="col">Employee</th>
                      <th scope="col">Date</th>
                      <th scope="col">Category</th>
                      <th scope="col">Amount</th>
                      <th scope="col">Currency</th>
                      <th scope="col">Business purpose</th>
                      <th scope="col">Manager approval</th>
                      <th scope="col">Receipt attached</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row, index) => (
                      <tr key={`${report.expense_report_id}:${row.employee_id}:${index}`}>
                        <td>{row.employee_id}</td>
                        <td>{row.expense_date}</td>
                        <td>{row.expense_category}</td>
                        <td>{row.amount}</td>
                        <td>{row.currency}</td>
                        <td>{row.business_purpose ?? "Not set"}</td>
                        <td>{formatBoolean(row.manager_approval)}</td>
                        <td>{formatBoolean(row.receipt_attached)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
