import { deleteDocumentVersion, downloadDocumentVersion, fetchDocumentVersions } from "./api";
import { describeFetchError, formatDocumentTitle, formatUploadDate } from "./format";
import type { DocumentVersion, PolicyDocumentSummary } from "./types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "../shared/api/client";
import { shortenId } from "../shared/format/common";

import NewDocumentVersionDrawer from "./NewDocumentVersionDrawer";
import ReingestionDrawer from "../reingestion/ReingestionDrawer";
import VersionArchiveDrawer from "./VersionArchiveDrawer";
import VersionRegister, { type VersionTab } from "./VersionRegister";
import VersionWorkspace from "./VersionWorkspace";
import Breadcrumbs from "../shared/ui/Breadcrumbs";
import RecordPageHeader, {
  type RecordPropertyGroup,
} from "../shared/ui/RecordPageHeader";
import StatusPill from "../shared/ui/StatusPill";
import { DocumentPageIcon, RecordPageIcon } from "../shared/ui/PageIcons";

type DetailStatus = "loading" | "ready" | "not_found" | "error";

interface DocumentDetailProps {
  documentId: string;
  summary?: PolicyDocumentSummary;
  canUpload?: boolean;
  onBack: () => void;
}

const DELETE_REASON_REQUIRED = "Enter a reason before striking this version from the register.";
const DELETE_REASON_MAX_LENGTH = 500;

function pickDefaultVersionId(
  versions: DocumentVersion[],
  preferredId: string | undefined,
): string | null {
  if (preferredId && versions.some((version) => version.document_version_id === preferredId)) {
    return preferredId;
  }
  return versions[0]?.document_version_id ?? null;
}

