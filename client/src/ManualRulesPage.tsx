import { useState, type FormEvent } from "react";
import { ApiError, createManualRule } from "./api";
import { formatEnforceabilityClass } from "./candidateRuleFormat";
import { hasAnyRole } from "./permissions";
import {
  describeRuleOrigin,
  summarizeApplicability,
  summarizeRuleScope,
} from "./policyVersionFormat";
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

const SCOPE_FIELDS: ReadonlyArray<{
  key: keyof ScopeDraft;
  label: string;
  placeholder: string;
}> = [
  { key: "country", label: "Country", placeholder: "US" },
  { key: "expense_category", label: "Expense category", placeholder: "meals" },
  { key: "travel_type", label: "Travel type", placeholder: "domestic" },
  { key: "employee_group", label: "Employee group", placeholder: "employees" },
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
    <div className="manual-rules-page content-enter">
      <section className="manual-rules-hero">
        <div className="manual-rules-hero-copy">
          <p className="eyebrow">Manual Override</p>
          <h3>Author a Rule when policy knowledge exists before the Policy Document catches up.</h3>
          <p className="manual-rules-lede">
            Manual Rules enter the Structured Policy Store as approved, human-authored
            decisions. Rationale is mandatory because Citation may be absent.
          </p>
          <div className="manual-origin-strip" aria-label="Manual Rule identity">
            <span className="manual-origin-seal">Human-authored</span>
            <span className="manual-origin-text">Manual origin · approval-ready</span>
          </div>
        </div>
        <div className="manual-rules-ledger">
          <p className="manual-rules-ledger-kicker">Authoring perimeter</p>
          <ul>
            <li>Only an Approver or admin can create a Manual Rule.</li>
            <li>Optional Citation fields can anchor the Rule when a source exists.</li>
            <li>Viewer access remains read-only.</li>
          </ul>
        </div>
      </section>

      <div className="manual-rules-grid">
        <form className="manual-rules-form" onSubmit={handleSubmit}>
          <section className="manual-panel">
            <div className="manual-panel-head">
              <div>
                <p className="manual-panel-kicker">Rule Core</p>
                <h4>Identity, statement, and rationale</h4>
              </div>
              {!canCreate ? (
                <span className="review-detail-readonly-note">Viewer access</span>
              ) : null}
            </div>

            <div className="manual-field-grid manual-field-grid-wide">
              <label className="manual-field">
                <span>Rule ID</span>
                <input
                  name="rule_id"
                  value={draft.rule_id}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, rule_id: event.target.value }))
                  }
                  placeholder="rule-manual-offsite-dinner-cap"
                  disabled={!canCreate || isSubmitting}
                />
                {validationErrors.rule_id ? (
                  <small className="manual-field-error">{validationErrors.rule_id}</small>
                ) : null}
              </label>

              <label className="manual-field">
                <span>Enforceability class</span>
                <select
                  name="enforceability_class"
                  value={draft.enforceability_class}
                  onChange={(event) =>
                    handleEnforceabilityChange(
                      event.target.value as EnforceabilityClass,
                    )
                  }
                  disabled={!canCreate || isSubmitting}
                >
                  {ENFORCEABILITY_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {formatEnforceabilityClass(value)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="manual-field">
              <span>Statement</span>
              <textarea
                name="statement"
                value={draft.statement}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, statement: event.target.value }))
                }
                rows={4}
                placeholder="Team offsites may reimburse dinner up to $120 with director approval."
                disabled={!canCreate || isSubmitting}
              />
              {validationErrors.statement ? (
                <small className="manual-field-error">{validationErrors.statement}</small>
              ) : null}
            </label>

            <label className="manual-field">
              <span>Rationale</span>
              <textarea
                name="rationale"
                value={draft.rationale}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, rationale: event.target.value }))
                }
                rows={4}
                placeholder="Explain why this Rule is entering the Structured Policy Store manually."
                disabled={!canCreate || isSubmitting}
              />
              {validationErrors.rationale ? (
                <small className="manual-field-error">{validationErrors.rationale}</small>
              ) : null}
            </label>
          </section>

          <section className="manual-panel">
            <div className="manual-panel-head">
              <div>
                <p className="manual-panel-kicker">Scope Map</p>
                <h4>Where this Rule applies</h4>
              </div>
            </div>

            <div className="manual-field-grid">
              {SCOPE_FIELDS.map((field) => (
                <label key={field.key} className="manual-field">
                  <span>{field.label}</span>
                  <input
                    name={field.key}
                    value={draft.scope[field.key]}
                    onChange={(event) => updateScopeField(field.key, event.target.value)}
                    placeholder={field.placeholder}
                    disabled={!canCreate || isSubmitting}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="manual-panel">
            <div className="manual-panel-head">
              <div>
                <p className="manual-panel-kicker">Machine Condition</p>
                <h4>Condition and Applicability</h4>
              </div>
              {!isEnforceable ? (
                <span className="manual-panel-note">
                  Guidance and subjective Rules route to humans.
                </span>
              ) : null}
            </div>

            <div className={`manual-machine-grid${isEnforceable ? "" : " is-muted"}`}>
              <div className="manual-condition-row">
                <label className="manual-field">
                  <span>Condition field</span>
                  <input
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
                  />
                  {validationErrors.condition_field ? (
                    <small className="manual-field-error">
                      {validationErrors.condition_field}
                    </small>
                  ) : null}
                </label>

                <label className="manual-field">
                  <span>Operator</span>
                  <select
                    name="condition_operator"
                    value={draft.condition.operator}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        condition: { ...current.condition, operator: event.target.value },
                      }))
                    }
                    disabled={!canCreate || isSubmitting || !isEnforceable}
                  >
                    {["<=", "<", "==", ">=", ">"].map((operator) => (
                      <option key={operator} value={operator}>
                        {operator}
                      </option>
                    ))}
                  </select>
                  {validationErrors.condition_operator ? (
                    <small className="manual-field-error">
                      {validationErrors.condition_operator}
                    </small>
                  ) : null}
                </label>

                <label className="manual-field">
                  <span>Threshold value</span>
                  <input
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
                  />
                  {validationErrors.condition_value ? (
                    <small className="manual-field-error">
                      {validationErrors.condition_value}
                    </small>
                  ) : null}
                </label>
              </div>

              <div className="manual-field-grid">
                <label className="manual-field">
                  <span>Aggregation period</span>
                  <select
                    name="aggregation_period"
                    value={draft.applicability.aggregation_period}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        applicability: {
                          ...current.applicability,
                          aggregation_period: event.target.value as AggregationPeriod | "",
                        },
                      }))
                    }
                    disabled={!canCreate || isSubmitting || !isEnforceable}
                  >
                    <option value="">Select period</option>
                    {AGGREGATION_PERIOD_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                  {validationErrors.applicability_aggregation_period ? (
                    <small className="manual-field-error">
                      {validationErrors.applicability_aggregation_period}
                    </small>
                  ) : null}
                </label>

                <label className="manual-field">
                  <span>Unit</span>
                  <input
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
                  />
                  {validationErrors.applicability_unit ? (
                    <small className="manual-field-error">
                      {validationErrors.applicability_unit}
                    </small>
                  ) : null}
                </label>

                <label className="manual-field">
                  <span>Currency</span>
                  <input
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
                    disabled={!canCreate || isSubmitting || !isEnforceable}
                  />
                </label>

                <label className="manual-field">
                  <span>Limit basis</span>
                  <input
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
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="manual-panel">
            <div className="manual-panel-head">
              <div>
                <p className="manual-panel-kicker">Exceptions</p>
                <h4>Evidence that modifies the Rule outcome</h4>
              </div>
              <button
                type="button"
                className="review-secondary-button compact"
                onClick={addException}
                disabled={!canCreate || isSubmitting}
              >
                Add exception
              </button>
            </div>

            <div className="manual-exception-stack">
              {draft.exceptions.map((exception, index) => (
                <article key={index} className="manual-exception-card">
                  <div className="manual-exception-head">
                    <span>Exception {index + 1}</span>
                    <button
                      type="button"
                      className="review-secondary-button compact"
                      onClick={() => removeException(index)}
                      disabled={!canCreate || isSubmitting}
                    >
                      Remove
                    </button>
                  </div>

                  <label className="manual-field">
                    <span>{index === 0 ? "Exception" : `Exception ${index + 1}`}</span>
                    <textarea
                      value={exception.description}
                      onChange={(event) =>
                        updateException(index, "description", event.target.value)
                      }
                      rows={3}
                      placeholder="Director approval is required."
                      disabled={!canCreate || isSubmitting}
                    />
                    {validationErrors[`exception_${index}`] ? (
                      <small className="manual-field-error">
                        {validationErrors[`exception_${index}`]}
                      </small>
                    ) : null}
                  </label>

                  <label className="manual-field">
                    <span>
                      {index === 0 ? "Required evidence" : `Required evidence ${index + 1}`}
                    </span>
                    <textarea
                      value={exception.required_evidence}
                      onChange={(event) =>
                        updateException(index, "required_evidence", event.target.value)
                      }
                      rows={2}
                      placeholder="director_approval"
                      disabled={!canCreate || isSubmitting}
                    />
                  </label>
                </article>
              ))}
            </div>
          </section>

          <section className="manual-panel">
            <div className="manual-panel-head">
              <div>
                <p className="manual-panel-kicker">Optional Citation</p>
                <h4>Anchor the Rule when a source section exists</h4>
              </div>
            </div>

            <div className="manual-field-grid">
              <label className="manual-field">
                <span>Citation document ID</span>
                <input
                  value={draft.citation.document_id}
                  onChange={(event) =>
                    updateCitationField("document_id", event.target.value)
                  }
                  placeholder="expense-policy"
                  disabled={!canCreate || isSubmitting}
                />
                {validationErrors.citation_document_id ? (
                  <small className="manual-field-error">
                    {validationErrors.citation_document_id}
                  </small>
                ) : null}
              </label>

              <label className="manual-field">
                <span>Citation Document Version</span>
                <input
                  value={draft.citation.document_version_id}
                  onChange={(event) =>
                    updateCitationField("document_version_id", event.target.value)
                  }
                  placeholder="docv-2026-06-01"
                  disabled={!canCreate || isSubmitting}
                />
                {validationErrors.citation_document_version_id ? (
                  <small className="manual-field-error">
                    {validationErrors.citation_document_version_id}
                  </small>
                ) : null}
              </label>

              <label className="manual-field">
                <span>Citation section ID</span>
                <input
                  value={draft.citation.section_id}
                  onChange={(event) =>
                    updateCitationField("section_id", event.target.value)
                  }
                  placeholder="offsites#abc123"
                  disabled={!canCreate || isSubmitting}
                />
                {validationErrors.citation_section_id ? (
                  <small className="manual-field-error">
                    {validationErrors.citation_section_id}
                  </small>
                ) : null}
              </label>

              <label className="manual-field">
                <span>Citation start character</span>
                <input
                  value={draft.citation.start_char}
                  onChange={(event) =>
                    updateCitationField("start_char", event.target.value)
                  }
                  placeholder="120"
                  disabled={!canCreate || isSubmitting}
                />
                {validationErrors.citation_start_char ? (
                  <small className="manual-field-error">
                    {validationErrors.citation_start_char}
                  </small>
                ) : null}
              </label>

              <label className="manual-field">
                <span>Citation end character</span>
                <input
                  value={draft.citation.end_char}
                  onChange={(event) =>
                    updateCitationField("end_char", event.target.value)
                  }
                  placeholder="191"
                  disabled={!canCreate || isSubmitting}
                />
                {validationErrors.citation_end_char ? (
                  <small className="manual-field-error">
                    {validationErrors.citation_end_char}
                  </small>
                ) : null}
              </label>
            </div>

            <label className="manual-field">
              <span>Citation quote</span>
              <textarea
                value={draft.citation.quote}
                onChange={(event) => updateCitationField("quote", event.target.value)}
                rows={3}
                placeholder="Team offsites may reimburse dinner up to $120 with director approval."
                disabled={!canCreate || isSubmitting}
              />
              {validationErrors.citation_quote ? (
                <small className="manual-field-error">
                  {validationErrors.citation_quote}
                </small>
              ) : null}
            </label>
          </section>

          {submitError ? (
            <p className="error-banner" role="alert">
              {submitError}
            </p>
          ) : null}
          {successMessage ? (
            <p className="manual-success-banner" role="status">
              {successMessage}
            </p>
          ) : null}

          <div className="manual-submit-rail">
            <div>
              <p className="manual-submit-kicker">Store boundary</p>
              <p className="manual-submit-note">
                Manual Rules are committed as approved entries with manual origin.
              </p>
            </div>
            <button
              type="submit"
              className="review-save-button"
              disabled={!canCreate || isSubmitting}
            >
              {isSubmitting ? "Creating…" : "Create Manual Rule"}
            </button>
          </div>
        </form>

        <aside className="manual-preview-rail">
          <section className="manual-preview-card">
            <div className="manual-preview-head">
              <div>
                <p className="manual-panel-kicker">Latest Result</p>
                <h4>Human-authored Rule preview</h4>
              </div>
              <span className="manual-origin-seal">Human-authored</span>
            </div>

            {previewRule ? (
              <div className="manual-preview-body">
                <span
                  className={`review-enforceability ${previewRule.enforceability_class}`}
                >
                  {formatEnforceabilityClass(previewRule.enforceability_class)}
                </span>
                <h5>{previewRule.statement}</h5>
                <p className="manual-preview-meta">
                  {summarizeRuleScope(previewRule.scope)} · {describeRuleOrigin(previewRule)}
                </p>
                {previewRule.condition ? (
                  <p className="manual-preview-code">
                    <code>
                      {previewRule.condition.field} {previewRule.condition.operator}{" "}
                      {previewRule.condition.value}
                    </code>
                  </p>
                ) : null}
                <dl className="manual-preview-grid">
                  <div>
                    <dt>Rule ID</dt>
                    <dd>{previewRule.rule_id}</dd>
                  </div>
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
              </div>
            ) : (
              <div className="manual-preview-empty">
                <p>
                  Submit a Manual Rule to stamp the latest approved, human-authored
                  entry here.
                </p>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
