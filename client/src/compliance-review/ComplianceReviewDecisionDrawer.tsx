import { useEffect } from "react";
import { createPortal } from "react-dom";
import SearchablePicker from "../shared/ui/SearchablePicker";
import MissionDrawerHead from "../shared/ui/MissionDrawerHead";
import type { ComplianceReviewResolutionType } from "./types";
import { RESOLUTION_TYPE_OPTIONS } from "./decisions";

interface ComplianceReviewDecisionDrawerProps {
  open: boolean;
  rowIndex: number;
  resolutionType: ComplianceReviewResolutionType;
  isResolving: boolean;
  rationale: string;
  error: string | null;
  onResolutionTypeChange: (value: ComplianceReviewResolutionType) => void;
  onRationaleChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ComplianceReviewDecisionDrawer({
  open,
  rowIndex,
  resolutionType,
  isResolving,
  rationale,
  error,
  onResolutionTypeChange,
  onRationaleChange,
  onConfirm,
  onClose,
}: ComplianceReviewDecisionDrawerProps) {
  const selectedOption = RESOLUTION_TYPE_OPTIONS.find(
    (option) => option.value === resolutionType,
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !isResolving) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, isResolving, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="mission-drawer-root">
      <button
        type="button"
        className="mission-drawer-backdrop"
        aria-label="Close resolve review drawer"
        disabled={isResolving}
        onClick={() => {
          if (!isResolving) {
            onClose();
          }
        }}
      />
      <dialog
        open
        className="mission-drawer"
        aria-labelledby="compliance-review-resolution-heading"
      >
        <MissionDrawerHead
          folio="Compliance Review"
          title="Resolve review"
          titleId="compliance-review-resolution-heading"
          lede={`Row ${rowIndex + 1} · confirm or override the evaluation outcome.`}
          onClose={onClose}
          closeDisabled={isResolving}
        />

        <div className="mission-drawer-body">
          <form
            className="compliance-review-resolution-form"
            onSubmit={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            <div className="review-field">
              <SearchablePicker
                label="Resolution"
                value={resolutionType}
                options={RESOLUTION_TYPE_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                placeholder="Select resolution"
                emptyMessage="No matching resolutions"
                disabled={isResolving}
                showAllOnOpen
                onChange={(value) =>
                  onResolutionTypeChange(value as ComplianceReviewResolutionType)
                }
              />
            </div>

            {selectedOption ? (
              <p className="compliance-review-resolution-note">
                {selectedOption.description}
              </p>
            ) : null}

            <div className="review-field review-field--statement">
              <label htmlFor="compliance-review-rationale">Rationale</label>
              <textarea
                id="compliance-review-rationale"
                value={rationale}
                rows={5}
                disabled={isResolving}
                placeholder="Why this resolution is appropriate."
                onChange={(event) => onRationaleChange(event.target.value)}
              />
            </div>

            {error ? (
              <p className="error-banner" role="alert">{error}</p>
            ) : null}

            <div className="compliance-review-resolution-actions">
              <button
                type="button"
                className="document-command"
                disabled={isResolving}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="document-command document-command-accent"
                disabled={isResolving}
              >
                {isResolving ? "Recording…" : "Confirm resolution"}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </div>,
    document.body,
  );
}
