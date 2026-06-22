import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode, RefObject } from "react";
import {
  ApiError,
  approveCandidateRule,
  fetchCandidateRule,
  fetchDocumentSections,
  rejectCandidateRule,
  updateCandidateRule,
} from "./api";
import {
  describeCandidateRuleError,
  formatEnforceabilityClass,
  formatLifecycleState,
  formatQAFlagCode,
  formatQAFlagDomain,
  lifecycleStateClassName,
  qaFlagDomain,
} from "./candidateRuleFormat";
import { formatDocumentTitle } from "./documentFormat";
import { hasAnyRole } from "./permissions";
import SectionBrowserDrawer from "./SectionBrowserDrawer";
import SearchablePicker from "./SearchablePicker";
import type {
  AggregationPeriod,
  Applicability,
  AuthenticatedPrincipal,
  CandidateRuleReview,
  CandidateRuleReviewUpdateRequest,
  CandidateRuleValue,
  Citation,
  DocumentSection,
  EnforceabilityClass,
  QAFlag,
  RuleCondition,
  RuleException,
  Scope,
} from "./types";

interface CandidateRuleDetailProps {
  candidateRuleId: string;
  principal: AuthenticatedPrincipal;
  onBack?: () => void;
  backLabel?: string;
  onReviewChange?: (review: CandidateRuleReview) => void;
  onReviewResolved?: (
    candidateRuleId: string,
    outcome: "approved" | "rejected",
  ) => void;
}

type DetailStatus = "loading" | "ready" | "not_found" | "error";
type DecisionMode = "approve" | "reject";

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

interface ReviewFieldProps {
  label: string;
  extractedValue: ReactNode;
  changed: boolean;
  showWasLine?: boolean;
  inputId: string;
  children: ReactNode;
  description?: string;
  className?: string;
}

