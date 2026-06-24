import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { fetchComplianceReview } from "./api";
import type { ComplianceReviewDetail, ComplianceReviewResolutionType } from "./types";
import {
  canResolveComplianceReviews,
  formatResolutionType,
  submitComplianceReviewDecision,
  validateResolutionRationale,
} from "./decisions";
import {
  complianceOutcomeTone,
  describeComplianceReviewError,
  expenseRowFieldGroups,
  formatCitationDocumentLabel,
  formatCitationSectionLabel,
  formatComplianceOutcome,
  formatExpenseRowSubtitle,
} from "./format";
import {
  citationDuplicatesReason,
  formatMatchingRuleIds as formatSecondaryRules,
  formatMissingEvidenceFields,
  formatEvaluationEvidenceContext,
  formatViolationComparison,
  hasAggregationWindowContext,
} from "../compliance-evaluation-runs/format";
import AggregationWindowDetail from "../compliance-evaluation-runs/AggregationWindowDetail";
import { ApiError } from "../shared/api/client";
import Breadcrumbs from "../shared/ui/Breadcrumbs";
import RecordPageHeader, {
  type RecordPropertyGroup,
} from "../shared/ui/RecordPageHeader";
import RecordPropertyRow, {
  type RecordProperty,
} from "../shared/ui/RecordPropertyRow";
import StatusPill from "../shared/ui/StatusPill";
import { ExpenseReportPageIcon, RecordPageIcon } from "../shared/ui/PageIcons";
import { formatDateTime } from "../shared/format/common";
import type { AuthenticatedPrincipal } from "../shared/auth/types";

import ComplianceReviewDecisionDrawer from "./ComplianceReviewDecisionDrawer";

interface ComplianceReviewDetailViewProps {
  complianceReviewId: string;
  principal: AuthenticatedPrincipal;
  onBack?: () => void;
  backLabel?: string;
  onResolved?: () => void;
}

type DetailStatus = "loading" | "ready" | "not_found" | "error";

function formatBooleanProperty(value: string): RecordProperty["value"] {
  if (value === "Yes") {
    return <StatusPill label="Yes" variant="success" />;
  }
  if (value === "No") {
    return <StatusPill label="No" variant="neutral" />;
  }
  return value;
}

