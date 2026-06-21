import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { fetchPolicyDocuments } from "./api";
import DocumentDetail from "./DocumentDetail";
import {
  describeFetchError,
  formatDocumentTitle,
  formatUploadDate,
} from "./documentFormat";
import { hasAnyRole } from "./permissions";
import type { AuthenticatedPrincipal, PolicyDocumentSummary } from "./types";

interface DocumentCatalogProps {
  principal: AuthenticatedPrincipal;
}

type CatalogStatus = "loading" | "ready" | "error";

export default function DocumentCatalog({ principal }: DocumentCatalogProps) {
  const canUpload = hasAnyRole(principal, ["admin"]);
  const [status, setStatus] = useState<CatalogStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [documents, setDocuments] = useState<PolicyDocumentSummary[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetchPolicyDocuments()
      .then((response) => {
        if (cancelled) {
          return;
        }
        setDocuments(response.items);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setErrorMessage(describeFetchError(error, "Unable to load the document registry."));
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
        <p className="catalog-status">
          <span className="catalog-status-rule" aria-hidden="true" />
          Consulting the registry…
        </p>
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

  if (documents.length === 0) {
    return (
      <div className="catalog-page content-enter">
        <div className="catalog-empty reveal">
          <span className="folio">Registry · empty</span>
          <h3>No Policy Documents on file</h3>
          <p>Upload a source document to open the catalog.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="catalog-page content-enter">
      <p className="catalog-scope">
        {documents.length} document{documents.length === 1 ? "" : "s"} indexed
      </p>

      <ul className="catalog-grid" aria-label="Policy Document catalog">
        {documents.map((document, index) => (
          <li key={document.document_id}>
            <button
              type="button"
              className="catalog-folio reveal"
              style={{ "--reveal-delay": `${80 + index * 70}ms` } as CSSProperties}
              onClick={() => setSelectedDocumentId(document.document_id)}
            >
              <div className="catalog-folio-head">
                <p className="catalog-slug">{document.document_id}</p>
                <h3>{formatDocumentTitle(document.document_id)}</h3>
              </div>
              <dl className="catalog-meta">
                <div>
                  <dt>Latest version</dt>
                  <dd>{document.latest_document_version_id}</dd>
                </div>
                <div>
                  <dt>Uploaded</dt>
                  <dd>{formatUploadDate(document.latest_uploaded_at)}</dd>
                </div>
                <div>
                  <dt>Versions</dt>
                  <dd>
                    {document.active_version_count} active
                    {document.version_count !== document.active_version_count
                      ? ` · ${document.version_count} total`
                      : ` · ${document.version_count}`}
                  </dd>
                </div>
              </dl>
              <div className="catalog-folio-foot">
                <p
                  className={
                    document.has_deleted_versions ? "catalog-flag" : "catalog-flag is-empty"
                  }
                  aria-hidden={!document.has_deleted_versions}
                >
                  Contains archived versions
                </p>
                <p className="catalog-open-hint">Access record →</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
