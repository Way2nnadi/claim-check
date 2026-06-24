import type { EvaluationOutcome, ExpenseFixture, RuleTestCase } from "./types";

export const EVALUATION_OUTCOME_OPTIONS: readonly EvaluationOutcome[] = [
  "pass",
  "violation",
  "needs_review",
  "missing_evidence",
];

export interface RuleTestCaseEditDraft {
  amount: string;
  expectedOutcome: EvaluationOutcome;
  businessPurpose: string;
  submissionDays: string;
  managerApproval: boolean;
  receiptAttached: boolean;
  rationale: string;
}

export function buildEditDraft(testCase: RuleTestCase): RuleTestCaseEditDraft {
  const fixture = testCase.expense_fixture;
  return {
    amount: fixture.amount,
    expectedOutcome: testCase.expected_outcome,
    businessPurpose: fixture.business_purpose ?? "",
    submissionDays:
      fixture.submission_days != null ? String(fixture.submission_days) : "",
    managerApproval: fixture.manager_approval ?? false,
    receiptAttached: fixture.receipt_attached ?? false,
    rationale: "",
  };
}

export function buildEditRequest(
  testCase: RuleTestCase,
  draft: RuleTestCaseEditDraft,
): {
  expense_fixture: ExpenseFixture;
  expected_outcome: EvaluationOutcome;
  rationale: string;
} {
  const submissionDays = draft.submissionDays.trim();
  const expenseFixture: ExpenseFixture = {
    ...testCase.expense_fixture,
    amount: draft.amount.trim(),
    business_purpose: draft.businessPurpose.trim() || null,
    submission_days: submissionDays ? Number(submissionDays) : null,
    manager_approval: draft.managerApproval,
    receipt_attached: draft.receiptAttached,
  };

  return {
    expense_fixture: expenseFixture,
    expected_outcome: draft.expectedOutcome,
    rationale: draft.rationale.trim(),
  };
}

export function validateEditDraft(
  testCase: RuleTestCase,
  draft: RuleTestCaseEditDraft,
): string | null {
  if (!draft.rationale.trim()) {
    return "Rationale is required.";
  }
  if (!draft.amount.trim()) {
    return "Amount is required.";
  }
  if (draft.submissionDays.trim() && Number.isNaN(Number(draft.submissionDays))) {
    return "Submission days must be a number.";
  }

  const request = buildEditRequest(testCase, draft);
  const fixtureChanged =
    JSON.stringify(request.expense_fixture) !==
    JSON.stringify(testCase.expense_fixture);
  const outcomeChanged = request.expected_outcome !== testCase.expected_outcome;

  if (!fixtureChanged && !outcomeChanged) {
    return "Change the fixture or expected outcome before saving.";
  }

  return null;
}
