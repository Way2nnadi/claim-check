import type { PolicyDocumentSummary } from "./types";
import { useCallback, useEffect, useState } from "react";
import { fetchPolicyDocuments } from "./api";
import { hasAnyRole } from "../shared/permissions";
import type { AuthenticatedPrincipal } from "../shared/auth/types";
import { useAsyncResource } from "../shared/ui/useAsyncResource";

import DocumentDetail from "./DocumentDetail";
import { formatDocumentTitle, formatUploadDate } from "./format";
import RegisterDocumentDrawer from "./RegisterDocumentDrawer";

interface DocumentCatalogProps {
  principal: AuthenticatedPrincipal;
}

export default function DocumentCatalog({ principal }: DocumentCatalogProps) {
  const canUpload = hasAnyRole(principal, ["admin"]);
  const fetchDocuments = useCallback(async (): Promise<PolicyDocumentSummary[]> => {
    const response = await fetchPolicyDocuments();
    return response.items;
  }, []);
  const {
    status,
    data,
    error: errorMessage,
    reload: loadDocuments,
  } = useAsyncResource(fetchDocuments, "Unable to load documents.");
  const documents = data ?? [];
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [registerDrawerOpen, setRegisterDrawerOpen] = useState(false);

  useEffect(() => {
    if (canUpload && status === "ready" && documents.length === 0) {
      setRegisterDrawerOpen(true);
    }
  }, [canUpload, documents.length, status]);

  async function handleDocumentRegistered(documentId: string): Promise<void> {
    await loadDocuments();
    setRegisterDrawerOpen(false);
    setSelectedDocumentId(documentId);
  }

  if (selectedDocumentId) {
    const summary = documents.find((item) => item.document_id === selectedDocumentId);
    return (
      <DocumentDetail
        documentId={selectedDocumentId}
        summary={summary}
        canUpload={canUpload}
        onBack={() => setSelectedDocumentId(null)}
      />
    );
  }

  if (status === "loading") {
    return (
      <div className="catalog-page content-enter">
        <p className="catalog-status">Loading…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="catalog-page content-enter">
        <p className="error-banner">{errorMessage}</p>
      </div>
    );
  }

  const existingDocumentIds = documents.map((document) => document.document_id);

  const registerDrawer = canUpload ? (
    <RegisterDocumentDrawer
      open={registerDrawerOpen}
      onClose={() => setRegisterDrawerOpen(false)}
      existingDocumentIds={existingDocumentIds}
      onRegistered={(documentId) => void handleDocumentRegistered(documentId)}
    />
  ) : null;

  if (documents.length === 0) {
    return (
      <div className="catalog-page content-enter">
        {registerDrawer}
        <div className="catalog-empty reveal">
          <h3>No documents yet</h3>
          <p>
            {canUpload
              ? "Register a document to get started."
              : "Ask an administrator to register a document."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="catalog-page content-enter">
      {registerDrawer}
      <div className="catalog-toolbar">
        <p className="catalog-scope">
          {documents.length} document{documents.length === 1 ? "" : "s"}
        </p>
        {canUpload ? (
          <button
            type="button"
            className={`document-command${registerDrawerOpen ? " active" : ""}`}
            aria-expanded={registerDrawerOpen}
            onClick={() => setRegisterDrawerOpen((current) => !current)}
          >
            New document
          </button>
        ) : null}
      </div>

      <div className="db-table-wrap">
        <table className="db-table" aria-label="Documents">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Latest version</th>
              <th scope="col">Uploaded</th>
              <th scope="col">Versions</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <tr
                key={document.document_id}
                tabIndex={0}
                role="button"
                aria-label={`Open ${formatDocumentTitle(document.document_id)}`}
                onClick={() => setSelectedDocumentId(document.document_id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedDocumentId(document.document_id);
                  }
                }}
              >
                <td>
                  <span className="db-primary">
                    {formatDocumentTitle(document.document_id)}
                  </span>
                  <span className="db-secondary db-mono">{document.document_id}</span>
                </td>
                <td className="db-mono">{document.latest_document_version_id}</td>
                <td>{formatUploadDate(document.latest_uploaded_at)}</td>
                <td>
                  {document.active_version_count} active
                  {document.version_count !== document.active_version_count
                    ? ` · ${document.version_count} total`
                    : ""}
                </td>
                <td>
                  {document.has_deleted_versions ? (
                    <span className="db-tag archived">Has archived versions</span>
                  ) : (
                    <span className="db-tag">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
