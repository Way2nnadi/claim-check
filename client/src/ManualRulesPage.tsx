import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError, createManualRule } from "./api";
import { formatEnforceabilityClass } from "./candidateRuleFormat";
import { hasAnyRole } from "./permissions";
import {
  describeRuleOrigin,
  summarizeApplicability,
  summarizeRuleScope,
} from "./policyVersionFormat";
import SearchablePicker from "./SearchablePicker";
import type {
  AggregationPeriod,
  Applicability,
  AuthenticatedPrincipal,
  EnforceabilityClass,
  ManualRuleCreateRequest,
  Rule,
  RuleCondition,
  RuleException,
  Scope,
} from "./types";

interface ManualRulesPageProps {
  principal: AuthenticatedPrincipal;
}

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

interface CitationDraft {
  document_id: string;
  document_version_id: string;
  section_id: string;
  quote: string;
  start_char: string;
  end_char: string;
}

interface ManualRuleDraft {
  rule_id: string;
  statement: string;
  enforceability_class: EnforceabilityClass;
  rationale: string;
  scope: ScopeDraft;
  condition: ConditionDraft;
  applicability: ApplicabilityDraft;
  exceptions: ExceptionDraft[];
  citation: CitationDraft;
}

type ValidationErrors = Record<string, string>;

const AUTHOR_ROLES = ["admin", "approver"] as const;

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

function formatAggregationPeriod(value: AggregationPeriod | ""): string {
  if (!value) {
    return "Not set";
  }
  return value.replaceAll("_", " ");
}

const OPERATOR_OPTIONS = ["<=", "<", "==", ">=", ">"] as const;

const ENFORCEABILITY_PICKER_OPTIONS = ENFORCEABILITY_OPTIONS.map((value) => ({
  value,
  label: formatEnforceabilityClass(value),
}));

const AGGREGATION_PERIOD_PICKER_OPTIONS = [
  { value: "", label: "Not set" },
  ...AGGREGATION_PERIOD_OPTIONS.map((value) => ({
    value,
    label: formatAggregationPeriod(value),
  })),
];

const OPERATOR_PICKER_OPTIONS = OPERATOR_OPTIONS.map((value) => ({
  value,
  label: value,
}));

const SCOPE_FIELDS: ReadonlyArray<{
  key: keyof ScopeDraft;
  label: string;
  placeholder: string;
}> = [
  { key: "country", label: "Country", placeholder: "Country" },
  { key: "expense_category", label: "Expense category", placeholder: "Expense category" },
  { key: "travel_type", label: "Travel type", placeholder: "Travel type" },
  { key: "employee_group", label: "Employee group", placeholder: "Employee group" },
  {
    key: "effective_start_date",
    label: "Effective start",
    placeholder: "YYYY-MM-DD",
  },
  {
    key: "effective_end_date",
    label: "Effective end",
    placeholder: "YYYY-MM-DD",
  },
];

interface ManualFieldProps {
  label: string;
  inputId: string;
  error?: string;
  description?: string;
  children: ReactNode;
}

function ManualField({
  label,
  inputId,
  error,
  description,
  children,
}: ManualFieldProps) {
  return (
    <div className="review-field">
      <label htmlFor={inputId}>{label}</label>
      {children}
      {error ? <p className="review-field-error">{error}</p> : null}
      {description ? <p className="review-field-description">{description}</p> : null}
    </div>
  );
}

function createEmptyDraft(): ManualRuleDraft {
  return {
    rule_id: "",
    statement: "",
    enforceability_class: "enforceable",
    rationale: "",
    scope: {
      country: "",
      expense_category: "",
      travel_type: "",
      employee_group: "",
      effective_start_date: "",
      effective_end_date: "",
    },
    condition: {
      field: "",
      operator: "<=",
      value: "",
    },
    applicability: {
      aggregation_period: "",
      unit: "",
      currency: "",
      limit_basis: "",
    },
    exceptions: [{ description: "", required_evidence: "" }],
    citation: {
      document_id: "",
      document_version_id: "",
      section_id: "",
      quote: "",
      start_char: "",
      end_char: "",
    },
  };
}