const EDITOR_ROLES = ["admin", "approver"] as const;
const QUEUE_LIFECYCLE_STATES = new Set(["extracted", "in_review"]);
const APPROVAL_BLOCKING_QA_CODES = new Set(["unresolvable_citation"]);

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
  label: string;
  placeholder: string;
}[] = [
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

function normalizeOptionalString(value: string): string | null {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function hasExtractedBaseline(value: string | null | undefined): boolean {
  return value != null && value.trim().length > 0;
}

function normalizeCurrencyInput(value: string): string {
  return value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3);
}

function normalizeCurrencyForSave(value: string): string | null {
  const normalized = normalizeCurrencyInput(value);
  return normalized.length === 0 ? null : normalized;
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
      currency: normalizeCurrencyInput(rule.applicability?.currency ?? ""),
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
  const currency = normalizeCurrencyForSave(applicability.currency);
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

function approvalBlockersFor(review: CandidateRuleReview, draft: RuleDraft): string[] {
  const blockers = new Set<string>();
  const normalizedStatement = normalizeStatement(draft.statement);
  const condition = buildConditionFromDraft(draft.condition);
  const currentCitation = review.current_rule.citation;

  if (normalizedStatement.length === 0) {
    blockers.add("Add a Rule statement before approval.");
  }

  if (draft.enforceability_class === "enforceable" && condition === null) {
    blockers.add("Complete the machine-checkable condition before approval.");
  }

  if (draft.enforceability_class !== "enforceable" && condition !== null) {
    blockers.add("Remove the machine-checkable condition before approval.");
  }

  if (currentCitation === null) {
    blockers.add("Resolve the Citation issue before approving this Candidate Rule.");
  }

  for (const flag of review.qa_flags) {
    if (APPROVAL_BLOCKING_QA_CODES.has(flag.code)) {
      blockers.add("Resolve the Citation issue before approving this Candidate Rule.");
    }
  }

  return [...blockers];
}

function normalizeStatement(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function statementsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeStatement(left);
  const normalizedRight = normalizeStatement(right);
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

function sectionLocation(section: DocumentSection): string {
  const path = section.heading_path.length > 0 ? section.heading_path : ["Preamble"];
  return path.join(" › ");
}

function shortenId(value: string, visible = 6): string {
  if (value.length <= visible * 2 + 1) {
    return value;
  }
  return `${value.slice(0, visible)}…${value.slice(-visible)}`;
}

function cleanSourceFragment(text: string): string {
  return text
    .replace(/^\s*[•·▪◦\-*–—]\s*$/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateContext(text: string, maxLength = 320): string {
  const cleaned = cleanSourceFragment(text);
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `…${cleaned.slice(-maxLength).trimStart()}`;
}

interface CitationSplit {
  before: string;
  highlight: string;
  after: string;
}

function splitSectionCitation(section: DocumentSection, citation: Citation): CitationSplit | null {
  const overlapStart = Math.max(citation.start_char, section.start_char);
  const overlapEnd = Math.min(citation.end_char, section.end_char);
  if (overlapEnd <= overlapStart) {
    return null;
  }

  const localStart = overlapStart - section.start_char;
  const localEnd = overlapEnd - section.start_char;

  return {
    before: cleanSourceFragment(section.content.slice(0, localStart)),
    highlight:
      cleanSourceFragment(section.content.slice(localStart, localEnd)) || citation.quote,
    after: cleanSourceFragment(section.content.slice(localEnd)),
  };
}

function ReviewField({
  label,
  extractedValue,
  changed,
  showWasLine,
  inputId,
  children,
  description,
  className,
}: ReviewFieldProps) {
  const displayWasLine = showWasLine ?? changed;

  return (
    <div className={`review-field${changed ? " changed" : ""}${className ? ` ${className}` : ""}`}>
      <label htmlFor={inputId}>{label}</label>
      {children}
      {displayWasLine ? (
        <p className="review-field-was">
          <span className="review-field-was-label">Was</span> {extractedValue}
        </p>
      ) : null}
      {description ? <p className="review-field-description">{description}</p> : null}
    </div>
  );
}

interface SourceCitationViewProps {
  section: DocumentSection;
  citation: Citation;
  showFullSection: boolean;
  suppressHighlight?: boolean;
}

function SourceCitationView({
  section,
  citation,
  showFullSection,
  suppressHighlight = false,
}: SourceCitationViewProps) {
  const split = splitSectionCitation(section, citation);

  if (!showFullSection || !split) {
    if (suppressHighlight) {
      return null;
    }
    return <div className="review-source-passage">{citation.quote}</div>;
  }

  const hasContext = Boolean(split.before || split.after);

  if (suppressHighlight && !hasContext) {
    return null;
  }

  return (
    <div className="review-source-context">
      {split.before ? (
        <p className="review-source-context-muted">{truncateContext(split.before)}</p>
      ) : null}
      {!suppressHighlight ? <div className="review-source-passage">{split.highlight}</div> : null}
      {split.after ? (
        <p className="review-source-context-muted">{truncateContext(split.after)}</p>
      ) : null}
    </div>
  );
}

function QaFlagsBanner({ flags }: { flags: QAFlag[] }) {
  if (flags.length === 0) {
    return null;
  }

  return (
    <aside className="review-qa-banner reveal" aria-label="QA flags">
      <ul className="review-qa-domain-list">
        {flags.map((flag) => {
          const domain = qaFlagDomain(flag.code);
          return (
            <li key={`${flag.code}-${flag.detail}`} className={`review-qa-domain-card ${domain}`}>
              <div className="review-qa-domain-head">
                <span className="review-qa-domain-label">{formatQAFlagDomain(domain)}</span>
                <span className="review-qa-code">{formatQAFlagCode(flag.code)}</span>
              </div>
              <p>{flag.detail}</p>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

interface CitationStripProps {
  citation: Citation;
  currentStatement: string;
  sections: DocumentSection[];
  sectionsStatus: "idle" | "loading" | "ready" | "error";
  sectionsError: string | null;
  selectedSection: DocumentSection | null;
  viewingCitedSection: boolean;
  showFullSection: boolean;
  sectionsOpen: boolean;
  sectionFilter: string;
  sourceBodyRef: RefObject<HTMLElement | null>;
  onToggleContext: () => void;
  onBrowseSections: () => void;
  onSectionFilterChange: (value: string) => void;
  onSectionSelect: (sectionId: string) => void;
  onCloseSections: () => void;
}

function CitationStrip({
  citation,
  currentStatement,
  sections,
  sectionsStatus,
  sectionsError,
  selectedSection,
  viewingCitedSection,
  showFullSection,
  sectionsOpen,
  sectionFilter,
  sourceBodyRef,
  onToggleContext,
  onBrowseSections,
  onSectionFilterChange,
  onSectionSelect,
  onCloseSections,
}: CitationStripProps) {
  const canBrowse = sections.length > 0;
  const quoteMatchesStatement = statementsMatch(citation.quote, currentStatement);
  const locationLabel = selectedSection
    ? sectionLocation(selectedSection)
    : formatDocumentTitle(citation.document_id);

  let stripBody: ReactNode = null;

  if (sectionsStatus === "loading") {
    stripBody = (
      <>
        {!quoteMatchesStatement ? (
          <div className="review-source-passage">{citation.quote}</div>
        ) : null}
        <p className="review-citation-status">
          <span className="catalog-status-rule" aria-hidden="true" />
          Loading source…
        </p>
      </>
    );
  } else if (sectionsStatus === "error") {
    stripBody = (
      <>
        {!quoteMatchesStatement ? (
          <div className="review-source-passage">{citation.quote}</div>
        ) : null}
        <p className="review-citation-status error">{sectionsError}</p>
      </>
    );
  } else if (selectedSection && viewingCitedSection) {
    stripBody = (
      <SourceCitationView
        section={selectedSection}
        citation={citation}
        showFullSection={showFullSection}
        suppressHighlight={quoteMatchesStatement}
      />
    );
  } else if (selectedSection) {
    stripBody = (
      <div className="review-source-text">{cleanSourceFragment(selectedSection.content)}</div>
    );
  } else if (!quoteMatchesStatement) {
    stripBody = <div className="review-source-passage">{citation.quote}</div>;
  }

  return (
    <section className="review-citation-strip reveal" aria-label="Source citation">
      <header className="review-citation-strip-head">
        <div className="review-citation-strip-intro">
          <span className="review-citation-kicker">Source</span>
          <p className="review-citation-location">{locationLabel}</p>
        </div>
        <div className="review-citation-strip-actions">
          {viewingCitedSection ? (
            <button type="button" className="review-source-context-toggle" onClick={onToggleContext}>
              {showFullSection ? "Passage only" : "More context"}
            </button>
          ) : null}
          {canBrowse ? (
            <button type="button" className="review-source-browse-toggle" onClick={onBrowseSections}>
              Browse sections ({sections.length})
            </button>
          ) : null}
        </div>
      </header>

      {stripBody ? (
        <div ref={sourceBodyRef as RefObject<HTMLDivElement>} className="review-citation-strip-body">
          {stripBody}
        </div>
      ) : null}

      {canBrowse ? (
        <SectionBrowserDrawer
          open={sectionsOpen}
          documentId={citation.document_id}
          sections={sections}
          filter={sectionFilter}
          selectedSectionId={selectedSection?.section_id ?? citation.section_id}
          citedSectionId={citation.section_id}
          onFilterChange={onSectionFilterChange}
          onSelect={onSectionSelect}
          onClose={onCloseSections}
        />
      ) : null}
    </section>
  );
}

export default function CandidateRuleDetail({
  candidateRuleId,
  principal,
  onBack,
  backLabel = "Clear selection",
  onReviewChange,
  onReviewResolved,
}: CandidateRuleDetailProps) {
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [review, setReview] = useState<CandidateRuleReview | null>(null);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [decisionMode, setDecisionMode] = useState<DecisionMode | null>(null);
  const [decisionComment, setDecisionComment] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [sections, setSections] = useState<DocumentSection[]>([]);
  const [sectionsStatus, setSectionsStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [sectionFilter, setSectionFilter] = useState("");
  const [showFullSection, setShowFullSection] = useState(false);
  const sourceBodyRef = useRef<HTMLElement | null>(null);

  const canEdit = hasAnyRole(principal, EDITOR_ROLES);

  const loadReview = useCallback(async (): Promise<void> => {
    setStatus("loading");
    setErrorMessage(null);
    setSaveMessage(null);
    setSections([]);
    setSectionsStatus("idle");
    setSectionsError(null);
    setSelectedSectionId(null);
    setSectionsOpen(false);
    setSectionFilter("");
    setShowFullSection(false);
    setIsResolving(false);
    setDecisionMode(null);
    setDecisionComment("");
    setDecisionError(null);

    try {
      const response = await fetchCandidateRule(candidateRuleId);
      setReview(response);
      setDraft(createRuleDraft(response.current_rule));
      setStatus("ready");

      const citation = response.current_rule.citation;
      if (!citation) {
        return;
      }

      setSelectedSectionId(citation.section_id);
      setSectionsStatus("loading");

      try {
        const sectionsResponse = await fetchDocumentSections(
          citation.document_id,
          citation.document_version_id,
        );
        setSections(Array.isArray(sectionsResponse.items) ? sectionsResponse.items : []);
        setSectionsStatus("ready");
      } catch (error: unknown) {
        setSectionsStatus("error");
        setSectionsError(
          describeCandidateRuleError(error, "Unable to load document sections for this citation."),
        );
      }
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

  const updatePayload = useMemo<CandidateRuleReviewUpdateRequest>(() => {
    if (!review || !draft) {
      return {};
    }
    return buildUpdatePayload(draft, review.current_rule);
  }, [draft, review]);

  const unsavedChangeCount = Object.keys(updatePayload).length;
  const differenceCount = review && draft ? countDifferences(review, draft) : 0;

  const citation = review?.current_rule.citation ?? null;
  const selectedSection =
    sections.find((section) => section.section_id === selectedSectionId) ?? null;
  const viewingCitedSection =
    Boolean(citation && selectedSection && selectedSection.section_id === citation.section_id);
  const approvalBlockers =
    review && draft ? approvalBlockersFor(review, draft) : [];

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

  function openDecisionModal(mode: DecisionMode): void {
    clearFeedback();
    setDecisionMode(mode);
    setDecisionComment("");
    setDecisionError(null);
  }

  function closeDecisionModal(): void {
    setDecisionMode(null);
    setDecisionComment("");
    setDecisionError(null);
  }

  function handleSectionSelect(sectionId: string): void {
    setSelectedSectionId(sectionId);
    setShowFullSection(false);
    sourceBodyRef.current?.scrollTo({ top: 0 });
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!review || !draft || !canEdit || isResolving || unsavedChangeCount === 0) {
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

  async function handleResolveReview(): Promise<void> {
    if (!review || decisionMode === null || !canEdit || isSaving) {
      return;
    }

    const trimmedComment = decisionComment.trim();
    if (!trimmedComment) {
      setDecisionError(
        decisionMode === "approve"
          ? "Enter approval rationale before moving this Candidate Rule into the Structured Policy Store."
          : "Enter a rejection reason before removing this Candidate Rule from the review queue.",
      );
      return;
    }

    setIsResolving(true);
    setDecisionError(null);
    setErrorMessage(null);
    setSaveMessage(null);

    try {
      if (decisionMode === "approve") {
        await approveCandidateRule(candidateRuleId, {
          rationale: trimmedComment,
        });
      } else {
        await rejectCandidateRule(candidateRuleId, {
          reason: trimmedComment,
        });
      }

      const updatedReview = await fetchCandidateRule(candidateRuleId);
      setReview(updatedReview);
      setDraft(createRuleDraft(updatedReview.current_rule));
      onReviewChange?.(updatedReview);
      setSaveMessage(
        decisionMode === "approve"
          ? "Candidate Rule approved."
          : "Candidate Rule rejected.",
      );
      const outcome = decisionMode === "approve" ? "approved" : "rejected";
      closeDecisionModal();
      onReviewResolved?.(candidateRuleId, outcome);
    } catch (error: unknown) {
      setErrorMessage(
        describeCandidateRuleError(
          error,
          decisionMode === "approve"
            ? "Unable to approve Candidate Rule."
            : "Unable to reject Candidate Rule.",
        ),
      );
    } finally {
      setIsResolving(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="review-detail content-enter">
        <p className="catalog-status compact">
          <span className="catalog-status-rule" aria-hidden="true" />
          Opening Candidate Rule…
        </p>
      </div>
    );
  }

  if (status === "not_found") {
    return (
      <div className="review-detail content-enter">
        {onBack ? (
          <button type="button" className="detail-back" onClick={onBack}>
            {backLabel}
          </button>
        ) : null}
        <div className="review-not-found reveal">
          <span className="folio">Signal lost</span>
          <h4>Candidate Rule not found</h4>
          <p>
            No Candidate Rule exists for <code>{candidateRuleId}</code>.
          </p>
        </div>
      </div>
    );
  }

  if (status === "error" || review === null || draft === null) {
    return (
      <div className="review-detail content-enter">
        {onBack ? (
          <button type="button" className="detail-back" onClick={onBack}>
            {backLabel}
          </button>
        ) : null}
        <p className="error-banner">{errorMessage}</p>
      </div>
    );
  }

  const rule = review.current_rule;
  const lifecycleClass = lifecycleStateClassName(review.lifecycle_state);
  const extractedCondition = review.extracted_rule.condition;
  const extractedApplicability = review.extracted_rule.applicability;
  const canResolve =
    canEdit && QUEUE_LIFECYCLE_STATES.has(review.lifecycle_state);
  const saveDisabled =
    !canEdit || isSaving || isResolving || unsavedChangeCount === 0;
  const approveDisabled =
    !canResolve || isSaving || isResolving || approvalBlockers.length > 0;
  const rejectDisabled = !canResolve || isSaving || isResolving;
  const hasCommittedEdits = review.committed_rule !== null;

  const pageTitle = citation
    ? formatDocumentTitle(citation.document_id)
    : rule.scope.expense_category ?? review.candidate_rule_id;
  const showEnforceabilityHint =
    draft.enforceability_class !== "enforceable" ||
    draft.enforceability_class !== review.extracted_rule.enforceability_class;

  return (
    <div className="review-detail content-enter">
      <header className="review-detail-head">
        <div className="review-detail-head-row">
          {onBack ? (
            <button type="button" className="detail-back" onClick={onBack}>
              {backLabel}
            </button>
          ) : (
            <span />
          )}
          {differenceCount > 0 || unsavedChangeCount > 0 ? (
            <p className="review-edit-ledger">
              {differenceCount} divergent · {unsavedChangeCount} unsaved
            </p>
          ) : null}
        </div>
        <div className="review-detail-intro">
          <h3>{pageTitle}</h3>
        </div>
        <div className="review-rule-meta">
          <div className="review-rule-meta-head">
            <code>{review.candidate_rule_id}</code>
            <span className={`review-lifecycle ${lifecycleClass}`}>
              {formatLifecycleState(review.lifecycle_state)}
            </span>
            <span
              className={`review-qa-count${review.qa_flags.length > 0 ? " flagged" : " clear"}`}
            >
              {review.qa_flags.length} QA
            </span>
          </div>
        </div>
      </header>

      <div className="review-detail-body">
        {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
        {saveMessage ? <p className="review-save-banner">{saveMessage}</p> : null}

        <div className="review-detail-workspace">
          <QaFlagsBanner flags={review.qa_flags} />

          <form className="review-edit-form" onSubmit={handleSave}>
            <section className="review-detail-panel reveal">
              <ReviewField
                label="Statement"
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
              </ReviewField>

              <ReviewField
                label="Enforceability"
                extractedValue={formatEnforceabilityClass(review.extracted_rule.enforceability_class)}
                changed={draft.enforceability_class !== review.extracted_rule.enforceability_class}
                inputId="candidate-rule-enforceability"
                description={
                  showEnforceabilityHint
                    ? "If you switch away from enforceable, clear the machine-checkable condition before saving."
                    : undefined
                }
              >
                <SearchablePicker
                  label="Enforceability class"
                  inputId="candidate-rule-enforceability"
                  hideLabel
                  value={draft.enforceability_class}
                  options={ENFORCEABILITY_PICKER_OPTIONS}
                  placeholder="Select enforceability class"
                  emptyMessage="No matching classes"
                  disabled={!canEdit || isSaving}
                  mono
                  showAllOnOpen
                  onChange={(nextValue) =>
                    updateDraftState({
                      ...draft,
                      enforceability_class: nextValue as EnforceabilityClass,
                    })
                  }
                />
              </ReviewField>
            </section>

            {citation ? (
              <CitationStrip
                citation={citation}
                currentStatement={draft.statement}
                sections={sections}
                sectionsStatus={sectionsStatus}
                sectionsError={sectionsError}
                selectedSection={selectedSection}
                viewingCitedSection={viewingCitedSection}
                showFullSection={showFullSection}
                sectionsOpen={sectionsOpen}
                sectionFilter={sectionFilter}
                sourceBodyRef={sourceBodyRef}
                onToggleContext={() => setShowFullSection((current) => !current)}
                onBrowseSections={() => setSectionsOpen(true)}
                onSectionFilterChange={setSectionFilter}
                onSectionSelect={handleSectionSelect}
                onCloseSections={() => setSectionsOpen(false)}
              />
            ) : (
              <p className="review-citation-empty reveal">No source linked for this rule.</p>
            )}

            <section
              className="review-detail-panel reveal"
              style={{ "--reveal-delay": "40ms" } as CSSProperties}
            >
              <h4>Scope</h4>
              <div className="review-field-grid cols-2">
                {SCOPE_FIELDS.map((field) => (
                  <ReviewField
                    key={field.key}
                    label={field.label}
                    extractedValue={displayValue(review.extracted_rule.scope[field.key])}
                    changed={
                      normalizeOptionalString(draft.scope[field.key]) !==
                      review.extracted_rule.scope[field.key]
                    }
                    showWasLine={
                      normalizeOptionalString(draft.scope[field.key]) !==
                        review.extracted_rule.scope[field.key] &&
                      hasExtractedBaseline(review.extracted_rule.scope[field.key])
                    }
                    inputId={`candidate-rule-${field.key}`}
                  >
                    <input
                      id={`candidate-rule-${field.key}`}
                      value={draft.scope[field.key]}
                      disabled={!canEdit || isSaving}
                      spellCheck={false}
                      placeholder={field.placeholder}
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
                  </ReviewField>
                ))}
              </div>
            </section>

            <section
              className="review-detail-panel reveal"
              style={{ "--reveal-delay": "80ms" } as CSSProperties}
            >
              <h4>Machine-checkable shape</h4>
              <div className="review-field-grid cols-3 review-condition-row">
                <ReviewField
                  label="Field"
                  extractedValue={displayValue(extractedCondition?.field)}
                  changed={draft.condition.field.trim() !== (extractedCondition?.field ?? "")}
                  showWasLine={
                    draft.condition.field.trim() !== (extractedCondition?.field ?? "") &&
                    hasExtractedBaseline(extractedCondition?.field)
                  }
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
                </ReviewField>

                <ReviewField
                  label="Operator"
                  extractedValue={displayValue(extractedCondition?.operator)}
                  changed={draft.condition.operator.trim() !== (extractedCondition?.operator ?? "")}
                  showWasLine={
                    draft.condition.operator.trim() !== (extractedCondition?.operator ?? "") &&
                    hasExtractedBaseline(extractedCondition?.operator)
                  }
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
                </ReviewField>

                <ReviewField
                  label="Value"
                  extractedValue={displayValue(extractedCondition?.value)}
                  changed={draft.condition.value.trim() !== (extractedCondition?.value ?? "")}
                  showWasLine={
                    draft.condition.value.trim() !== (extractedCondition?.value ?? "") &&
                    hasExtractedBaseline(extractedCondition?.value)
                  }
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
                </ReviewField>
              </div>

              <div className="review-field-grid cols-2 review-applicability-grid">
                <ReviewField
                  label="Aggregation period"
                  extractedValue={formatAggregationPeriod(extractedApplicability?.aggregation_period ?? null)}
                  changed={
                    draft.applicability.aggregation_period !==
                    (extractedApplicability?.aggregation_period ?? "")
                  }
                  showWasLine={
                    draft.applicability.aggregation_period !==
                      (extractedApplicability?.aggregation_period ?? "") &&
                    hasExtractedBaseline(extractedApplicability?.aggregation_period)
                  }
                  inputId="candidate-rule-aggregation-period"
                >
                  <SearchablePicker
                    label="Aggregation period"
                    inputId="candidate-rule-aggregation-period"
                    hideLabel
                    value={draft.applicability.aggregation_period}
                    options={AGGREGATION_PERIOD_PICKER_OPTIONS}
                    placeholder="Select aggregation period"
                    emptyMessage="No matching periods"
                    disabled={!canEdit || isSaving}
                    mono
                    showAllOnOpen
                    onChange={(nextValue) =>
                      updateDraftState({
                        ...draft,
                        applicability: {
                          ...draft.applicability,
                          aggregation_period: nextValue as AggregationPeriod | "",
                        },
                      })
                    }
                  />
                </ReviewField>

                <ReviewField
                  label="Unit"
                  extractedValue={displayValue(extractedApplicability?.unit)}
                  changed={draft.applicability.unit.trim() !== (extractedApplicability?.unit ?? "")}
                  showWasLine={
                    draft.applicability.unit.trim() !== (extractedApplicability?.unit ?? "") &&
                    hasExtractedBaseline(extractedApplicability?.unit)
                  }
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
                </ReviewField>

                <ReviewField
                  label="Currency"
                  extractedValue={displayValue(extractedApplicability?.currency)}
                  changed={
                    normalizeCurrencyForSave(draft.applicability.currency) !==
                    extractedApplicability?.currency
                  }
                  showWasLine={
                    normalizeCurrencyForSave(draft.applicability.currency) !==
                      extractedApplicability?.currency &&
                    hasExtractedBaseline(extractedApplicability?.currency)
                  }
                  inputId="candidate-rule-applicability-currency"
                  description="3-letter ISO code (e.g. USD)."
                >
                  <input
                    id="candidate-rule-applicability-currency"
                    value={draft.applicability.currency}
                    disabled={!canEdit || isSaving}
                    spellCheck={false}
                    placeholder="USD"
                    maxLength={3}
                    autoCapitalize="characters"
                    onChange={(event) =>
                      updateDraftState({
                        ...draft,
                        applicability: {
                          ...draft.applicability,
                          currency: normalizeCurrencyInput(event.target.value),
                        },
                      })
                    }
                  />
                </ReviewField>

                <ReviewField
                  label="Limit basis"
                  extractedValue={displayValue(extractedApplicability?.limit_basis)}
                  changed={
                    normalizeOptionalString(draft.applicability.limit_basis) !==
                    extractedApplicability?.limit_basis
                  }
                  showWasLine={
                    normalizeOptionalString(draft.applicability.limit_basis) !==
                      extractedApplicability?.limit_basis &&
                    hasExtractedBaseline(extractedApplicability?.limit_basis)
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
                </ReviewField>
              </div>
            </section>

            {approvalBlockers.length > 0 ? (
              <section
                className="review-approval-blockers reveal"
                aria-label="Approval blockers"
                style={{ "--reveal-delay": "140ms" } as CSSProperties}
              >
                <div className="review-approval-blockers-head">
                  <span className="review-save-kicker">Approval blockers</span>
                  <p className="review-save-note">
                    Resolve these issues before moving this Candidate Rule into the Structured Policy Store.
                  </p>
                </div>
                <ul className="review-approval-blockers-list">
                  {approvalBlockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </section>
            ) : null}

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
                    ? "Saving preserves the extracted Rule, while approve and reject record an explicit decision for the current Candidate Rule."
                    : "Viewer role can inspect extracted and current values but cannot save or decide Candidate Rules."}
                </p>
              </div>
              <div className="review-save-actions">
                <button
                  type="button"
                  className="review-secondary-button"
                  disabled={approveDisabled}
                  onClick={() => openDecisionModal("approve")}
                >
                  Approve Candidate Rule
                </button>
                <button
                  type="button"
                  className="review-secondary-button review-danger-button"
                  disabled={rejectDisabled}
                  onClick={() => openDecisionModal("reject")}
                >
                  Reject Candidate Rule
                </button>
                <button type="submit" className="review-save-button" disabled={saveDisabled}>
                  {isSaving ? "Saving…" : "Save Candidate Rule"}
                </button>
              </div>
            </footer>

            <details className="review-detail-meta reveal" style={{ "--reveal-delay": "180ms" } as CSSProperties}>
              <summary>Audit & provenance</summary>
              <div className="review-detail-meta-body">
                <dl className="review-detail-grid compact">
                  <div>
                    <dt>Extraction run</dt>
                    <dd>{rule.origin.extraction_run_id ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Principal</dt>
                    <dd>{principal.subject}</dd>
                  </div>
                  {citation ? (
                    <>
                      <div>
                        <dt>Document</dt>
                        <dd>{citation.document_id}</dd>
                      </div>
                      <div>
                        <dt>Version</dt>
                        <dd>{shortenId(citation.document_version_id)}</dd>
                      </div>
                      <div className="review-detail-span">
                        <dt>Citation span</dt>
                        <dd>
                          {citation.section_id} · chars {citation.start_char}–{citation.end_char}
                        </dd>
                      </div>
                    </>
                  ) : null}
                </dl>
                <p className="review-detail-note">
                  {hasCommittedEdits
                    ? "Committed edits remain separate from the extracted Candidate Rule for auditability."
                    : "No committed edits yet. Saving will preserve the extracted Rule and create a reviewed value set."}
                </p>
                {hasCommittedEdits ? (
                  <dl className="review-detail-grid compact">
                    <div className="review-detail-span">
                      <dt>Extracted statement</dt>
                      <dd>{review.extracted_rule.statement}</dd>
                    </div>
                    <div className="review-detail-span">
                      <dt>Current statement</dt>
                      <dd>{rule.statement}</dd>
                    </div>
                  </dl>
                ) : null}
              </div>
            </details>
          </form>
        </div>
      </div>

      {decisionMode ? (
        <div className="review-decision-backdrop" role="presentation">
          <div
            className="review-decision-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={
              decisionMode === "approve"
                ? "Approve Candidate Rule"
                : "Reject Candidate Rule"
            }
          >
            <div className="review-decision-head">
              <span className="review-save-kicker">
                {decisionMode === "approve" ? "Approval record" : "Rejection record"}
              </span>
              <h4>
                {decisionMode === "approve"
                  ? "Approve Candidate Rule"
                  : "Reject Candidate Rule"}
              </h4>
              <p>
                {decisionMode === "approve"
                  ? "Capture the rationale that justifies publishing this Candidate Rule into the Structured Policy Store."
                  : "Capture why this Candidate Rule should leave the current filtered queue."}
              </p>
            </div>

            <label
              className="review-decision-field"
              htmlFor={
                decisionMode === "approve"
                  ? "candidate-rule-approval-rationale"
                  : "candidate-rule-rejection-reason"
              }
            >
              {decisionMode === "approve" ? "Approval rationale" : "Rejection reason"}
              <textarea
                id={
                  decisionMode === "approve"
                    ? "candidate-rule-approval-rationale"
                    : "candidate-rule-rejection-reason"
                }
                value={decisionComment}
                rows={4}
                disabled={isResolving}
                onChange={(event) => {
                  setDecisionComment(event.target.value);
                  if (decisionError !== null) {
                    setDecisionError(null);
                  }
                }}
              />
            </label>

            {decisionError ? <p className="error-banner">{decisionError}</p> : null}

            <div className="review-decision-actions">
              <button
                type="button"
                className="review-secondary-button"
                disabled={isResolving}
                onClick={closeDecisionModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className={
                  decisionMode === "approve"
                    ? "review-save-button"
                    : "review-save-button review-danger-button"
                }
                disabled={isResolving}
                onClick={() => void handleResolveReview()}
              >
                {isResolving
                  ? decisionMode === "approve"
                    ? "Approving…"
                    : "Rejecting…"
                  : decisionMode === "approve"
                    ? "Confirm approval"
                    : "Confirm rejection"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
