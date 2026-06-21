import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { ApiError, fetchCandidateRule, updateCandidateRule } from "./api";
import {
  describeCandidateRuleError,
  formatEnforceabilityClass,
  formatLifecycleState,
  formatQAFlagCode,
  lifecycleStateClassName,
} from "./candidateRuleFormat";
import { hasAnyRole } from "./permissions";
import type {
  AggregationPeriod,
  Applicability,
  AuthenticatedPrincipal,
  CandidateRuleReview,
  CandidateRuleReviewUpdateRequest,
  CandidateRuleValue,
  EnforceabilityClass,
  RuleCondition,
  RuleException,
  Scope,
} from "./types";

interface CandidateRuleDetailProps {
  candidateRuleId: string;
  principal: AuthenticatedPrincipal;
  onBack?: () => void;
  onReviewChange?: (review: CandidateRuleReview) => void;
}

type DetailStatus = "loading" | "ready" | "not_found" | "error";

interface ScopeDraft {
  country: string;
  expense_category: string;
  travel_type: string;
  employee_group: string;
  effective_start_date: string;
  effective_end_date: string;
}

interface ConditionDraft {
  field: string;
  operator: string;
  value: string;
}

interface ApplicabilityDraft {
  aggregation_period: AggregationPeriod | "";
  unit: string;
  currency: string;
  limit_basis: string;
}

interface ExceptionDraft {
  description: string;
  required_evidence: string;
}

interface RuleDraft {
  statement: string;
  enforceability_class: EnforceabilityClass;
  scope: ScopeDraft;
  condition: ConditionDraft;
  applicability: ApplicabilityDraft;
  exceptions: ExceptionDraft[];
}

interface RedlineFieldProps {
  currentLabel: string;
  extractedValue: ReactNode;
  changed: boolean;
  inputId: string;
  children: ReactNode;
  description?: string;
}

const EDITOR_ROLES = ["admin", "approver"] as const;

const ENFORCEABILITY_OPTIONS: readonly EnforceabilityClass[] = [
  "enforceable",
  "guidance",
  "subjective",
];

const AGGREGATION_PERIOD_OPTIONS: readonly AggregationPeriod[] = [
  "per_transaction",
  "per_day",
  "per_trip",
  "per_night",
  "per_attendee",
];

const SCOPE_FIELDS: readonly {
  key: keyof ScopeDraft;
  currentLabel: string;
  caption: string;
}[] = [
  { key: "country", currentLabel: "Current scope country", caption: "Country" },
  {
    key: "expense_category",
    currentLabel: "Current scope expense category",
    caption: "Expense category",
  },
  { key: "travel_type", currentLabel: "Current scope travel type", caption: "Travel type" },
  {
    key: "employee_group",
    currentLabel: "Current scope employee group",
    caption: "Employee group",
  },
  {
    key: "effective_start_date",
    currentLabel: "Current effective start date",
    caption: "Effective start date",
  },
  {
    key: "effective_end_date",
    currentLabel: "Current effective end date",
    caption: "Effective end date",
  },
];