function normalizeRequiredString(value: string): string {
  return value.trim();
}

function normalizeOptionalString(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCurrencyInput(value: string): string {
  return value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3);
}

function buildScope(scope: ScopeDraft): Scope {
  return {
    country: normalizeOptionalString(scope.country),
    expense_category: normalizeOptionalString(scope.expense_category),
    travel_type: normalizeOptionalString(scope.travel_type),
    employee_group: normalizeOptionalString(scope.employee_group),
    effective_start_date: normalizeOptionalString(scope.effective_start_date),
    effective_end_date: normalizeOptionalString(scope.effective_end_date),
  };
}

function buildCondition(condition: ConditionDraft): RuleCondition {
  return {
    field: normalizeRequiredString(condition.field),
    operator: normalizeRequiredString(condition.operator),
    value: normalizeRequiredString(condition.value),
  };
}

function buildApplicability(applicability: ApplicabilityDraft): Applicability | undefined {
  const unit = normalizeRequiredString(applicability.unit);
  const currency = normalizeCurrencyInput(applicability.currency);
  const limit_basis = normalizeOptionalString(applicability.limit_basis);

  if (!applicability.aggregation_period && !unit && !currency && !limit_basis) {
    return undefined;
  }

  if (!applicability.aggregation_period || !unit) {
    return undefined;
  }

  return {
    aggregation_period: applicability.aggregation_period,
    unit,
    currency: currency || null,
    limit_basis,
  };
}

function buildExceptions(exceptions: ExceptionDraft[]): RuleException[] {
  return exceptions
    .map((exception) => ({
      description: normalizeRequiredString(exception.description),
      required_evidence: exception.required_evidence
        .split(/[\n,]/u)
        .map((item) => item.trim())
        .filter(Boolean),
    }))
    .filter((exception) => exception.description.length > 0);
}

function buildValidationErrors(draft: ManualRuleDraft): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!normalizeRequiredString(draft.rule_id)) {
    errors.rule_id = "Rule ID is required.";
  }
  if (!normalizeRequiredString(draft.statement)) {
    errors.statement = "Statement is required.";
  }
  if (!normalizeRequiredString(draft.rationale)) {
    errors.rationale = "Rationale is required.";
  }

  if (draft.enforceability_class === "enforceable") {
    if (!normalizeRequiredString(draft.condition.field)) {
      errors.condition_field = "Condition field is required for enforceable Rules.";
    }
    if (!normalizeRequiredString(draft.condition.operator)) {
      errors.condition_operator = "Operator is required for enforceable Rules.";
    }
    if (!normalizeRequiredString(draft.condition.value)) {
      errors.condition_value = "Threshold value is required for enforceable Rules.";
    }
  }

  const applicabilityTouched =
    Boolean(draft.applicability.aggregation_period) ||
    Boolean(normalizeRequiredString(draft.applicability.unit)) ||
    Boolean(normalizeCurrencyInput(draft.applicability.currency)) ||
    Boolean(normalizeRequiredString(draft.applicability.limit_basis));

  if (applicabilityTouched && !normalizeRequiredString(draft.applicability.unit)) {
    errors.applicability_unit = "Unit is required when Applicability is provided.";
  }
  if (applicabilityTouched && !draft.applicability.aggregation_period) {
    errors.applicability_aggregation_period =
      "Aggregation period is required when Applicability is provided.";
  }

  const citationTouched = Object.values(draft.citation).some((value) =>
    normalizeRequiredString(value).length > 0,
  );

  if (citationTouched) {
    if (!normalizeRequiredString(draft.citation.document_id)) {
      errors.citation_document_id = "Citation document ID is required.";
    }
    if (!normalizeRequiredString(draft.citation.document_version_id)) {
      errors.citation_document_version_id = "Citation Document Version is required.";
    }
    if (!normalizeRequiredString(draft.citation.section_id)) {
      errors.citation_section_id = "Citation section ID is required.";
    }
    if (!normalizeRequiredString(draft.citation.quote)) {
      errors.citation_quote = "Citation quote is required.";
    }

    const startChar = Number(draft.citation.start_char);
    const endChar = Number(draft.citation.end_char);

    if (!normalizeRequiredString(draft.citation.start_char)) {
      errors.citation_start_char = "Citation start character is required.";
    } else if (!Number.isInteger(startChar) || startChar < 0) {
      errors.citation_start_char = "Citation start character must be zero or greater.";
    }

    if (!normalizeRequiredString(draft.citation.end_char)) {
      errors.citation_end_char = "Citation end character is required.";
    } else if (!Number.isInteger(endChar) || endChar < 0) {
      errors.citation_end_char = "Citation end character must be zero or greater.";
    } else if (Number.isInteger(startChar) && endChar <= startChar) {
      errors.citation_end_char =
        "Citation end character must be greater than the start character.";
    }
  }

  draft.exceptions.forEach((exception, index) => {
    if (
      normalizeRequiredString(exception.required_evidence).length > 0 &&
      !normalizeRequiredString(exception.description)
    ) {
      errors[`exception_${index}`] =
        "Exception description is required when required evidence is listed.";
    }
  });

  return errors;
}

