import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { publishPolicyVersion } from "./api";
import MissionDrawerHead from "./MissionDrawerHead";
import { describePolicyVersionPublishError } from "./policyVersionFormat";

export interface PublishedPolicyVersionResult {
  policy_version_id: string;
  published_by: string;
  rule_count: number;
  change_summary: string;
}

interface PublishPolicyVersionDrawerProps {
  open: boolean;
  onClose: () => void;
  onPublished: (result: PublishedPolicyVersionResult) => void;
}

export default function PublishPolicyVersionDrawer({
  open,
  onClose,
  onPublished,
}: PublishPolicyVersionDrawerProps) {
  const [policyVersionIdDraft, setPolicyVersionIdDraft] = useState("");
  const [changeSummaryDraft, setChangeSummaryDraft] = useState("");
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  useEffect(() => {
    if (!open) {
      setPolicyVersionIdDraft("");
      setChangeSummaryDraft("");
      setPublishError(null);
      setIsPublishing(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !isPublishing) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, isPublishing, onClose]);

  async function handlePublish(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isPublishing) {
      return;
    }

    const nextPolicyVersionId = policyVersionIdDraft.trim();
    const nextChangeSummary = changeSummaryDraft.trim();

    if (!nextPolicyVersionId) {
      setPublishError("Enter a Policy Version id.");
      return;
    }
    if (!nextChangeSummary) {
      setPublishError("Enter a change summary.");
      return;
    }

    setIsPublishing(true);
    setPublishError(null);

    try {
      const published = await publishPolicyVersion({
        policy_version_id: nextPolicyVersionId,
        change_summary: nextChangeSummary,
      });

      onPublished({
        policy_version_id: published.policy_version_id,
        published_by: published.published_by,
        rule_count: published.rule_count,
        change_summary: nextChangeSummary,
      });
    } catch (error: unknown) {
      setPublishError(describePolicyVersionPublishError(error));
    } finally {
      setIsPublishing(false);
    }
  }

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="mission-drawer-root">
      <button
        type="button"
        className="mission-drawer-backdrop"
        aria-label="Close publish Policy Version drawer"
        disabled={isPublishing}
        onClick={() => {
          if (!isPublishing) {
            onClose();
          }
        }}
      />
      <dialog
        open
        className="mission-drawer"
        aria-labelledby="policy-version-publish-heading"
      >
        <MissionDrawerHead
          folio="Version ledger"
          title="Publish Policy Version"
          titleId="policy-version-publish-heading"
          lede="Snapshot all approved Rules into an immutable Policy Version."
          onClose={onClose}
          closeDisabled={isPublishing}
        />

        <div className="mission-drawer-body">
          <form
            className="policy-version-publish-form"
            onSubmit={(event) => void handlePublish(event)}
          >
            <label htmlFor="policy-version-id">
              Policy Version id
              <input
                id="policy-version-id"
                name="policy-version-id"
                value={policyVersionIdDraft}
                spellCheck={false}
                disabled={isPublishing}
                onChange={(event) => {
                  setPolicyVersionIdDraft(event.target.value);
                  setPublishError(null);
                }}
              />
            </label>

            <label htmlFor="change-summary">
              Change summary
              <textarea
                id="change-summary"
                name="change-summary"
                rows={4}
                value={changeSummaryDraft}
                disabled={isPublishing}
                placeholder="Why this snapshot exists"
                onChange={(event) => {
                  setChangeSummaryDraft(event.target.value);
                  setPublishError(null);
                }}
              />
            </label>

            {publishError ? (
              <p className="error-banner" role="alert">
                {publishError}
              </p>
            ) : null}

            <div className="policy-version-publish-actions">
              <button
                type="submit"
                className="reingestion-submit"
                disabled={isPublishing}
              >
                {isPublishing ? "Publishing…" : "Publish"}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </div>,
    document.body,
  );
}
