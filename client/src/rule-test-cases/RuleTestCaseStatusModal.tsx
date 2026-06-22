export type RuleTestCaseStatusAction = "disable" | "enable";

interface RuleTestCaseStatusModalProps {
  mode: RuleTestCaseStatusAction;
  ruleTestCaseId: string;
  isSubmitting: boolean;
  rationale: string;
  error: string | null;
  onRationaleChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function RuleTestCaseStatusModal({
  mode,
  ruleTestCaseId,
  isSubmitting,
  rationale,
  error,
  onRationaleChange,
  onConfirm,
  onCancel,
}: RuleTestCaseStatusModalProps) {
  const isDisable = mode === "disable";

  return (
    <div className="review-decision-backdrop">
      <dialog
        className="review-decision-dialog"
        open
        aria-label={`${isDisable ? "Disable" : "Enable"} Rule Test Case ${ruleTestCaseId}`}
      >
        <div className="review-decision-head">
          <h4>{isDisable ? "Disable Rule Test Case" : "Enable Rule Test Case"}</h4>
          <p className="catalog-scope">
            {isDisable
              ? "Disabled cases are excluded from Rule Test Runs and remain visible for audit."
              : "Re-enabled cases are included in Rule Test Runs again."}
          </p>
        </div>

        <label
          className="review-decision-field"
          htmlFor={`rule-test-case-${mode}-rationale`}
        >
          Rationale
          <textarea
            id={`rule-test-case-${mode}-rationale`}
            value={rationale}
            rows={4}
            disabled={isSubmitting}
            onChange={(event) => onRationaleChange(event.target.value)}
          />
        </label>

        {error ? <p className="error-banner">{error}</p> : null}

        <div className="review-decision-actions">
          <button
            type="button"
            className="document-command"
            disabled={isSubmitting}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={
              isDisable
                ? "document-command document-command-danger"
                : "document-command document-command-accent"
            }
            disabled={isSubmitting || rationale.trim().length === 0}
            onClick={onConfirm}
          >
            {isSubmitting
              ? isDisable
                ? "Disabling…"
                : "Enabling…"
              : isDisable
                ? "Confirm disable"
                : "Confirm enable"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