export default function ComplianceReviewDetailView({
  complianceReviewId,
  principal,
  onBack,
  backLabel = "Back to queue",
  onResolved,
}: ComplianceReviewDetailViewProps) {
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [detail, setDetail] = useState<ComplianceReviewDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolutionType, setResolutionType] =
    useState<ComplianceReviewResolutionType>("upheld");
  const [resolutionRationale, setResolutionRationale] = useState("");
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  const loadDetail = useCallback(async () => {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const nextDetail = await fetchComplianceReview(complianceReviewId);
      setDetail(nextDetail);
      setStatus("ready");
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 404) {
        setStatus("not_found");
        return;
      }
      setErrorMessage(
        describeComplianceReviewError(
          error,
          "Unable to load Compliance Review detail.",
        ),
      );
      setStatus("error");
    }
  }, [complianceReviewId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const canResolve = canResolveComplianceReviews(principal);

  const propertyGroups = useMemo((): RecordPropertyGroup[] => {
    if (!detail) {
      return [];
    }
    const properties = [
      {
        label: "Evaluation run",
        value: (
          <code className="db-mono">{detail.compliance_evaluation_run_id}</code>
        ),
      },
      {
        label: "Expense report",
        value: (
          <code className="db-mono">{detail.expense_report_id}</code>
        ),
      },
      {
        label: "Policy version",
        value: detail.policy_version_id,
      },
      {
        label: "Executed",
        value: formatDateTime(detail.executed_at),
      },
    ];
    if (detail.decision) {
      properties.push(
        {
          label: "Resolution",
          value: formatResolutionType(detail.decision.resolution_type),
        },
        {
          label: "Recorded by",
          value: detail.decision.recorded_by,
        },
        {
          label: "Recorded at",
          value: formatDateTime(detail.decision.recorded_at),
        },
      );
    }
    return [{ title: "Run context", properties }];
  }, [detail]);

  async function handleConfirmResolution(): Promise<void> {
    const validationError = validateResolutionRationale(resolutionRationale);
    if (validationError) {
      setResolutionError(validationError);
      return;
    }

    setIsResolving(true);
    setResolutionError(null);
    try {
      await submitComplianceReviewDecision(
        complianceReviewId,
        resolutionType,
        resolutionRationale,
      );
      setResolveOpen(false);
      setResolutionRationale("");
      await loadDetail();
      onResolved?.();
    } catch (error: unknown) {
      setResolutionError(
        describeComplianceReviewError(error, "Unable to record resolution."),
      );
    } finally {
      setIsResolving(false);
    }
  }

  if (status === "loading") {
    return <p className="catalog-status">Loading review detail…</p>;
  }

  if (status === "not_found") {
    return (
      <div className="catalog-page content-enter">
        <p className="error-banner">Compliance Review item was not found.</p>
        {onBack ? (
          <button type="button" className="secondary-button" onClick={onBack}>
            {backLabel}
          </button>
        ) : null}
      </div>
    );
  }

  if (status === "error" || !detail) {
    return (
      <div className="catalog-page content-enter">
        <p className="error-banner">
          {errorMessage ?? "Unable to load Compliance Review detail."}
        </p>
        {onBack ? (
          <button type="button" className="secondary-button" onClick={onBack}>
            {backLabel}
          </button>
        ) : null}
      </div>
    );
  }

  const { row_outcome: outcome, expense_row: expenseRow } = detail;
  const secondaryRules = formatSecondaryRules(
    outcome.rule_id,
    outcome.matching_rule_ids ?? [],
  );
  const missingFields = formatMissingEvidenceFields(
    outcome.missing_evidence_fields,
  );
  const violationComparison = formatViolationComparison(
    outcome.policy_limit,
    outcome.actual_value,
  );
  const scopeContext = formatEvaluationEvidenceContext(outcome);
  const showAggregation = hasAggregationWindowContext(outcome.aggregation_context);
  const rationale = outcome.reason?.trim() ?? detail.rule_statement;
  const citation = detail.citation;
  const showCitation =
    citation !== null &&
    !citationDuplicatesReason(detail.rule_statement, citation.quote);
  const isResolved = detail.decision !== null;
  const expenseGroups = expenseRowFieldGroups(expenseRow);

  return (
    <div className="review-detail content-enter">
      <Breadcrumbs
        items={[
          { label: "Compliance Review", onClick: onBack },
          { label: `Row ${outcome.row_index + 1}` },
        ]}
      />

      <RecordPageHeader
        icon={<RecordPageIcon icon={<ExpenseReportPageIcon size={22} />} />}
        title={`Review · Row ${outcome.row_index + 1}`}
        subtitle={formatExpenseRowSubtitle(expenseRow)}
        propertyGroups={propertyGroups}
        propertyLayout="stacked"
        actions={
          canResolve && !isResolved ? (
            <button
              type="button"
              className="document-command document-command-accent"
              onClick={() => {
                setResolutionError(null);
                setResolveOpen(true);
              }}
            >
              Resolve
            </button>
          ) : isResolved ? (
            <StatusPill label="Resolved" variant="success" />
          ) : null
        }
      />

      {isResolved && detail.decision ? (
        <section className="review-detail-panel review-property-section reveal">
          <h4 className="record-section-heading">Resolution</h4>
          <div className="review-detail-badges">
            <StatusPill
              label={formatResolutionType(detail.decision.resolution_type)}
              variant="success"
            />
          </div>
          <div className="review-field review-field--statement">
            <label htmlFor="compliance-review-resolution-rationale">Rationale</label>
            <p id="compliance-review-resolution-rationale">
              {detail.decision.rationale}
            </p>
          </div>
        </section>
      ) : null}

      <div className="review-detail-body">
        <div className="review-detail-stage review-detail-stage-single">
          <div className="review-detail-workspace">
            <section
              className="review-detail-panel review-property-section reveal"
              style={{ "--reveal-delay": "60ms" } as CSSProperties}
            >
              <h4 className="record-section-heading">Expense row</h4>
              {expenseGroups.map((group) => (
                <div key={group.title ?? "default"} className="compliance-review-property-group">
                  {group.title ? (
                    <p className="record-property-group-title">{group.title}</p>
                  ) : null}
                  <RecordPropertyRow
                    properties={group.fields.map((field) => ({
                      label: field.label,
                      value:
                        field.label === "Manager approval" ||
                        field.label === "Receipt attached"
                          ? formatBooleanProperty(field.value)
                          : field.label === "Amount"
                            ? (
                                <span className="compliance-review-amount">
                                  {field.value}
                                </span>
                              )
                            : field.label === "Employee" ||
                                field.label === "Trip ID"
                              ? (
                                  <code className="db-mono">{field.value}</code>
                                )
                              : field.value,
                      empty: field.value === "—",
                    }))}
                  />
                </div>
              ))}
            </section>

            <section
              className="review-detail-panel review-property-section reveal"
              style={{ "--reveal-delay": "90ms" } as CSSProperties}
            >
              <h4 className="record-section-heading">Evaluation outcome</h4>
              <div className="review-detail-badges">
                <StatusPill
                  label={formatComplianceOutcome(outcome.outcome)}
                  variant={complianceOutcomeTone(outcome.outcome)}
                />
              </div>

              {violationComparison ? (
                <p className="review-detail-note compliance-review-outcome-lede">
                  {violationComparison}
                </p>
              ) : null}

              {showAggregation ? (
                <AggregationWindowDetail context={outcome.aggregation_context} />
              ) : null}

              {detail.rule_statement ? (
                <div className="review-field review-field--statement">
                  <label htmlFor="compliance-review-rule-statement">
                    Rule statement
                  </label>
                  <p id="compliance-review-rule-statement">{detail.rule_statement}</p>
                </div>
              ) : null}

              {scopeContext ? (
                <p className="review-detail-note compliance-review-scope-context">
                  {scopeContext}
                </p>
              ) : null}

              {rationale && rationale !== detail.rule_statement ? (
                <div className="review-field review-field--statement">
                  <label htmlFor="compliance-review-automated-rationale">
                    Automated rationale
                  </label>
                  <p id="compliance-review-automated-rationale">{rationale}</p>
                </div>
              ) : null}

              {missingFields ? (
                <p className="review-detail-note">{missingFields}</p>
              ) : null}

              {secondaryRules ? (
                <p className="review-detail-note">{secondaryRules}</p>
              ) : null}
            </section>

            {citation ? (
              <details
                className="review-detail-meta compliance-review-citation-panel notion-collapsible reveal"
                style={{ "--reveal-delay": "120ms" } as CSSProperties}
              >
                <summary>Citation</summary>
                <div className="compliance-review-citation-body">
                  <div className="compliance-review-citation-source">
                    <span className="review-citation-kicker">Policy source</span>
                    <p
                      className="review-citation-doc"
                      title={citation.document_id}
                    >
                      {formatCitationDocumentLabel(citation.document_id)}
                    </p>
                    <p
                      className="review-citation-section"
                      title={citation.section_id}
                    >
                      {formatCitationSectionLabel(citation.section_id)}
                    </p>
                  </div>
                  <blockquote
                    className="review-source-passage"
                    cite={`${citation.document_id}#${citation.section_id}`}
                  >
                    {citation.quote}
                  </blockquote>
                  {!showCitation && detail.rule_statement ? (
                    <p className="compliance-review-citation-note">
                      Citation quote matches the rule statement shown above.
                    </p>
                  ) : null}
                </div>
              </details>
            ) : (
              <section
                className="review-detail-panel review-property-section is-muted reveal"
                style={{ "--reveal-delay": "120ms" } as CSSProperties}
              >
                <h4 className="record-section-heading">Citation</h4>
                <p className="review-citation-empty">
                  No Citation was attached to this outcome.
                </p>
              </section>
            )}

            <details
              className="review-detail-meta notion-collapsible reveal"
              style={{ "--reveal-delay": "150ms" } as CSSProperties}
            >
              <summary>System identifiers</summary>
              <div className="review-detail-meta-body">
                <RecordPropertyRow
                  properties={[
                    ...(outcome.rule_id
                      ? [
                          {
                            label: "Rule ID",
                            value: (
                              <code className="db-mono">{outcome.rule_id}</code>
                            ),
                          },
                        ]
                      : []),
                    {
                      label: "Review ID",
                      value: (
                        <code className="db-mono">{detail.compliance_review_id}</code>
                      ),
                    },
                    {
                      label: "Compiled rule set",
                      value: (
                        <code className="db-mono">{detail.compiled_rule_set_id}</code>
                      ),
                    },
                    ...(citation
                      ? [
                          {
                            label: "Document ID",
                            value: (
                              <code className="db-mono">{citation.document_id}</code>
                            ),
                          },
                          {
                            label: "Section ID",
                            value: (
                              <code className="db-mono">{citation.section_id}</code>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            </details>
          </div>
        </div>
      </div>

      <ComplianceReviewDecisionDrawer
        open={resolveOpen}
        rowIndex={outcome.row_index}
        resolutionType={resolutionType}
        isResolving={isResolving}
        rationale={resolutionRationale}
        error={resolutionError}
        onResolutionTypeChange={setResolutionType}
        onRationaleChange={setResolutionRationale}
        onConfirm={() => void handleConfirmResolution()}
        onClose={() => {
          if (!isResolving) {
            setResolveOpen(false);
            setResolutionError(null);
          }
        }}
      />
    </div>
  );
}
