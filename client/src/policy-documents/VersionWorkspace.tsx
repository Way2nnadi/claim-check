import { ArchiveX, Download } from "lucide-react";
import {
  formatBytes,
  formatContentTypeLabel,
  formatUploadDate,
} from "./format";
import type { DocumentVersion } from "./types";
import { shortenId } from "../shared/format/common";

import RecordPropertyRow, {
  type RecordProperty,
} from "../shared/ui/RecordPropertyRow";
import StatusPill from "../shared/ui/StatusPill";
import VersionExtractionWorkspace from "./VersionExtractionWorkspace";

interface VersionWorkspaceProps {
  version: DocumentVersion;
  latestVersionId: string | undefined;
  canUpload: boolean;
  isDownloading: boolean;
  downloadError: string | null;
  onDownload: () => void;
  onOpenArchive: () => void;
}

export default function VersionWorkspace({
  version,
  latestVersionId,
  canUpload,
  isDownloading,
  downloadError,
  onDownload,
  onOpenArchive,
}: VersionWorkspaceProps) {
  const isArchived = Boolean(version.deleted_at);
  const isLatest = version.document_version_id === latestVersionId && !isArchived;

  const versionProperties: RecordProperty[] = [
    {
      label: "Format",
      value: formatContentTypeLabel(version.content_type),
    },
    {
      label: "Size",
      value: formatBytes(version.size_bytes),
    },
    {
      label: "Uploaded",
      value: (
        <time dateTime={version.created_at}>{formatUploadDate(version.created_at)}</time>
      ),
    },
    {
      label: "Version ID",
      value: (
        <code className="db-mono" title={version.document_version_id}>
          {version.document_version_id}
        </code>
      ),
    },
  ];

  if (isArchived && version.deleted_at) {
    versionProperties.push({
      label: "Archived",
      value: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
        new Date(version.deleted_at),
      ),
    });
  }

  return (
    <section
      className={`version-workspace reveal${isLatest ? " latest" : ""}${isArchived ? " archived" : ""}`}
      aria-label={`Version workspace for ${version.filename}`}
    >
      <div className="version-workspace-head">
        <div className="version-workspace-main">
          <p className="version-workspace-title">{version.filename}</p>
          <p className="version-workspace-meta">
            {formatContentTypeLabel(version.content_type)}
            <span aria-hidden="true"> · </span>
            {formatBytes(version.size_bytes)}
            <span aria-hidden="true"> · </span>
            <time dateTime={version.created_at}>{formatUploadDate(version.created_at)}</time>
            <span aria-hidden="true"> · </span>
            <code className="db-mono" title={version.document_version_id}>
              {shortenId(version.document_version_id)}
            </code>
          </p>
        </div>
        <div className="version-workspace-side">
          {isLatest ? <StatusPill label="Latest" variant="success" /> : null}
          <div className="version-workspace-actions">
            <button
              type="button"
              className="document-command document-command-icon"
              disabled={isArchived || isDownloading}
              onClick={onDownload}
              aria-label="Retrieve source"
              title={isDownloading ? "Retrieving source" : "Retrieve source"}
            >
              <Download aria-hidden="true" />
            </button>
            {canUpload && !isArchived ? (
              <button
                type="button"
                className="document-command document-command-icon document-command-danger"
                onClick={onOpenArchive}
                aria-label="Strike from register"
                title="Strike from register"
              >
                <ArchiveX aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <RecordPropertyRow properties={versionProperties} layout="inline" />

      {version.deletion_reason ? (
        <p className="version-deletion">{version.deletion_reason}</p>
      ) : null}
      {downloadError ? <p className="version-download-error">{downloadError}</p> : null}
      {isArchived ? (
        <p className="version-download-note">Source unavailable for archived versions</p>
      ) : null}

      <VersionExtractionWorkspace
        documentId={version.document_id}
        documentVersionId={version.document_version_id}
        isArchived={isArchived}
        canTrigger={canUpload}
      />
    </section>
  );
}
