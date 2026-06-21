import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ApiError, fetchCandidateRule, fetchDocumentSections } from "./api";
import SectionBrowserDrawer from "./SectionBrowserDrawer";
import {
  describeCandidateRuleError,
  formatEnforceabilityClass,
  formatLifecycleState,
  formatQAFlagCode,
  formatQAFlagDomain,
  formatScopeField,
  lifecycleStateClassName,
  qaFlagDomain,
} from "./candidateRuleFormat";
import type {
  AuthenticatedPrincipal,
  CandidateRuleReview,
  Citation,
  DocumentSection,
  QAFlag,
  RuleException,
} from "./types";

interface CandidateRuleDetailProps {
  candidateRuleId: string;
  principal: AuthenticatedPrincipal;
  onBack: () => void;
}

type DetailStatus = "loading" | "ready" | "not_found" | "error";

function shortenId(value: string, visible = 6): string {
  if (value.length <= visible * 2 + 1) {
    return value;
  }
  return `${value.slice(0, visible)}…${value.slice(-visible)}`;
}

function sectionTitle(section: DocumentSection): string {
  const path = section.heading_path.length > 0 ? section.heading_path : ["Preamble"];
  const label = path[path.length - 1];
  return label.length > 72 ? `${label.slice(0, 71).trimEnd()}…` : label;
}

