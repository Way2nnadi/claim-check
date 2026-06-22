import type { EnforceabilityClass, Rule } from "../rules/types";
import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "../shared/api/client";
import { hasAnyRole } from "../shared/permissions";
import { createManualRule } from "./api";
import { RuleFormFields, type RuleFormFieldWrapperProps } from "../rules/RuleFormFields";
import { applyEnforceabilityChange, buildManualRuleRequest, createEmptyManualRuleDraft, type CitationDraft, type ManualRuleDraft, type ValidationErrors, validateManualRuleDraft } from "../rules/ruleDraft";
import type { AuthenticatedPrincipal } from "../shared/auth/types";

import {
  describeRuleOrigin,
  summarizeApplicability,
  summarizeRuleScope,
} from "../policy-versions/format";

interface ManualRulesPageProps {
  principal: AuthenticatedPrincipal;
}

const AUTHOR_ROLES = ["admin", "approver"] as const;

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

function ManualRuleFieldWrapper({
  label,
  inputId,
  error,
  description,
  children,
}: RuleFormFieldWrapperProps) {
  return (
    <ManualField
      label={label}
      inputId={inputId}
      error={error}
      description={description}
    >
      {children}
    </ManualField>
  );
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
  const [draft, setDraft] = useState<ManualRuleDraft>(() => createEmptyManualRuleDraft());
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [createdRule, setCreatedRule] = useState<Rule | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canCreate = hasAnyRole(principal, AUTHOR_ROLES);
  const isEnforceable = draft.enforceability_class === "enforceable";

  function updateCitationField(key: keyof CitationDraft, value: string): void {
    setDraft((current) => ({
      ...current,
      citation: {
        ...current.citation,
        [key]: value,
      },
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!canCreate) {
      return;
    }

    const nextErrors = validateManualRuleDraft(draft);
    setValidationErrors(nextErrors);
    setSubmitError(null);
    setSuccessMessage(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      const created = await createManualRule(buildManualRuleRequest(draft));
      setCreatedRule(created);
      setSuccessMessage("Manual Rule created and approved.");
      setValidationErrors({});
      setDraft(createEmptyManualRuleDraft());
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
          <output className="review-save-banner">
            {successMessage}
          </output>
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
            </section>

            <RuleFormFields
              draft={draft}
              idPrefix="manual-rule"
              disabled={!canCreate || isSubmitting}
              isEnforceable={isEnforceable}
              onDraftChange={(nextDraft) =>
                setDraft((current) => ({ ...current, ...nextDraft }))
              }
              onEnforceabilityChange={(nextValue) =>
                setDraft((current) => applyEnforceabilityChange(current, nextValue))
              }
              FieldWrapper={ManualRuleFieldWrapper}
              validationErrors={validationErrors}
              useOperatorPicker
              enforceabilityDescription={
                !isEnforceable
                  ? "Guidance and subjective rules route to humans instead of machine checks."
                  : undefined
              }
            />

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
