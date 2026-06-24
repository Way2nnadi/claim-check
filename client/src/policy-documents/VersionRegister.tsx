import {
  formatBytes,
  formatContentTypeLabel,
  formatUploadDate,
} from "./format";
import type { DocumentVersion } from "./types";
import { shortenId } from "../shared/format/common";
import FilterTabs from "../shared/ui/FilterTabs";
import StatusPill from "../shared/ui/StatusPill";

export type VersionTab = "active" | "archived";

const VERSION_TABS: readonly { id: VersionTab; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "archived", label: "Archived" },
];

interface VersionRegisterProps {
  documentId: string;
  versions: DocumentVersion[];
  versionTab: VersionTab;
  versionTabCounts: Record<VersionTab, number>;
  selectedVersionId: string | null;
  latestVersionId: string | undefined;
  onVersionTabChange: (tab: VersionTab) => void;
  onSelectVersion: (versionId: string) => void;
}

export default function VersionRegister({
  documentId,
  versions,
  versionTab,
  versionTabCounts,
  selectedVersionId,
  latestVersionId,
  onVersionTabChange,
  onSelectVersion,
}: VersionRegisterProps) {
  return (
    <div className="version-register">
      <FilterTabs
        tabs={VERSION_TABS.map((tab) => ({
          id: tab.id,
          label: tab.label,
          count: versionTabCounts[tab.id],
        }))}
        activeTabId={versionTab}
        onTabChange={(tabId) => onVersionTabChange(tabId as VersionTab)}
        ariaLabel="Filter by version status"
        idPrefix="document-version-tab"
        panelId="document-version-panel"
      />

      <div
        id="document-version-panel"
        role="tabpanel"
        aria-labelledby={`document-version-tab-${versionTab}`}
      >
        {versions.length === 0 ? (
          <p className="version-ledger-empty">
            {versionTab === "active"
              ? "No active Document Versions on file."
              : "No archived Document Versions on file."}
          </p>
        ) : (
          <ol className="version-register-list" aria-label={`Document Versions for ${documentId}`}>
            {versions.map((version) => {
              const isSelected = version.document_version_id === selectedVersionId;
              const isLatest =
                version.document_version_id === latestVersionId && !version.deleted_at;
              const isArchived = Boolean(version.deleted_at);

              return (
                <li key={version.document_version_id}>
                  <button
                    type="button"
                    aria-current={isSelected ? "true" : undefined}
                    className={`version-register-row${isSelected ? " is-selected" : ""}${
                      isLatest ? " latest" : ""
                    }${isArchived ? " archived" : ""}`}
                    onClick={() => onSelectVersion(version.document_version_id)}
                  >
                    <span className="version-register-row-main">
                      <span className="version-register-row-title">{version.filename}</span>
                      <span className="version-register-row-meta">
                        {formatContentTypeLabel(version.content_type)}
                        <span aria-hidden="true"> · </span>
                        {formatBytes(version.size_bytes)}
                        <span aria-hidden="true"> · </span>
                        {formatUploadDate(version.created_at)}
                      </span>
                      <span className="version-register-row-id db-mono" title={version.document_version_id}>
                        {shortenId(version.document_version_id)}
                      </span>
                    </span>
                    <span className="version-register-row-status">
                      {isLatest ? (
                        <StatusPill label="Latest" variant="success" />
                      ) : isArchived ? (
                        <StatusPill label="Archived" variant="warning" />
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
