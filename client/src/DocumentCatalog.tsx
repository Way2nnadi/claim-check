import { useEffect, useState } from "react";
import type { FormEvent } from "react";
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
  const [lookupDocumentId, setLookupDocumentId] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);

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

  function handleOpenDocument(documentId: string): void {
    setLookupError(null);
    setSelectedDocumentId(documentId);
  }

  function handleLookupSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const nextDocumentId = lookupDocumentId.trim();
    if (!nextDocumentId) {
      setLookupError("Enter a Policy Document id to open.");
      return;
    }
    setLookupError(null);
    setSelectedDocumentId(nextDocumentId);
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
      <div className="catalog-stage">
        <p className="catalog-status">
          <span className="catalog-status-rule" aria-hidden="true" />
          Consulting the registry…
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="catalog-stage">
        <p className="error-banner">{errorMessage}</p>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="catalog-stage">
        <div className="catalog-empty reveal">
          <span className="folio">Registry · Null Set</span>
          <h3>No Policy Documents on file</h3>
          <p>
            Upload a source document to open the catalog. Each upload becomes an immutable
            Document Version anchored to a Policy Document id.
          </p>
        </div>
        <form className="document-lookup" onSubmit={handleLookupSubmit}>
          <label htmlFor="document-lookup-id">Open by document id</label>
          <div className="document-lookup-row">
            <input
              id="document-lookup-id"
              name="document-lookup-id"
              value={lookupDocumentId}
              onChange={(event) => setLookupDocumentId(event.target.value)}
              placeholder="expense-policy"
              spellCheck={false}
            />
            <button type="submit">Load node</button>
          </div>
          {lookupError ? <p className="error-banner">{lookupError}</p> : null}
        </form>
      </div>
    );
  }

  return (
    <div className="catalog-stage">
      <div className="catalog-header">
        <p className="catalog-count">
          <span className="folio">{documents.length} indexed</span>
        </p>
        <form className="document-lookup compact" onSubmit={handleLookupSubmit}>
          <label htmlFor="document-lookup-id">Open by id</label>
          <div className="document-lookup-row">
            <input
              id="document-lookup-id"
              name="document-lookup-id"
              value={lookupDocumentId}
              onChange={(event) => setLookupDocumentId(event.target.value)}
              placeholder="document-id"
              spellCheck={false}
            />
            <button type="submit">Open</button>
          </div>
        </form>
      </div>
      {lookupError ? <p className="error-banner">{lookupError}</p> : null}

      <ul className="catalog-grid" aria-label="Policy Document catalog">
        {documents.map((document, index) => (
          <li key={document.document_id}>
            <button
              type="button"
              className="catalog-folio reveal"
              style={{ "--reveal-delay": `${80 + index * 70}ms` } as CSSProperties}
              onClick={() => handleOpenDocument(document.document_id)}
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
