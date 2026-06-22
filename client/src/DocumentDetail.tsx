import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { CSSProperties } from "react";
import {
  ApiError,
  deleteDocumentVersion,
  downloadDocumentVersion,
  fetchDocumentVersions,
} from "./api";
import {
  describeFetchError,
  formatBytes,
  formatContentTypeLabel,
  formatDocumentTitle,
} from "./documentFormat";
import NewDocumentVersionDrawer from "./NewDocumentVersionDrawer";
import type { DocumentVersion, PolicyDocumentSummary } from "./types";
import ReingestionDrawer from "./ReingestionDrawer";
import VersionExtractionRuns from "./VersionExtractionRuns";

type DetailStatus = "loading" | "ready" | "not_found" | "error";

interface DocumentDetailProps {
  documentId: string;
  summary?: PolicyDocumentSummary;
  canUpload?: boolean;
  onBack: () => void;
}

const DELETE_REASON_REQUIRED = "Enter a reason before striking this version from the register.";
const DELETE_REASON_MAX_LENGTH = 500;

type VersionTab = "active" | "archived";

const VERSION_TABS: readonly { id: VersionTab; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "archived", label: "Archived" },
];

export default function DocumentDetail({
  documentId,
  summary,
  canUpload = false,
  onBack,
}: DocumentDetailProps) {
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [downloadingVersionId, setDownloadingVersionId] = useState<string | null>(null);
  const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>({});
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [archivingVersionId, setArchivingVersionId] = useState<string | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveErrors, setArchiveErrors] = useState<Record<string, string>>({});
  const [isArchiving, setIsArchiving] = useState(false);
  const [uploadDrawerOpen, setUploadDrawerOpen] = useState(false);
  const [reingestionOpen, setReingestionOpen] = useState(false);
  const [versionTab, setVersionTab] = useState<VersionTab>("active");

  const loadVersions = useCallback(async (): Promise<void> => {
    setStatus("loading");
    setErrorMessage(null);

    try {
      const response = await fetchDocumentVersions(documentId, true);
      if (response.items.length === 0) {
        setVersions([]);
        setStatus("not_found");
        return;
      }
      setVersions(response.items);
      setStatus("ready");
    } catch (error: unknown) {
      setErrorMessage(describeFetchError(error, "Unable to load Document Versions."));
      setStatus("error");
    }
  }, [documentId]);

  useEffect(() => {
    let cancelled = false;

    void loadVersions().then(() => {
      if (cancelled) {
        return;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadVersions]);

  useEffect(() => {
    if (canUpload && status === "not_found") {
      setUploadDrawerOpen(true);
    }
  }, [canUpload, status]);

  async function handleVersionUploaded(documentVersionId: string): Promise<void> {
    setUploadDrawerOpen(false);
    setUploadSuccess(
      `Registered ${documentVersionId}. Prior Document Versions remain unchanged.`,
    );
    await loadVersions();
  }

  async function handleDownload(version: DocumentVersion): Promise<void> {
    if (version.deleted_at) {
      return;
    }

    setDownloadingVersionId(version.document_version_id);
    setDownloadErrors((current) => {
      const next = { ...current };
      delete next[version.document_version_id];
      return next;
    });

    try {
      await downloadDocumentVersion(
        version.document_id,
        version.document_version_id,
        version.filename,
      );
    } catch (error: unknown) {
      const message =
        error instanceof ApiError && error.status === 410
          ? "Archived versions cannot be retrieved."
          : describeFetchError(error, "Download failed.");
      setDownloadErrors((current) => ({
        ...current,
        [version.document_version_id]: message,
      }));
    } finally {
      setDownloadingVersionId(null);
    }
  }

  function openArchiveForm(versionId: string): void {
    setArchivingVersionId(versionId);
    setArchiveReason("");
    setArchiveErrors((current) => {
      const next = { ...current };
      delete next[versionId];
      return next;
    });
  }

  function closeArchiveForm(): void {
    setArchivingVersionId(null);
    setArchiveReason("");
  }

  async function handleArchiveSubmit(
    event: FormEvent<HTMLFormElement>,
    version: DocumentVersion,
  ): Promise<void> {
    event.preventDefault();
    if (!canUpload || isArchiving || version.deleted_at) {
      return;
    }

    const reason = archiveReason.trim();
    if (!reason) {
      setArchiveErrors((current) => ({
        ...current,
        [version.document_version_id]: DELETE_REASON_REQUIRED,
      }));
      return;
    }
    if (reason.length > DELETE_REASON_MAX_LENGTH) {
      setArchiveErrors((current) => ({
        ...current,
        [version.document_version_id]: `Reason must be ${DELETE_REASON_MAX_LENGTH} characters or fewer.`,
      }));
      return;
    }

    setIsArchiving(true);
    setArchiveErrors((current) => {
      const next = { ...current };
      delete next[version.document_version_id];
      return next;
    });

    try {
      await deleteDocumentVersion(version.document_id, version.document_version_id, reason);
      closeArchiveForm();
      await loadVersions();
      setVersionTab("archived");
    } catch (error: unknown) {
      setArchiveErrors((current) => ({
        ...current,
        [version.document_version_id]: describeFetchError(error, "Archive failed."),
      }));
    } finally {
      setIsArchiving(false);
    }
  }

  const latestVersionId =
    summary?.latest_document_version_id ?? versions.find((version) => !version.deleted_at)?.document_version_id;

  const activeVersions = useMemo(
    () => versions.filter((version) => !version.deleted_at),
    [versions],
  );
  const archivedVersions = useMemo(
    () => versions.filter((version) => Boolean(version.deleted_at)),
    [versions],
  );
  const displayedVersions = versionTab === "active" ? activeVersions : archivedVersions;
  const versionTabCounts: Record<VersionTab, number> = {
    active: activeVersions.length,
    archived: archivedVersions.length,
  };

  const showAdminActions = canUpload && (status === "ready" || status === "not_found");
  const showReingestion = showAdminActions && status === "ready";

  return (
    <div className="document-detail content-enter">
      <header className="document-detail-head">
        <div className="document-detail-head-row">
          <button type="button" className="detail-back" onClick={onBack}>
            ← Catalog
          </button>
          {showAdminActions ? (
            <div className="document-detail-commands">
              <button
                type="button"
                className={`document-command${uploadDrawerOpen ? " active" : ""}`}
                aria-expanded={uploadDrawerOpen}
                aria-controls="new-document-version-drawer"
                onClick={() => {
                  setUploadSuccess(null);
                  setUploadDrawerOpen(true);
                }}
              >
                New version
              </button>
              {showReingestion ? (
                <button
                  type="button"
                  className="document-command document-command-accent"
                  onClick={() => setReingestionOpen(true)}
                >
                  Re-ingest
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="document-detail-intro">
          <h3>{formatDocumentTitle(documentId)}</h3>
        </div>
      </header>

      <NewDocumentVersionDrawer
        documentId={documentId}
        open={showAdminActions && uploadDrawerOpen}
        onClose={() => setUploadDrawerOpen(false)}
        onUploaded={(documentVersionId) => void handleVersionUploaded(documentVersionId)}
      />

      <ReingestionDrawer
        documentId={documentId}
        open={reingestionOpen}
        onClose={() => setReingestionOpen(false)}
        onCompleted={() => void loadVersions()}
      />

      {uploadSuccess ? (
        <output className="version-upload-feedback success">{uploadSuccess}</output>
      ) : null}

      {status === "loading" ? (
        <p className="catalog-status">
          <span className="catalog-status-rule" aria-hidden="true" />
          Opening version ledger…
        </p>
      ) : null}

      {status === "error" ? <p className="error-banner">{errorMessage}</p> : null}

      {status === "not_found" ? (
        <div className="document-not-found reveal">
          <span className="folio">Signal lost</span>
          <h4>Policy Document not found</h4>
          <p>
            No Document Versions exist for <code>{documentId}</code>.
            {canUpload
              ? " Deposit the first version using New version above."
              : " Confirm the document id with an administrator."}
          </p>
          <button type="button" className="detail-back inline" onClick={onBack}>
            ← Catalog
          </button>
        </div>
      ) : null}

      {status === "ready" ? (
        <>
          <div className="version-toolbar reveal">
            <div
              className="catalog-tabs"
              role="tablist"
              aria-label="Filter by version status"
            >
              {VERSION_TABS.map((tab) => {
                const isSelected = versionTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`document-version-tab-${tab.id}`}
                    className={`catalog-tab${isSelected ? " active" : ""}`}
                    aria-selected={isSelected}
                    aria-controls="document-version-panel"
                    onClick={() => setVersionTab(tab.id)}
                  >
                    <span>{tab.label}</span>
                    <span className="catalog-tab-count">{versionTabCounts[tab.id]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            id="document-version-panel"
            role="tabpanel"
            aria-labelledby={`document-version-tab-${versionTab}`}
          >
            {displayedVersions.length === 0 ? (
              <p className="version-ledger-empty">
                {versionTab === "active"
                  ? "No active Document Versions on file."
                  : "No archived Document Versions on file."}
              </p>
            ) : (
              <ol className="version-ledger" aria-label={`Document Versions for ${documentId}`}>
                {displayedVersions.map((version, index) => {
              const isArchived = Boolean(version.deleted_at);
              const isLatest = version.document_version_id === latestVersionId;
              const downloadError = downloadErrors[version.document_version_id];
              const isDownloading = downloadingVersionId === version.document_version_id;
              const isArchiveFormOpen = archivingVersionId === version.document_version_id;
              const archiveError = archiveErrors[version.document_version_id];

              return (
                <li key={version.document_version_id}>
                  <article
                    className={`version-row reveal${isArchived ? " deleted" : ""}${
                      isLatest && !isArchived ? " latest" : ""
                    }`}
                    style={{ "--reveal-delay": `${60 + index * 55}ms` } as CSSProperties}
                  >
                    <div className="version-row-main">
                      <div className="version-row-head">
                        <code>{version.document_version_id}</code>
                        <span className="version-format">{formatContentTypeLabel(version.content_type)}</span>
                        {isLatest && !isArchived ? (
                          <span className="version-badge">Latest</span>
                        ) : null}
                      </div>
                      <p className="version-filename">{version.filename}</p>
                      <dl className="version-meta-grid">
                        <div>
                          <dt>Size</dt>
                          <dd>{formatBytes(version.size_bytes)}</dd>
                        </div>
                        <div>
                          <dt>Checksum</dt>
                          <dd>{version.sha256.slice(0, 12)}…</dd>
                        </div>
                        {isArchived && version.deleted_at ? (
                          <div>
                            <dt>Archived on</dt>
                            <dd>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(version.deleted_at))}</dd>
                          </div>
                        ) : null}
                      </dl>
                      {version.deletion_reason ? (
                        <p className="version-deletion">{version.deletion_reason}</p>
                      ) : null}
                      {downloadError ? <p className="version-download-error">{downloadError}</p> : null}
                      <VersionExtractionRuns
                        documentId={version.document_id}
                        documentVersionId={version.document_version_id}
                        isArchived={isArchived}
                        canTrigger={canUpload}
                      />
                      {isArchiveFormOpen ? (
                        <form
                          className="version-archive-form"
                          aria-label={`Archive ${version.document_version_id}`}
                          onSubmit={(event) => void handleArchiveSubmit(event, version)}
                        >
                          <label htmlFor={`archive-reason-${version.document_version_id}`}>
                            Deletion reason
                          </label>
                          <textarea
                            id={`archive-reason-${version.document_version_id}`}
                            name="archive-reason"
                            rows={3}
                            maxLength={DELETE_REASON_MAX_LENGTH}
                            value={archiveReason}
                            disabled={isArchiving}
                            placeholder="Why is this version being struck from the register?"
                            onChange={(event) => {
                              setArchiveReason(event.target.value);
                              setArchiveErrors((current) => {
                                const next = { ...current };
                                delete next[version.document_version_id];
                                return next;
                              });
                            }}
                          />
                          <div className="version-archive-actions">
                            <button
                              type="submit"
                              className="version-archive-confirm"
                              disabled={isArchiving}
                            >
                              {isArchiving ? "Archiving…" : "Confirm archive"}
                            </button>
                            <button
                              type="button"
                              className="version-archive-cancel"
                              disabled={isArchiving}
                              onClick={closeArchiveForm}
                            >
                              Withdraw
                            </button>
                          </div>
                          {archiveError ? (
                            <p className="version-archive-error" role="alert">
                              {archiveError}
                            </p>
                          ) : null}
                        </form>
                      ) : null}
                    </div>

                    <div className="version-row-actions">
                      <button
                        type="button"
                        className="version-download"
                        disabled={isArchived || isDownloading}
                        onClick={() => void handleDownload(version)}
                      >
                        {isDownloading ? "Retrieving…" : "Retrieve source"}
                      </button>
                      {canUpload && !isArchived ? (
                        <button
                          type="button"
                          className="version-archive-trigger"
                          disabled={isArchiveFormOpen || isArchiving}
                          onClick={() => openArchiveForm(version.document_version_id)}
                        >
                          Strike from register
                        </button>
                      ) : null}
                      {isArchived ? (
                        <p className="version-download-note">Source unavailable for archived versions</p>
                      ) : null}
                    </div>
                  </article>
                </li>
              );
            })}
              </ol>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
