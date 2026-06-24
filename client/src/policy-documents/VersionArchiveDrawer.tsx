interface VersionArchiveDrawerProps {
  versionId: string;
  filename: string;
  reason: string;
  error: string | null;
  isArchiving: boolean;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function VersionArchiveDrawer({
  versionId,
  filename,
  reason,
  error,
  isArchiving,
  onReasonChange,
  onConfirm,
  onCancel,
}: VersionArchiveDrawerProps) {
  const reasonFieldId = `archive-reason-${versionId}`;

  return (
    <div className="review-decision-backdrop">
      <dialog
        className="review-decision-dialog"
        open
        aria-label={`Strike ${filename} from register`}
      >
        <div className="review-decision-head">
          <h4>Strike from register</h4>
          <p className="version-archive-drawer-note">
            <code className="db-mono">{versionId}</code> will be archived. Source files become
            unavailable, but extraction history is retained.
          </p>
        </div>

        <label className="review-decision-field" htmlFor={reasonFieldId}>
          Deletion reason
          <textarea
            id={reasonFieldId}
            name="archive-reason"
            rows={4}
            maxLength={500}
            value={reason}
            disabled={isArchiving}
            placeholder="Why is this version being struck from the register?"
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </label>

        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        <div className="review-decision-actions">
          <button
            type="button"
            className="document-command"
            disabled={isArchiving}
            onClick={onCancel}
          >
            Withdraw
          </button>
          <button
            type="button"
            className="document-command document-command-danger"
            disabled={isArchiving}
            onClick={onConfirm}
          >
            {isArchiving ? "Archiving…" : "Confirm archive"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