function sectionContext(section: DocumentSection): string | null {
  const path = section.heading_path.length > 0 ? section.heading_path : ["Preamble"];
  if (path.length <= 1) {
    return null;
  }
  const context = path.slice(0, -1).join(" › ");
  return context.length > 56 ? `${context.slice(0, 55).trimEnd()}…` : context;
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

interface SourceCitationViewProps {
  section: DocumentSection;
  citation: Citation;
  showFullSection: boolean;
}

function SourceCitationView({ section, citation, showFullSection }: SourceCitationViewProps) {
  const split = splitSectionCitation(section, citation);

  if (!showFullSection || !split) {
    return <div className="review-source-passage">{citation.quote}</div>;
  }

  return (
    <div className="review-source-context">
      {split.before ? (
        <p className="review-source-context-muted">{truncateContext(split.before)}</p>
      ) : null}
      <div className="review-source-passage">{split.highlight}</div>
      {split.after ? (
        <p className="review-source-context-muted">{truncateContext(split.after)}</p>
      ) : null}
    </div>
  );
}

interface ExtractedRuleSpecProps {
  rule: CandidateRuleReview["current_rule"];
  qaFlags: QAFlag[];
}

function ExtractedRuleSpec({ rule, qaFlags }: ExtractedRuleSpecProps) {
  const scopeEntries = [
    formatScopeField("Country", rule.scope.country),
    formatScopeField("Expense category", rule.scope.expense_category),
    formatScopeField("Travel type", rule.scope.travel_type),
    formatScopeField("Employee group", rule.scope.employee_group),
    formatScopeField("Effective from", rule.scope.effective_start_date),
    formatScopeField("Effective until", rule.scope.effective_end_date),
  ].filter((entry): entry is string => entry !== null);

  const applicabilityParts: string[] = [];
  if (rule.applicability) {
    applicabilityParts.push(rule.applicability.aggregation_period.replace(/_/g, " "));
    applicabilityParts.push(rule.applicability.unit);
    if (rule.applicability.currency) {
      applicabilityParts.push(rule.applicability.currency);
    }
    if (rule.applicability.limit_basis) {
      applicabilityParts.push(rule.applicability.limit_basis);
    }
  }

  const summaryParts = [
    formatEnforceabilityClass(rule.enforceability_class),
    ...applicabilityParts,
  ];

  const hasSecondaryDetails = scopeEntries.length > 0 || rule.exceptions.length > 0;

  return (
    <div className="review-extracted-spec">
      {qaFlags.length > 0 ? (
        <ul className="review-qa-domain-list">
          {qaFlags.map((flag) => {
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
      ) : null}

      <div className="review-extracted-body">
        <p className="review-extracted-summary">{summaryParts.join(" · ")}</p>

        {rule.condition ? (
          <div className="review-extracted-row">
            <span className="review-extracted-label">Condition</span>
            <code className="review-split-condition">
              {rule.condition.field} {rule.condition.operator} {rule.condition.value}
            </code>
          </div>
        ) : null}

        {hasSecondaryDetails ? (
          <details className="review-extracted-details">
            <summary>Scope & exceptions</summary>
            {scopeEntries.length > 0 ? (
              <ul className="review-split-scope-list">
                {scopeEntries.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            ) : null}
            {rule.exceptions.length > 0 ? (
              <ul className="review-split-exception-list">
                {rule.exceptions.map((exception: RuleException) => (
                  <li key={exception.description}>
                    <p>{exception.description}</p>
                    {exception.required_evidence.length > 0 ? (
                      <p className="review-split-exception-evidence">
                        Evidence: {exception.required_evidence.join(", ")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </details>
        ) : null}
      </div>
    </div>
  );
}

export default function CandidateRuleDetail({
  candidateRuleId,
  onBack,
}: CandidateRuleDetailProps) {
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [review, setReview] = useState<CandidateRuleReview | null>(null);
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

  const loadReview = useCallback(async (): Promise<void> => {
    setStatus("loading");
    setErrorMessage(null);
    setSections([]);
    setSectionsStatus("idle");
    setSectionsError(null);
    setSelectedSectionId(null);
    setSectionsOpen(false);
    setSectionFilter("");
    setShowFullSection(false);

    try {
      const response = await fetchCandidateRule(candidateRuleId);
      setReview(response);
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
        setSections(sectionsResponse.items);
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
        setStatus("not_found");
        return;
      }
      setErrorMessage(
        describeCandidateRuleError(error, "Unable to load Candidate Rule details."),
      );
      setStatus("error");
    }
  }, [candidateRuleId]);

  useEffect(() => {
    void loadReview();
  }, [loadReview]);

  const citation = review?.current_rule.citation ?? null;
  const selectedSection =
    sections.find((section) => section.section_id === selectedSectionId) ?? null;
  const viewingCitedSection =
    Boolean(citation && selectedSection && selectedSection.section_id === citation.section_id);

  function handleSectionSelect(sectionId: string): void {
    setSelectedSectionId(sectionId);
    setShowFullSection(false);
  }

  if (status === "loading") {
    return (
      <div className="review-split content-enter">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Back to queue
        </button>
        <p className="catalog-status compact">
          <span className="catalog-status-rule" aria-hidden="true" />
          Opening review screen…
        </p>
      </div>
    );
  }

  if (status === "not_found") {
    return (
      <div className="review-split content-enter">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Back to queue
        </button>
        <div className="review-not-found reveal">
          <span className="folio">Review · missing</span>
          <p>No Candidate Rule exists for <code>{candidateRuleId}</code>.</p>
        </div>
      </div>
    );
  }

  if (status === "error" || review === null) {
    return (
      <div className="review-split content-enter">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Back to queue
        </button>
        <p className="error-banner">{errorMessage}</p>
      </div>
    );
  }

  const rule = review.current_rule;
  const lifecycleClass = lifecycleStateClassName(review.lifecycle_state);

  return (
    <div className="review-split content-enter">
      <header className="review-verify-head reveal">
        <div className="review-verify-toolbar">
          <button type="button" className="detail-back" onClick={onBack}>
            ← Back to queue
          </button>
          <div className="review-verify-badges">
            <span className={`review-lifecycle ${lifecycleClass}`}>
              {formatLifecycleState(review.lifecycle_state)}
            </span>
            {review.qa_flags.length > 0 ? (
              <span className="review-qa-count flagged">
                {review.qa_flags.length} QA flag{review.qa_flags.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        </div>
        <h1 className="review-verify-statement">{rule.statement}</h1>
        <details className="review-verify-meta">
          <summary>Rule details</summary>
          <dl className="review-verify-meta-grid">
            <div>
              <dt>Rule ID</dt>
              <dd>{review.candidate_rule_id}</dd>
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
                <div>
                  <dt>Citation span</dt>
                  <dd>
                    chars {citation.start_char}–{citation.end_char}
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
        </details>
      </header>

      <div className="review-split-panes review-verify-panes">
        <section
          className="review-split-source reveal"
          aria-label="Source document"
          style={{ "--reveal-delay": "40ms" } as CSSProperties}
        >
          {!citation ? (
            <div className="review-source-empty">
              <div className="review-source-empty-icon" aria-hidden="true">
                <span />
              </div>
              <p className="review-source-empty-title">No source linked</p>
              <p className="review-source-empty-body">
                This rule has no policy excerpt attached, so there is nothing to compare against.
              </p>
            </div>
          ) : (
            <>
              <header className="review-source-compact-head">
                <div className="review-source-compact-top">
                  <p className="review-source-doc">{citation.document_id}</p>
                  {viewingCitedSection ? (
                    <button
                      type="button"
                      className="review-source-context-toggle"
                      onClick={() => setShowFullSection((current) => !current)}
                    >
                      {showFullSection ? "Passage only" : "More context"}
                    </button>
                  ) : null}
                </div>
                {selectedSection ? (
                  <>
                    <p className="review-source-section">{sectionTitle(selectedSection)}</p>
                    {sectionContext(selectedSection) ? (
                      <p className="review-source-breadcrumb">{sectionContext(selectedSection)}</p>
                    ) : null}
                  </>
                ) : null}
              </header>

              {sectionsStatus === "loading" ? (
                <div className="review-source-loading">
                  <span className="catalog-status-rule" aria-hidden="true" />
                  <p>Loading source…</p>
                </div>
              ) : sectionsStatus === "error" ? (
                <div className="review-source-loading">
                  <p className="error-banner">{sectionsError}</p>
                </div>
              ) : sections.length === 0 ? (
                <div className="review-source-empty compact">
                  <p className="review-source-empty-title">No sections found</p>
                  <p className="review-source-empty-body">
                    This document version has no parsed sections yet.
                  </p>
                </div>
              ) : (
                <>
                  <article
                    ref={sourceBodyRef}
                    className="review-source-preview"
                    aria-label="Section content"
                  >
                    {selectedSection ? (
                      viewingCitedSection ? (
                        <SourceCitationView
                          section={selectedSection}
                          citation={citation}
                          showFullSection={showFullSection}
                        />
                      ) : (
                        <div className="review-source-text">
                          {cleanSourceFragment(selectedSection.content)}
                        </div>
                      )
                    ) : (
                      <p className="review-split-empty">Choose a section to read the source text.</p>
                    )}
                  </article>

                  <footer className="review-source-foot">
                    <button
                      type="button"
                      className="review-source-browse-toggle"
                      onClick={() => setSectionsOpen(true)}
                    >
                      Browse sections ({sections.length})
                    </button>
                  </footer>

                  <SectionBrowserDrawer
                    open={sectionsOpen}
                    documentId={citation.document_id}
                    sections={sections}
                    filter={sectionFilter}
                    selectedSectionId={selectedSectionId}
                    citedSectionId={citation.section_id}
                    onFilterChange={setSectionFilter}
                    onSelect={handleSectionSelect}
                    onClose={() => setSectionsOpen(false)}
                  />
                </>
              )}
            </>
          )}
        </section>

        <section
          className="review-split-rule reveal"
          aria-label="Extracted rule"
          style={{ "--reveal-delay": "80ms" } as CSSProperties}
        >
          <h2 className="review-extracted-heading">Extracted rule</h2>
          <ExtractedRuleSpec rule={rule} qaFlags={review.qa_flags} />
        </section>
      </div>
    </div>
  );
}