export default function DocumentDetail({
  documentId,
  summary,
  canUpload = false,
  onBack,
}: DocumentDetailProps) {
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
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
        setSelectedVersionId(null);
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

  const latestVersionId =
    summary?.latest_document_version_id ??
    versions.find((version) => !version.deleted_at)?.document_version_id;

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

  useEffect(() => {
    if (status !== "ready") {
      return;
    }

    setSelectedVersionId((current) => {
      const preferredId =
        versionTab === "active"
          ? (latestVersionId ?? current ?? undefined)
          : (current ?? undefined);
      return pickDefaultVersionId(displayedVersions, preferredId);
    });
  }, [displayedVersions, latestVersionId, status, versionTab]);

  const selectedVersion =
    versions.find((version) => version.document_version_id === selectedVersionId) ?? null;

  async function handleVersionUploaded(documentVersionId: string): Promise<void> {
    setUploadDrawerOpen(false);
    setUploadSuccess(
      `Registered ${documentVersionId}. Prior Document Versions remain unchanged.`,
    );
    setVersionTab("active");
    setSelectedVersionId(documentVersionId);
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

  function openArchiveDrawer(versionId: string): void {
    setArchivingVersionId(versionId);
    setArchiveReason("");
    setArchiveErrors((current) => {
      const next = { ...current };
      delete next[versionId];
      return next;
    });
  }

  function closeArchiveDrawer(): void {
    setArchivingVersionId(null);
    setArchiveReason("");
  }

  async function handleArchiveConfirm(): Promise<void> {
    const version = versions.find(
      (entry) => entry.document_version_id === archivingVersionId,
    );
    if (!version || !canUpload || isArchiving || version.deleted_at) {
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
      closeArchiveDrawer();
      setVersionTab("archived");
      setSelectedVersionId(version.document_version_id);
      await loadVersions();
    } catch (error: unknown) {
      setArchiveErrors((current) => ({
        ...current,
        [version.document_version_id]: describeFetchError(error, "Archive failed."),
      }));
    } finally {
      setIsArchiving(false);
    }
  }

  function handleVersionTabChange(tab: VersionTab): void {
    setVersionTab(tab);
    const nextVersions = tab === "active" ? activeVersions : archivedVersions;
    const preferredId = tab === "active" ? latestVersionId : selectedVersionId ?? undefined;
    setSelectedVersionId(pickDefaultVersionId(nextVersions, preferredId));
  }

  const showAdminActions = canUpload && (status === "ready" || status === "not_found");
  const showReingestion = showAdminActions && status === "ready";

  const latestVersion = versions.find((version) => version.document_version_id === latestVersionId);
  const lastUpdated =
    summary?.latest_uploaded_at ?? latestVersion?.created_at ?? undefined;

  const headerPropertyGroups: RecordPropertyGroup[] = [
    {
      title: "Document",
      properties: [
        {
          label: "Document ID",
          value: <code className="db-mono">{documentId}</code>,
        },
        {
          label: "Latest upload",
          value: lastUpdated ? formatUploadDate(lastUpdated) : null,
          empty: !lastUpdated,
        },
        {
          label: "Register",
          value: summary
            ? `${summary.active_version_count} active · ${summary.version_count} total`
            : `${activeVersions.length} active · ${versions.length} total`,
        },
        {
          label: "Latest version",
          value: latestVersionId ? (
            <code className="db-mono" title={latestVersionId}>
              {shortenId(latestVersionId)}
            </code>
          ) : null,
          empty: !latestVersionId,
        },
        {
          label: "Archive status",
          value: summary?.has_deleted_versions || archivedVersions.length > 0 ? (
            <StatusPill label="Has archived versions" variant="warning" />
          ) : (
            <StatusPill label="All active" variant="success" />
          ),
        },
      ],
    },
  ];

  const headerMeta = showAdminActions ? (
    <p className="document-detail-action-note">
      Upload a new file to version this document, or re-ingest to refresh extracted rules.
    </p>
  ) : canUpload ? null : (
    <p className="document-detail-action-note">View-only — admin role required to upload or re-ingest.</p>
  );

  const headerActions = showAdminActions ? (
    <>
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
    </>
  ) : undefined;

  const archivingVersion = versions.find(
    (version) => version.document_version_id === archivingVersionId,
  );

  return (
    <div className="document-detail content-enter">
      <RecordPageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              {
                label: "Documents",
                icon: <DocumentPageIcon size={14} />,
                onClick: onBack,
              },
              {
                label: formatDocumentTitle(documentId),
                icon: <DocumentPageIcon size={14} />,
              },
            ]}
          />
        }
        icon={<RecordPageIcon icon={<DocumentPageIcon size={28} />} />}
        title={formatDocumentTitle(documentId)}
        subtitle={documentId}
        lastUpdated={lastUpdated}
        recordId={documentId}
        propertyGroups={headerPropertyGroups}
        propertyLayout="stacked"
        meta={headerMeta}
        actions={headerActions}
      />

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

      {archivingVersion ? (
        <VersionArchiveDrawer
          versionId={archivingVersion.document_version_id}
          filename={archivingVersion.filename}
          reason={archiveReason}
          error={archiveErrors[archivingVersion.document_version_id] ?? null}
          isArchiving={isArchiving}
          onReasonChange={setArchiveReason}
          onConfirm={() => void handleArchiveConfirm()}
          onCancel={closeArchiveDrawer}
        />
      ) : null}

      {uploadSuccess ? (
        <output className="version-upload-feedback success">{uploadSuccess}</output>
      ) : null}

      {status === "loading" ? <p className="catalog-status">Loading…</p> : null}

      {status === "error" ? <p className="error-banner">{errorMessage}</p> : null}

      {status === "not_found" ? (
        <div className="document-not-found reveal">
          <h4>Document not found</h4>
          <p>
            No versions exist for <code>{documentId}</code>.
            {canUpload
              ? " Upload the first version using New version above."
              : " Confirm the document ID with an administrator."}
          </p>
        </div>
      ) : null}

      {status === "ready" ? (
        <div className="version-view reveal">
          <h4 className="record-section-heading">Document versions</h4>
          <div className="version-register-layout">
            <VersionRegister
              documentId={documentId}
              versions={displayedVersions}
              versionTab={versionTab}
              versionTabCounts={versionTabCounts}
              selectedVersionId={selectedVersionId}
              latestVersionId={latestVersionId}
              onVersionTabChange={handleVersionTabChange}
              onSelectVersion={setSelectedVersionId}
            />
            {selectedVersion ? (
              <VersionWorkspace
                version={selectedVersion}
                latestVersionId={latestVersionId}
                canUpload={canUpload}
                isDownloading={downloadingVersionId === selectedVersion.document_version_id}
                downloadError={downloadErrors[selectedVersion.document_version_id] ?? null}
                onDownload={() => void handleDownload(selectedVersion)}
                onOpenArchive={() => openArchiveDrawer(selectedVersion.document_version_id)}
              />
            ) : (
              <p className="version-workspace-empty">Select a version to inspect details.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