function normalizeOptionalString(value: string): string | null {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function normalizeRequiredString(value: string): string {
  return value.trim();
}

function createRuleDraft(rule: CandidateRuleValue): RuleDraft {
  return {
    statement: rule.statement,
    enforceability_class: rule.enforceability_class,
    scope: {
      country: rule.scope.country ?? "",
      expense_category: rule.scope.expense_category ?? "",
      travel_type: rule.scope.travel_type ?? "",
      employee_group: rule.scope.employee_group ?? "",
      effective_start_date: rule.scope.effective_start_date ?? "",
      effective_end_date: rule.scope.effective_end_date ?? "",
    },
    condition: {
      field: rule.condition?.field ?? "",
      operator: rule.condition?.operator ?? "",
      value: rule.condition?.value ?? "",
    },
    applicability: {
      aggregation_period: rule.applicability?.aggregation_period ?? "",
      unit: rule.applicability?.unit ?? "",
      currency: rule.applicability?.currency ?? "",
      limit_basis: rule.applicability?.limit_basis ?? "",
    },
    exceptions:
      rule.exceptions.length > 0
        ? rule.exceptions.map((exception) => ({
            description: exception.description,
            required_evidence: exception.required_evidence.join("\n"),
          }))
        : [{ description: "", required_evidence: "" }],
  };
}

function buildScopeFromDraft(scope: ScopeDraft): Scope {
  return {
    country: normalizeOptionalString(scope.country),
    expense_category: normalizeOptionalString(scope.expense_category),
    travel_type: normalizeOptionalString(scope.travel_type),
    employee_group: normalizeOptionalString(scope.employee_group),
    effective_start_date: normalizeOptionalString(scope.effective_start_date),
    effective_end_date: normalizeOptionalString(scope.effective_end_date),
  };
}

function buildConditionFromDraft(condition: ConditionDraft): RuleCondition | null {
  const field = normalizeRequiredString(condition.field);
  const operator = normalizeRequiredString(condition.operator);
  const value = normalizeRequiredString(condition.value);

  if (!field && !operator && !value) {
    return null;
  }

  return {
    field,
    operator,
    value,
  } as RuleCondition;
}

function buildApplicabilityFromDraft(applicability: ApplicabilityDraft): Applicability | null {
  const unit = normalizeRequiredString(applicability.unit);
  const currency = normalizeOptionalString(applicability.currency);
  const limit_basis = normalizeOptionalString(applicability.limit_basis);

  if (!applicability.aggregation_period && !unit && !currency && !limit_basis) {
    return null;
  }

  return {
    aggregation_period: applicability.aggregation_period as AggregationPeriod,
    unit,
    currency,
    limit_basis,
  } as Applicability;
}

function buildExceptionsFromDraft(exceptions: ExceptionDraft[]): RuleException[] {
  return exceptions
    .map((exception) => ({
      description: normalizeRequiredString(exception.description),
      required_evidence: exception.required_evidence
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    }))
    .filter(
      (exception) =>
        exception.description.length > 0 || exception.required_evidence.length > 0,
    ) as RuleException[];
}

function normalizeExceptionPayload(exceptions: RuleException[]): RuleException[] {
  return exceptions.map((exception) => ({
    description: normalizeRequiredString(exception.description),
    required_evidence: exception.required_evidence.map((item) => item.trim()).filter(Boolean),
  }));
}

function areEqual<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildUpdatePayload(
  draft: RuleDraft,
  currentRule: CandidateRuleValue,
): CandidateRuleReviewUpdateRequest {
  const payload: CandidateRuleReviewUpdateRequest = {};
  const statement = draft.statement.trim();
  const scope = buildScopeFromDraft(draft.scope);
  const condition = buildConditionFromDraft(draft.condition);
  const applicability = buildApplicabilityFromDraft(draft.applicability);
  const exceptions = buildExceptionsFromDraft(draft.exceptions);

  if (statement !== currentRule.statement) {
    payload.statement = statement;
  }

  if (draft.enforceability_class !== currentRule.enforceability_class) {
    payload.enforceability_class = draft.enforceability_class;
  }

  if (!areEqual(scope, currentRule.scope)) {
    payload.scope = scope;
  }

  if (!areEqual(condition, currentRule.condition)) {
    payload.condition = condition;
  }

  if (!areEqual(applicability, currentRule.applicability)) {
    payload.applicability = applicability;
  }

  if (!areEqual(normalizeExceptionPayload(exceptions), normalizeExceptionPayload(currentRule.exceptions))) {
    payload.exceptions = exceptions;
  }

  return payload;
}

function displayValue(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : "Not set";
}

function formatAggregationPeriod(value: AggregationPeriod | "" | null): string {
  if (!value) {
    return "Not set";
  }
  return value.replaceAll("_", " ");
}

function countDifferences(review: CandidateRuleReview, draft: RuleDraft): number {
  let count = 0;

  if (draft.statement.trim() !== review.extracted_rule.statement) {
    count += 1;
  }
  if (draft.enforceability_class !== review.extracted_rule.enforceability_class) {
    count += 1;
  }

  for (const field of SCOPE_FIELDS) {
    if (
      normalizeOptionalString(draft.scope[field.key]) !== review.extracted_rule.scope[field.key]
    ) {
      count += 1;
    }
  }

  if (
    !areEqual(buildConditionFromDraft(draft.condition), review.extracted_rule.condition)
  ) {
    count += 1;
  }

  if (
    !areEqual(
      buildApplicabilityFromDraft(draft.applicability),
      review.extracted_rule.applicability,
    )
  ) {
    count += 1;
  }

  if (
    !areEqual(
      normalizeExceptionPayload(buildExceptionsFromDraft(draft.exceptions)),
      normalizeExceptionPayload(review.extracted_rule.exceptions),
    )
  ) {
    count += 1;
  }

  return count;
}

function RedlineField({
  currentLabel,
  extractedValue,
  changed,
  inputId,
  children,
  description,
}: RedlineFieldProps) {
  return (
    <div className={`review-redline-field${changed ? " changed" : ""}`}>
      <div className="review-redline-field-head">
        <span className="review-redline-title">{currentLabel}</span>
        <span className={`review-redline-badge${changed ? " changed" : ""}`}>
          {changed ? "Changed from extracted" : "Matches extracted"}
        </span>
      </div>
      <div className="review-redline-compare">
        <div className="review-redline-source">
          <span className="review-redline-caption">Extracted</span>
          <div className="review-redline-source-value">{extractedValue}</div>
        </div>
        <div className="review-redline-current">
          <label htmlFor={inputId}>{currentLabel}</label>
          {children}
          {description ? <p className="review-redline-description">{description}</p> : null}
        </div>
      </div>
    </div>
  );
}

export default function CandidateRuleDetail({
  candidateRuleId,
  principal,
  onBack,
  onReviewChange,
}: CandidateRuleDetailProps) {
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [review, setReview] = useState<CandidateRuleReview | null>(null);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const canEdit = hasAnyRole(principal, EDITOR_ROLES);

  const loadReview = useCallback(async (): Promise<void> => {
    setStatus("loading");
    setErrorMessage(null);
    setSaveMessage(null);

    try {
      const response = await fetchCandidateRule(candidateRuleId);
      setReview(response);
      setDraft(createRuleDraft(response.current_rule));
      setStatus("ready");
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 404) {
        setReview(null);
        setDraft(null);
        setStatus("not_found");
        return;
      }
      setErrorMessage(
        describeCandidateRuleError(error, "Unable to load Candidate Rule details."),
      );
      setReview(null);
      setDraft(null);
      setStatus("error");
    }
  }, [candidateRuleId]);

  useEffect(() => {
    void loadReview();
  }, [loadReview]);

  const updatePayload = useMemo(() => {
    if (!review || !draft) {
      return {};
    }
    return buildUpdatePayload(draft, review.current_rule);
  }, [draft, review]);

  const unsavedChangeCount = Object.keys(updatePayload).length;
  const differenceCount = review && draft ? countDifferences(review, draft) : 0;

  function clearFeedback(): void {
    if (errorMessage !== null) {
      setErrorMessage(null);
    }
    if (saveMessage !== null) {
      setSaveMessage(null);
    }
  }

  function updateDraftState(nextDraft: RuleDraft): void {
    clearFeedback();
    setDraft(nextDraft);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!review || !draft || !canEdit || unsavedChangeCount === 0) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSaveMessage(null);

    try {
      const updatedReview = await updateCandidateRule(candidateRuleId, updatePayload);
      setReview(updatedReview);
      setDraft(createRuleDraft(updatedReview.current_rule));
      setSaveMessage("Candidate Rule moved to in review.");
      onReviewChange?.(updatedReview);
    } catch (error: unknown) {
      setErrorMessage(
        describeCandidateRuleError(error, "Unable to save Candidate Rule edits."),
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="review-detail content-enter">
        <p className="catalog-status compact">
          <span className="catalog-status-rule" aria-hidden="true" />
          Opening Candidate Rule edit desk…
        </p>
      </div>
    );
  }

  if (status === "not_found") {
    return (
      <div className="review-detail content-enter">
        <div className="review-not-found reveal">
          <span className="folio">Candidate Rule edit desk · missing</span>
          <p>No Candidate Rule exists for <code>{candidateRuleId}</code>.</p>
        </div>
      </div>
    );
  }

  if (status === "error" || review === null || draft === null) {
    return (
      <div className="review-detail content-enter">
        <p className="error-banner">{errorMessage}</p>
      </div>
    );
  }

  const lifecycleClass = lifecycleStateClassName(review.lifecycle_state);
  const extractedCondition = review.extracted_rule.condition;
  const extractedApplicability = review.extracted_rule.applicability;
  const saveDisabled = !canEdit || isSaving || unsavedChangeCount === 0;
  const hasCommittedEdits = review.committed_rule !== null;

  return (
    <div className="review-detail content-enter">
      <header className="review-detail-head">
        <div className="review-detail-head-row">
          <div className="review-detail-intro">
            <span className="folio">Candidate Rule edit desk</span>
            <h3>{review.candidate_rule_id}</h3>
            <p className="review-detail-lede">{draft.statement || review.current_rule.statement}</p>
          </div>
          <div className="review-detail-badges">
            <span className={`review-lifecycle ${lifecycleClass}`}>
              {formatLifecycleState(review.lifecycle_state)}
            </span>
            <span className={`review-enforceability ${review.current_rule.enforceability_class}`}>
              {formatEnforceabilityClass(review.current_rule.enforceability_class)}
            </span>
            <span
              className={`review-qa-count${review.qa_flags.length > 0 ? " flagged" : " clear"}`}
            >
              {review.qa_flags.length} QA flag{review.qa_flags.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div className="review-detail-toolbar">
          {onBack ? (
            <button type="button" className="detail-back inline" onClick={onBack}>
              Clear selection
            </button>
          ) : null}
          <p className="review-edit-ledger">
            {differenceCount} field{differenceCount === 1 ? "" : "s"} diverge from extracted values.
          </p>
          <p className="review-edit-ledger">
            {unsavedChangeCount} unsaved change{unsavedChangeCount === 1 ? "" : "s"}.
          </p>
        </div>
      </header>

      {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
      {saveMessage ? <p className="review-save-banner">{saveMessage}</p> : null}

      <div className="review-detail-stage">
        <form className="review-edit-form" onSubmit={handleSave}>
          <section className="review-detail-panel reveal">
            <h4>Rule body</h4>
            <RedlineField
              currentLabel="Current statement"
              extractedValue={review.extracted_rule.statement}
              changed={draft.statement.trim() !== review.extracted_rule.statement}
              inputId="candidate-rule-statement"
            >
              <textarea
                id="candidate-rule-statement"
                value={draft.statement}
                disabled={!canEdit || isSaving}
                rows={4}
                onChange={(event) =>
                  updateDraftState({
                    ...draft,
                    statement: event.target.value,
                  })
                }
              />
            </RedlineField>

            <RedlineField
              currentLabel="Current enforceability class"
              extractedValue={formatEnforceabilityClass(review.extracted_rule.enforceability_class)}
              changed={draft.enforceability_class !== review.extracted_rule.enforceability_class}
              inputId="candidate-rule-enforceability"
              description="If you switch away from enforceable, clear the machine-checkable condition before saving."
            >
              <select
                id="candidate-rule-enforceability"
                value={draft.enforceability_class}
                disabled={!canEdit || isSaving}
                onChange={(event) =>
                  updateDraftState({
                    ...draft,
                    enforceability_class: event.target.value as EnforceabilityClass,
                  })
                }
              >
                {ENFORCEABILITY_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {formatEnforceabilityClass(value)}
                  </option>
                ))}
              </select>
            </RedlineField>
          </section>

          <section
            className="review-detail-panel reveal"
            style={{ "--reveal-delay": "40ms" } as CSSProperties}
          >
            <h4>Scope</h4>
            <div className="review-redline-grid">
              {SCOPE_FIELDS.map((field) => (
                <RedlineField
                  key={field.key}
                  currentLabel={field.currentLabel}
                  extractedValue={displayValue(review.extracted_rule.scope[field.key])}
                  changed={
                    normalizeOptionalString(draft.scope[field.key]) !==
                    review.extracted_rule.scope[field.key]
                  }
                  inputId={`candidate-rule-${field.key}`}
                >
                  <input
                    id={`candidate-rule-${field.key}`}
                    value={draft.scope[field.key]}
                    disabled={!canEdit || isSaving}
                    spellCheck={false}
                    placeholder={field.caption}
                    onChange={(event) =>
                      updateDraftState({
                        ...draft,
                        scope: {
                          ...draft.scope,
                          [field.key]: event.target.value,
                        },
                      })
                    }
                  />
                </RedlineField>
              ))}
            </div>
          </section>

          <section
            className="review-detail-panel reveal"
            style={{ "--reveal-delay": "80ms" } as CSSProperties}
          >
            <h4>Machine-checkable shape</h4>
            <div className="review-redline-grid">
              <RedlineField
                currentLabel="Current condition field"
                extractedValue={displayValue(extractedCondition?.field)}
                changed={draft.condition.field.trim() !== (extractedCondition?.field ?? "")}
                inputId="candidate-rule-condition-field"
              >
                <input
                  id="candidate-rule-condition-field"
                  value={draft.condition.field}
                  disabled={!canEdit || isSaving}
                  spellCheck={false}
                  placeholder="meal.amount"
                  onChange={(event) =>
                    updateDraftState({
                      ...draft,
                      condition: {
                        ...draft.condition,
                        field: event.target.value,
                      },
                    })
                  }
                />
              </RedlineField>

              <RedlineField
                currentLabel="Current condition operator"
                extractedValue={displayValue(extractedCondition?.operator)}
                changed={draft.condition.operator.trim() !== (extractedCondition?.operator ?? "")}
                inputId="candidate-rule-condition-operator"
              >
                <input
                  id="candidate-rule-condition-operator"
                  value={draft.condition.operator}
                  disabled={!canEdit || isSaving}
                  spellCheck={false}
                  placeholder="<="
                  onChange={(event) =>
                    updateDraftState({
                      ...draft,
                      condition: {
                        ...draft.condition,
                        operator: event.target.value,
                      },
                    })
                  }
                />
              </RedlineField>

              <RedlineField
                currentLabel="Current condition value"
                extractedValue={displayValue(extractedCondition?.value)}
                changed={draft.condition.value.trim() !== (extractedCondition?.value ?? "")}
                inputId="candidate-rule-condition-value"
              >
                <input
                  id="candidate-rule-condition-value"
                  value={draft.condition.value}
                  disabled={!canEdit || isSaving}
                  spellCheck={false}
                  placeholder="75"
                  onChange={(event) =>
                    updateDraftState({
                      ...draft,
                      condition: {
                        ...draft.condition,
                        value: event.target.value,
                      },
                    })
                  }
                />
              </RedlineField>

              <RedlineField
                currentLabel="Current aggregation period"
                extractedValue={formatAggregationPeriod(extractedApplicability?.aggregation_period ?? null)}
                changed={
                  draft.applicability.aggregation_period !==
                  (extractedApplicability?.aggregation_period ?? "")
                }
                inputId="candidate-rule-aggregation-period"
              >
                <select
                  id="candidate-rule-aggregation-period"
                  value={draft.applicability.aggregation_period}
                  disabled={!canEdit || isSaving}
                  onChange={(event) =>
                    updateDraftState({
                      ...draft,
                      applicability: {
                        ...draft.applicability,
                        aggregation_period: event.target.value as AggregationPeriod | "",
                      },
                    })
                  }
                >
                  <option value="">Not set</option>
                  {AGGREGATION_PERIOD_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {formatAggregationPeriod(value)}
                    </option>
                  ))}
                </select>
              </RedlineField>

              <RedlineField
                currentLabel="Current applicability unit"
                extractedValue={displayValue(extractedApplicability?.unit)}
                changed={draft.applicability.unit.trim() !== (extractedApplicability?.unit ?? "")}
                inputId="candidate-rule-applicability-unit"
              >
                <input
                  id="candidate-rule-applicability-unit"
                  value={draft.applicability.unit}
                  disabled={!canEdit || isSaving}
                  spellCheck={false}
                  placeholder="money"
                  onChange={(event) =>
                    updateDraftState({
                      ...draft,
                      applicability: {
                        ...draft.applicability,
                        unit: event.target.value,
                      },
                    })
                  }
                />
              </RedlineField>

              <RedlineField
                currentLabel="Current applicability currency"
                extractedValue={displayValue(extractedApplicability?.currency)}
                changed={
                  normalizeOptionalString(draft.applicability.currency) !==
                  extractedApplicability?.currency
                }
                inputId="candidate-rule-applicability-currency"
              >
                <input
                  id="candidate-rule-applicability-currency"
                  value={draft.applicability.currency}
                  disabled={!canEdit || isSaving}
                  spellCheck={false}
                  placeholder="USD"
                  onChange={(event) =>
                    updateDraftState({
                      ...draft,
                      applicability: {
                        ...draft.applicability,
                        currency: event.target.value,
                      },
                    })
                  }
                />
              </RedlineField>

              <RedlineField
                currentLabel="Current applicability limit basis"
                extractedValue={displayValue(extractedApplicability?.limit_basis)}
                changed={
                  normalizeOptionalString(draft.applicability.limit_basis) !==
                  extractedApplicability?.limit_basis
                }
                inputId="candidate-rule-applicability-limit-basis"
              >
                <input
                  id="candidate-rule-applicability-limit-basis"
                  value={draft.applicability.limit_basis}
                  disabled={!canEdit || isSaving}
                  spellCheck={false}
                  placeholder="per employee"
                  onChange={(event) =>
                    updateDraftState({
                      ...draft,
                      applicability: {
                        ...draft.applicability,
                        limit_basis: event.target.value,
                      },
                    })
                  }
                />
              </RedlineField>
            </div>
          </section>

          <section
            className="review-detail-panel reveal"
            style={{ "--reveal-delay": "120ms" } as CSSProperties}
          >
            <div className="review-detail-section-head">
              <h4>Exceptions</h4>
              <button
                type="button"
                className="review-secondary-button"
                disabled={!canEdit || isSaving}
                onClick={() =>
                  updateDraftState({
                    ...draft,
                    exceptions: [...draft.exceptions, { description: "", required_evidence: "" }],
                  })
                }
              >
                Add exception
              </button>
            </div>

            <div className="review-exceptions">
              {draft.exceptions.map((exception, index) => {
                const extractedException = review.extracted_rule.exceptions[index];
                const changed = !areEqual(
                  buildExceptionsFromDraft([exception])[0] ?? null,
                  extractedException ?? null,
                );

                return (
                  <div
                    key={`${review.candidate_rule_id}-exception-${index}`}
                    className={`review-exception-card${changed ? " changed" : ""}`}
                  >
                    <div className="review-redline-field-head">
                      <span className="review-redline-title">
                        Exception {index + 1}
                      </span>
                      <span className={`review-redline-badge${changed ? " changed" : ""}`}>
                        {changed ? "Changed from extracted" : "Matches extracted"}
                      </span>
                    </div>

                    <div className="review-exception-grid">
                      <div className="review-redline-source">
                        <span className="review-redline-caption">Extracted</span>
                        <div className="review-redline-source-value">
                          <p>{displayValue(extractedException?.description)}</p>
                          <p className="review-exception-evidence">
                            {extractedException?.required_evidence.length
                              ? extractedException.required_evidence.join(", ")
                              : "No required evidence"}
                          </p>
                        </div>
                      </div>

                      <div className="review-redline-current">
                        <label htmlFor={`candidate-rule-exception-description-${index}`}>
                          Current exception description
                        </label>
                        <textarea
                          id={`candidate-rule-exception-description-${index}`}
                          rows={3}
                          value={exception.description}
                          disabled={!canEdit || isSaving}
                          onChange={(event) =>
                            updateDraftState({
                              ...draft,
                              exceptions: draft.exceptions.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, description: event.target.value }
                                  : item,
                              ),
                            })
                          }
                        />

                        <label htmlFor={`candidate-rule-exception-evidence-${index}`}>
                          Current required evidence
                        </label>
                        <textarea
                          id={`candidate-rule-exception-evidence-${index}`}
                          rows={3}
                          value={exception.required_evidence}
                          disabled={!canEdit || isSaving}
                          placeholder="One evidence item per line"
                          onChange={(event) =>
                            updateDraftState({
                              ...draft,
                              exceptions: draft.exceptions.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, required_evidence: event.target.value }
                                  : item,
                              ),
                            })
                          }
                        />

                        <div className="review-exception-actions">
                          <button
                            type="button"
                            className="review-secondary-button"
                            disabled={!canEdit || isSaving || draft.exceptions.length === 1}
                            onClick={() =>
                              updateDraftState({
                                ...draft,
                                exceptions: draft.exceptions.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              })
                            }
                          >
                            Remove exception
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <footer
            className="review-save-rail reveal"
            style={{ "--reveal-delay": "160ms" } as CSSProperties}
          >
            <div>
              <span className="review-save-kicker">
                {canEdit ? "Approver access" : "Viewer access"}
              </span>
              <p className="review-save-note">
                {canEdit
                  ? "Saving preserves the extracted Rule and records the reviewed values as the current Candidate Rule."
                  : "Viewer role can inspect extracted and current values but cannot save Candidate Rule edits."}
              </p>
            </div>
            <button type="submit" className="review-save-button" disabled={saveDisabled}>
              {isSaving ? "Saving…" : "Save Candidate Rule"}
            </button>
          </footer>
        </form>

        <aside className="review-detail-rail">
          <section className="review-detail-panel reveal" style={{ "--reveal-delay": "30ms" } as CSSProperties}>
            <h4>Provenance</h4>
            <dl className="review-detail-grid">
              <div>
                <dt>Extraction run</dt>
                <dd>{review.current_rule.origin.extraction_run_id ?? "—"}</dd>
              </div>
              <div>
                <dt>Principal</dt>
                <dd>{principal.subject}</dd>
              </div>
              {review.current_rule.citation ? (
                <>
                  <div>
                    <dt>Document</dt>
                    <dd>{review.current_rule.citation.document_id}</dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd>{review.current_rule.citation.document_version_id}</dd>
                  </div>
                  <div className="review-detail-span">
                    <dt>Citation</dt>
                    <dd>
                      <blockquote className="review-citation-quote">
                        {review.current_rule.citation.quote}
                      </blockquote>
                      <p className="review-citation-meta">
                        {review.current_rule.citation.section_id} · chars{" "}
                        {review.current_rule.citation.start_char}–
                        {review.current_rule.citation.end_char}
                      </p>
                    </dd>
                  </div>
                </>
              ) : (
                <div className="review-detail-span">
                  <dt>Citation</dt>
                  <dd>None attached</dd>
                </div>
              )}
            </dl>
          </section>

          <section
            className="review-detail-panel reveal"
            style={{ "--reveal-delay": "60ms" } as CSSProperties}
          >
            <h4>QA Flags</h4>
            {review.qa_flags.length === 0 ? (
              <p className="review-detail-empty">No QA Flags recorded for this Candidate Rule.</p>
            ) : (
              <ul className="review-qa-list">
                {review.qa_flags.map((flag) => (
                  <li key={`${flag.code}-${flag.detail}`}>
                    <span className="review-qa-code">{formatQAFlagCode(flag.code)}</span>
                    <p>{flag.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            className="review-detail-panel reveal"
            style={{ "--reveal-delay": "90ms" } as CSSProperties}
          >
            <h4>Review lineage</h4>
            <p className="review-detail-note">
              {hasCommittedEdits
                ? "Committed edits remain separate from the extracted Candidate Rule for auditability."
                : "No committed edits yet. Saving will preserve the extracted Rule and create a reviewed value set."}
            </p>
            {hasCommittedEdits ? (
              <dl className="review-detail-grid">
                <div className="review-detail-span">
                  <dt>Extracted statement</dt>
                  <dd>{review.extracted_rule.statement}</dd>
                </div>
                <div className="review-detail-span">
                  <dt>Current statement</dt>
                  <dd>{review.current_rule.statement}</dd>
                </div>
              </dl>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
