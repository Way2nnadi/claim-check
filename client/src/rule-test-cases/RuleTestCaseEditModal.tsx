import {
  EVALUATION_OUTCOME_OPTIONS,
  type RuleTestCaseEditDraft,
} from "./edits";
import { formatEvaluationOutcome, formatRuleTestCaseVariant } from "./format";
import type { RuleTestCase } from "./types";

interface RuleTestCaseEditModalProps {
  testCase: RuleTestCase;
  draft: RuleTestCaseEditDraft;
  isSubmitting: boolean;
  error: string | null;
  onDraftChange: (draft: RuleTestCaseEditDraft) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function RuleTestCaseEditModal({
  testCase,
  draft,
  isSubmitting,
  error,
  onDraftChange,
  onConfirm,
  onCancel,
}: RuleTestCaseEditModalProps) {
  const showBusinessPurpose =
    testCase.expense_fixture.business_purpose != null ||
    testCase.variant === "negative" ||
    testCase.variant === "exception";
  const showSubmissionDays = testCase.expense_fixture.submission_days != null;
  const showManagerApproval = testCase.expense_fixture.manager_approval != null;
  const showReceiptAttached = testCase.expense_fixture.receipt_attached != null;

  return (
    <div className="review-decision-backdrop">
      <dialog
        className="review-decision-dialog rule-test-edit-dialog"
        open
        aria-label={`Edit Rule Test Case ${testCase.rule_test_case_id}`}
      >
        <div className="review-decision-head">
          <h4>Edit Rule Test Case</h4>
          <p className="catalog-scope">
            Update the synthetic fixture or expected outcome. Edits are audited and
            included in Rule Test Runs.
          </p>
        </div>

        <div className="rule-test-edit-meta">
          <span>{formatRuleTestCaseVariant(testCase.variant)}</span>
          <span>{testCase.expense_fixture.expense_category}</span>
        </div>

        <label className="review-decision-field" htmlFor="rule-test-edit-amount">
          Amount ({testCase.expense_fixture.currency})
          <input
            id="rule-test-edit-amount"
            type="text"
            value={draft.amount}
            disabled={isSubmitting}
            onChange={(event) =>
              onDraftChange({ ...draft, amount: event.target.value })
            }
          />
        </label>

        <label
          className="review-decision-field"
          htmlFor="rule-test-edit-expected-outcome"
        >
          Expected outcome
          <select
            id="rule-test-edit-expected-outcome"
            value={draft.expectedOutcome}
            disabled={isSubmitting}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                expectedOutcome: event.target.value as RuleTestCaseEditDraft["expectedOutcome"],
              })
            }
          >
            {EVALUATION_OUTCOME_OPTIONS.map((outcome) => (
              <option key={outcome} value={outcome}>
                {formatEvaluationOutcome(outcome)}
              </option>
            ))}
          </select>
        </label>

        {showBusinessPurpose ? (
          <label
            className="review-decision-field"
            htmlFor="rule-test-edit-business-purpose"
          >
            Business purpose
            <input
              id="rule-test-edit-business-purpose"
              type="text"
              value={draft.businessPurpose}
              disabled={isSubmitting}
              onChange={(event) =>
                onDraftChange({ ...draft, businessPurpose: event.target.value })
              }
            />
          </label>
        ) : null}

        {showSubmissionDays ? (
          <label
            className="review-decision-field"
            htmlFor="rule-test-edit-submission-days"
          >
            Submission days
            <input
              id="rule-test-edit-submission-days"
              type="number"
              min={0}
              value={draft.submissionDays}
              disabled={isSubmitting}
              onChange={(event) =>
                onDraftChange({ ...draft, submissionDays: event.target.value })
              }
            />
          </label>
        ) : null}

        {showManagerApproval ? (
          <label className="review-decision-field rule-test-edit-checkbox">
            <input
              type="checkbox"
              checked={draft.managerApproval}
              disabled={isSubmitting}
              onChange={(event) =>
                onDraftChange({ ...draft, managerApproval: event.target.checked })
              }
            />
            Manager approval
          </label>
        ) : null}

        {showReceiptAttached ? (
          <label className="review-decision-field rule-test-edit-checkbox">
            <input
              type="checkbox"
              checked={draft.receiptAttached}
              disabled={isSubmitting}
              onChange={(event) =>
                onDraftChange({ ...draft, receiptAttached: event.target.checked })
              }
            />
            Receipt attached
          </label>
        ) : null}

        <label className="review-decision-field" htmlFor="rule-test-edit-rationale">
          Rationale
          <textarea
            id="rule-test-edit-rationale"
            value={draft.rationale}
            rows={4}
            disabled={isSubmitting}
            onChange={(event) =>
              onDraftChange({ ...draft, rationale: event.target.value })
            }
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
            className="document-command document-command-accent"
            disabled={isSubmitting || draft.rationale.trim().length === 0}
            onClick={onConfirm}
          >
            {isSubmitting ? "Saving…" : "Save edit"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