function buildRequest(draft: ManualRuleDraft): ManualRuleCreateRequest {
  const request: ManualRuleCreateRequest = {
    rule_id: normalizeRequiredString(draft.rule_id),
    statement: normalizeRequiredString(draft.statement),
    enforceability_class: draft.enforceability_class,
    rationale: normalizeRequiredString(draft.rationale),
    scope: buildScope(draft.scope),
    exceptions: buildExceptions(draft.exceptions),
  };

  if (draft.enforceability_class === "enforceable") {
    request.condition = buildCondition(draft.condition);
    const applicability = buildApplicability(draft.applicability);
    if (applicability) {
      request.applicability = applicability;
    }
  }

  const citationTouched = Object.values(draft.citation).some((value) =>
    normalizeRequiredString(value).length > 0,
  );
  if (citationTouched) {
    request.citation = {
      document_id: normalizeRequiredString(draft.citation.document_id),
      document_version_id: normalizeRequiredString(draft.citation.document_version_id),
      section_id: normalizeRequiredString(draft.citation.section_id),
      quote: normalizeRequiredString(draft.citation.quote),
      start_char: Number(draft.citation.start_char),
      end_char: Number(draft.citation.end_char),
    };
  }

  return request;
}

function describeManualRuleError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    if (error instanceof Error) {
      return error.message;
    }
    return "Unable to create the Manual Rule.";
  }

  if (error.status === 401) {
    return "Sign in again before creating a Manual Rule.";
  }
  if (error.status === 403) {
    return "Only an Approver or admin can create a Manual Rule.";
  }
  if (error.status === 409) {
    return "That Rule ID already exists. Use a new Rule ID.";
  }

  return error.message || "Unable to create the Manual Rule.";
}

export default function ManualRulesPage({ principal }: ManualRulesPageProps) {
  const [draft, setDraft] = useState<ManualRuleDraft>(() => createEmptyDraft());
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [createdRule, setCreatedRule] = useState<Rule | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canCreate = hasAnyRole(principal, AUTHOR_ROLES);
  const isEnforceable = draft.enforceability_class === "enforceable";

  function updateScopeField(key: keyof ScopeDraft, value: string): void {
    setDraft((current) => ({
      ...current,
      scope: {
        ...current.scope,
        [key]: value,
      },
    }));
  }

  function updateCitationField(key: keyof CitationDraft, value: string): void {
    setDraft((current) => ({
      ...current,
      citation: {
        ...current.citation,
        [key]: value,
      },
    }));
  }

  function updateException(
    index: number,
    key: keyof ExceptionDraft,
    value: string,
  ): void {
    setDraft((current) => ({
      ...current,
      exceptions: current.exceptions.map((exception, exceptionIndex) =>
        exceptionIndex === index ? { ...exception, [key]: value } : exception,
      ),
    }));
  }

  function addException(): void {
    setDraft((current) => ({
      ...current,
      exceptions: [...current.exceptions, { description: "", required_evidence: "" }],
    }));
  }

  function removeException(index: number): void {
    setDraft((current) => ({
      ...current,
      exceptions:
        current.exceptions.length === 1
          ? [{ description: "", required_evidence: "" }]
          : current.exceptions.filter((_, exceptionIndex) => exceptionIndex !== index),
    }));
  }

  function handleEnforceabilityChange(nextValue: EnforceabilityClass): void {
    setDraft((current) => ({
      ...current,
      enforceability_class: nextValue,
      condition:
        nextValue === "enforceable"
          ? current.condition
          : { field: "", operator: "<=", value: "" },
      applicability:
        nextValue === "enforceable"
          ? current.applicability
          : {
              aggregation_period: "",
              unit: "",
              currency: "",
              limit_basis: "",
            },
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!canCreate) {
      return;
    }

    const nextErrors = buildValidationErrors(draft);
    setValidationErrors(nextErrors);
    setSubmitError(null);
    setSuccessMessage(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      const created = await createManualRule(buildRequest(draft));
      setCreatedRule(created);
      setSuccessMessage("Manual Rule created and approved.");
      setValidationErrors({});
      setDraft(createEmptyDraft());
    } catch (error: unknown) {
      setSubmitError(describeManualRuleError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  const previewRule = createdRule;

  return (
    <div className="review-detail content-enter">
      <div className="catalog-toolbar">
        <p className="catalog-scope">
          Author a rule when policy knowledge exists before the document catches up.
          Rationale is required; citation and exceptions are optional.
        </p>
        <button
          type="submit"
          form="manual-rule-form"
          className="document-command"
          disabled={!canCreate || isSubmitting}
        >
          {isSubmitting ? "Creating…" : "Create Manual Rule"}
        </button>
      </div>

      <div className="review-detail-badges">
        <span className="review-enforceability guidance">Human-authored</span>
      </div>

      <div className="review-detail-body">
        {submitError ? (
          <p className="error-banner" role="alert">
            {submitError}
          </p>
        ) : null}
        {successMessage ? (
          <p className="review-save-banner" role="status">
            {successMessage}
          </p>
        ) : null}

        <div className="review-detail-workspace">
          {previewRule ? (
            <section className="review-detail-panel reveal" aria-label="Created rule">
              <h4>Latest result</h4>
              <dl className="review-detail-grid">
                <div className="review-detail-span">
                  <dt>Statement</dt>
                  <dd>{previewRule.statement}</dd>
                </div>
                <div>
                  <dt>Rule ID</dt>
                  <dd>{previewRule.rule_id}</dd>
                </div>
                <div>
                  <dt>Scope</dt>
                  <dd>{summarizeRuleScope(previewRule.scope)}</dd>
                </div>
                <div>
                  <dt>Origin</dt>
                  <dd>{describeRuleOrigin(previewRule)}</dd>
                </div>
                {previewRule.condition ? (
                  <div className="review-detail-span">
                    <dt>Condition</dt>
                    <dd>
                      <code>
                        {previewRule.condition.field} {previewRule.condition.operator}{" "}
                        {previewRule.condition.value}
                      </code>
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt>Rationale</dt>
                  <dd>{previewRule.origin.rationale}</dd>
                </div>
                <div>
                  <dt>Applicability</dt>
                  <dd>{summarizeApplicability(previewRule.applicability)}</dd>
                </div>
                <div>
                  <dt>Citation</dt>
                  <dd>{previewRule.citation ? previewRule.citation.section_id : "None"}</dd>
                </div>
              </dl>
            </section>
          ) : null}

          <form id="manual-rule-form" className="review-edit-form" onSubmit={handleSubmit}>
            <section className="review-detail-panel reveal">
              <ManualField label="Rule ID" inputId="manual-rule-id" error={validationErrors.rule_id}>
                <input
                  id="manual-rule-id"
                  name="rule_id"
                  value={draft.rule_id}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, rule_id: event.target.value }))
                  }
                  placeholder="rule-manual-offsite-dinner-cap"
                  disabled={!canCreate || isSubmitting}
                  spellCheck={false}
                />
              </ManualField>

              <ManualField
                label="Statement"
                inputId="manual-rule-statement"
                error={validationErrors.statement}
              >
                <textarea
                  id="manual-rule-statement"
                  name="statement"
                  value={draft.statement}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, statement: event.target.value }))
                  }
                  rows={4}
                  placeholder="Team offsites may reimburse dinner up to $120 with director approval."
                  disabled={!canCreate || isSubmitting}
                />
              </ManualField>

              <ManualField
                label="Rationale"
                inputId="manual-rule-rationale"
                error={validationErrors.rationale}
                description="Explain why this rule is entering the store manually."
              >
                <textarea
                  id="manual-rule-rationale"
                  name="rationale"
                  value={draft.rationale}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, rationale: event.target.value }))
                  }
                  rows={3}
                  disabled={!canCreate || isSubmitting}
                />
              </ManualField>

              <ManualField
                label="Enforceability"
                inputId="manual-rule-enforceability"
                description={
                  !isEnforceable
                    ? "Guidance and subjective rules route to humans instead of machine checks."
                    : undefined
                }
              >
                <SearchablePicker
                  label="Enforceability"
                  inputId="manual-rule-enforceability"
                  hideLabel
                  value={draft.enforceability_class}
                  options={ENFORCEABILITY_PICKER_OPTIONS}
                  placeholder="Select enforceability class"
                  emptyMessage="No matching classes"
                  disabled={!canCreate || isSubmitting}
                  mono
                  showAllOnOpen
                  onChange={(nextValue) =>
                    handleEnforceabilityChange(nextValue as EnforceabilityClass)
                  }
                />
              </ManualField>
            </section>

            <section className="review-detail-panel reveal">
              <h4>Scope</h4>
              <div className="review-field-grid cols-2">
                {SCOPE_FIELDS.map((field) => (
                  <ManualField key={field.key} label={field.label} inputId={`manual-rule-${field.key}`}>
                    <input
                      id={`manual-rule-${field.key}`}
                      name={field.key}
                      value={draft.scope[field.key]}
                      onChange={(event) => updateScopeField(field.key, event.target.value)}
                      placeholder={field.placeholder}
                      disabled={!canCreate || isSubmitting}
                      spellCheck={false}
                    />
                  </ManualField>
                ))}
              </div>
            </section>

            <section
              className={`review-detail-panel reveal${isEnforceable ? "" : " is-muted"}`}
              aria-disabled={!isEnforceable}
            >
              <h4>Machine-checkable shape</h4>
              {!isEnforceable ? (
                <p className="review-field-description">
                  Guidance and subjective rules route to humans instead of machine checks.
                </p>
              ) : null}
              <div className="review-field-grid cols-3 review-condition-row">
                <ManualField
                  label="Field"
                  inputId="manual-rule-condition-field"
                  error={validationErrors.condition_field}
                >
                  <input
                    id="manual-rule-condition-field"
                    name="condition_field"
                    value={draft.condition.field}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        condition: { ...current.condition, field: event.target.value },
                      }))
                    }
                    placeholder="meal.amount"
                    disabled={!canCreate || isSubmitting || !isEnforceable}
                    spellCheck={false}
                  />
                </ManualField>

                <ManualField
                  label="Operator"
                  inputId="manual-rule-condition-operator"
                  error={validationErrors.condition_operator}
                >
                  <SearchablePicker
                    label="Operator"
                    inputId="manual-rule-condition-operator"
                    hideLabel
                    value={draft.condition.operator}
                    options={OPERATOR_PICKER_OPTIONS}
                    placeholder="Select operator"
                    emptyMessage="No matching operators"
                    disabled={!canCreate || isSubmitting || !isEnforceable}
                    mono
                    showAllOnOpen
                    onChange={(nextValue) =>
                      setDraft((current) => ({
                        ...current,
                        condition: { ...current.condition, operator: nextValue },
                      }))
                    }
                  />
                </ManualField>

                <ManualField
                  label="Value"
                  inputId="manual-rule-condition-value"
                  error={validationErrors.condition_value}
                >
                  <input
                    id="manual-rule-condition-value"
                    name="condition_value"
                    value={draft.condition.value}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        condition: { ...current.condition, value: event.target.value },
                      }))
                    }
                    placeholder="120"
                    disabled={!canCreate || isSubmitting || !isEnforceable}
                    spellCheck={false}
                  />
                </ManualField>
              </div>

              <div className="review-field-grid cols-2 review-applicability-grid">
                <ManualField
                  label="Aggregation period"
                  inputId="manual-rule-aggregation-period"
                  error={validationErrors.applicability_aggregation_period}
                >
                  <SearchablePicker
                    label="Aggregation period"
                    inputId="manual-rule-aggregation-period"
                    hideLabel
                    value={draft.applicability.aggregation_period}
                    options={AGGREGATION_PERIOD_PICKER_OPTIONS}
                    placeholder="Select aggregation period"
                    emptyMessage="No matching periods"
                    disabled={!canCreate || isSubmitting || !isEnforceable}
                    mono
                    showAllOnOpen
                    onChange={(nextValue) =>
                      setDraft((current) => ({
                        ...current,
                        applicability: {
                          ...current.applicability,
                          aggregation_period: nextValue as AggregationPeriod | "",
                        },
                      }))
                    }
                  />
                </ManualField>

                <ManualField
                  label="Unit"
                  inputId="manual-rule-applicability-unit"
                  error={validationErrors.applicability_unit}
                >
                  <input
                    id="manual-rule-applicability-unit"
                    name="applicability_unit"
                    value={draft.applicability.unit}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        applicability: {
                          ...current.applicability,
                          unit: event.target.value,
                        },
                      }))
                    }
                    placeholder="money"
                    disabled={!canCreate || isSubmitting || !isEnforceable}
                    spellCheck={false}
                  />
                </ManualField>

                <ManualField
                  label="Currency"
                  inputId="manual-rule-applicability-currency"
                  description="3-letter ISO code (e.g. USD)."
                >
                  <input
                    id="manual-rule-applicability-currency"
                    name="applicability_currency"
                    value={draft.applicability.currency}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        applicability: {
                          ...current.applicability,
                          currency: normalizeCurrencyInput(event.target.value),
                        },
                      }))
                    }
                    placeholder="USD"
                    maxLength={3}
                    disabled={!canCreate || isSubmitting || !isEnforceable}
                    spellCheck={false}
                  />
                </ManualField>

                <ManualField label="Limit basis" inputId="manual-rule-applicability-limit-basis">
                  <input
                    id="manual-rule-applicability-limit-basis"
                    name="applicability_limit_basis"
                    value={draft.applicability.limit_basis}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        applicability: {
                          ...current.applicability,
                          limit_basis: event.target.value,
                        },
                      }))
                    }
                    placeholder="per employee"
                    disabled={!canCreate || isSubmitting || !isEnforceable}
                    spellCheck={false}
                  />
                </ManualField>
              </div>
            </section>

            <details className="review-detail-meta reveal">
              <summary>Exceptions</summary>
              <div className="review-detail-meta-body">
                <div className="review-detail-section-head">
                  <p className="review-detail-note">Evidence that modifies the rule outcome.</p>
                  <button
                    type="button"
                    className="review-secondary-button compact"
                    onClick={addException}
                    disabled={!canCreate || isSubmitting}
                  >
                    Add exception
                  </button>
                </div>

                <div className="review-exceptions">
                  {draft.exceptions.map((exception, index) => (
                    <article key={index} className="review-exception-card">
                      <div className="review-exception-head">
                        <span className="review-exception-title">Exception {index + 1}</span>
                        <button
                          type="button"
                          className="review-secondary-button compact"
                          onClick={() => removeException(index)}
                          disabled={!canCreate || isSubmitting}
                        >
                          Remove
                        </button>
                      </div>

                      <ManualField
                        label={index === 0 ? "Exception" : `Exception ${index + 1}`}
                        inputId={`manual-rule-exception-${index}`}
                        error={validationErrors[`exception_${index}`]}
                      >
                        <textarea
                          id={`manual-rule-exception-${index}`}
                          value={exception.description}
                          onChange={(event) =>
                            updateException(index, "description", event.target.value)
                          }
                          rows={2}
                          placeholder="Director approval is required."
                          disabled={!canCreate || isSubmitting}
                        />
                      </ManualField>

                      <ManualField
                        label={
                          index === 0 ? "Required evidence" : `Required evidence ${index + 1}`
                        }
                        inputId={`manual-rule-exception-evidence-${index}`}
                      >
                        <textarea
                          id={`manual-rule-exception-evidence-${index}`}
                          value={exception.required_evidence}
                          onChange={(event) =>
                            updateException(index, "required_evidence", event.target.value)
                          }
                          rows={2}
                          placeholder="director_approval"
                          disabled={!canCreate || isSubmitting}
                        />
                      </ManualField>
                    </article>
                  ))}
                </div>
              </div>
            </details>

            <details className="review-detail-meta reveal">
              <summary>Optional citation</summary>
              <div className="review-detail-meta-body">
                <p className="review-detail-note">
                  Anchor the rule when a source section exists.
                </p>
                <div className="review-field-grid cols-2">
                  <ManualField
                    label="Document"
                    inputId="manual-rule-citation-document"
                    error={validationErrors.citation_document_id}
                  >
                    <input
                      id="manual-rule-citation-document"
                      value={draft.citation.document_id}
                      onChange={(event) =>
                        updateCitationField("document_id", event.target.value)
                      }
                      placeholder="expense-policy"
                      disabled={!canCreate || isSubmitting}
                      spellCheck={false}
                    />
                  </ManualField>

                  <ManualField
                    label="Version"
                    inputId="manual-rule-citation-version"
                    error={validationErrors.citation_document_version_id}
                  >
                    <input
                      id="manual-rule-citation-version"
                      value={draft.citation.document_version_id}
                      onChange={(event) =>
                        updateCitationField("document_version_id", event.target.value)
                      }
                      placeholder="docv-2026-06-01"
                      disabled={!canCreate || isSubmitting}
                      spellCheck={false}
                    />
                  </ManualField>

                  <ManualField
                    label="Section"
                    inputId="manual-rule-citation-section"
                    error={validationErrors.citation_section_id}
                  >
                    <input
                      id="manual-rule-citation-section"
                      value={draft.citation.section_id}
                      onChange={(event) =>
                        updateCitationField("section_id", event.target.value)
                      }
                      placeholder="offsites#abc123"
                      disabled={!canCreate || isSubmitting}
                      spellCheck={false}
                    />
                  </ManualField>

                  <ManualField
                    label="Start char"
                    inputId="manual-rule-citation-start"
                    error={validationErrors.citation_start_char}
                  >
                    <input
                      id="manual-rule-citation-start"
                      value={draft.citation.start_char}
                      onChange={(event) =>
                        updateCitationField("start_char", event.target.value)
                      }
                      placeholder="120"
                      disabled={!canCreate || isSubmitting}
                      spellCheck={false}
                    />
                  </ManualField>

                  <ManualField
                    label="End char"
                    inputId="manual-rule-citation-end"
                    error={validationErrors.citation_end_char}
                  >
                    <input
                      id="manual-rule-citation-end"
                      value={draft.citation.end_char}
                      onChange={(event) =>
                        updateCitationField("end_char", event.target.value)
                      }
                      placeholder="191"
                      disabled={!canCreate || isSubmitting}
                      spellCheck={false}
                    />
                  </ManualField>
                </div>

                <ManualField
                  label="Quote"
                  inputId="manual-rule-citation-quote"
                  error={validationErrors.citation_quote}
                >
                  <textarea
                    id="manual-rule-citation-quote"
                    value={draft.citation.quote}
                    onChange={(event) => updateCitationField("quote", event.target.value)}
                    rows={3}
                    disabled={!canCreate || isSubmitting}
                  />
                </ManualField>
              </div>
            </details>

            <footer className="review-save-rail reveal">
              <div>
                <span className="review-save-kicker">
                  {canCreate ? "Approver access" : "Viewer access"}
                </span>
                <p className="review-save-note">
                  Manual rules are committed as approved entries with manual origin.
                </p>
              </div>
            </footer>
          </form>
        </div>
      </div>
    </div>
  );
}
