import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { ApiError, fetchCandidateRule } from "./api";
import {
  describeCandidateRuleError,
  formatEnforceabilityClass,
  formatLifecycleState,
  formatQAFlagCode,
  lifecycleStateClassName,
} from "./candidateRuleFormat";
import type { AuthenticatedPrincipal, CandidateRuleReview } from "./types";

interface CandidateRuleDetailProps {
  candidateRuleId: string;
  principal: AuthenticatedPrincipal;
  onBack: () => void;
}

type DetailStatus = "loading" | "ready" | "not_found" | "error";

export default function CandidateRuleDetail({
  candidateRuleId,
  principal,
  onBack,
}: CandidateRuleDetailProps) {
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [review, setReview] = useState<CandidateRuleReview | null>(null);

  const loadReview = useCallback(async (): Promise<void> => {
    setStatus("loading");
    setErrorMessage(null);

    try {
      const response = await fetchCandidateRule(candidateRuleId);
      setReview(response);
      setStatus("ready");
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

  if (status === "loading") {
    return (
      <div className="review-detail content-enter">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Back to queue
        </button>
        <p className="catalog-status compact">
          <span className="catalog-status-rule" aria-hidden="true" />
          Opening dossier…
        </p>
      </div>
    );
  }

  if (status === "not_found") {
    return (
      <div className="review-detail content-enter">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Back to queue
        </button>
        <div className="review-not-found reveal">
          <span className="folio">Dossier · missing</span>
          <p>No Candidate Rule exists for <code>{candidateRuleId}</code>.</p>
        </div>
      </div>
    );
  }

  if (status === "error" || review === null) {
    return (
      <div className="review-detail content-enter">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Back to queue
        </button>
        <p className="error-banner">{errorMessage}</p>
      </div>
    );
  }

  const rule = review.current_rule;
  const citation = rule.citation;
  const lifecycleClass = lifecycleStateClassName(review.lifecycle_state);
  const hasEdits = review.committed_rule !== null;

  return (
    <div className="review-detail content-enter">
      <header className="review-detail-head">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Back to queue
        </button>
        <div className="review-detail-head-row">
          <div className="review-detail-intro">
            <span className="folio">Candidate Rule dossier · read-only</span>
            <h3>{review.candidate_rule_id}</h3>
            <p className="review-detail-lede">{rule.statement}</p>
          </div>
          <div className="review-detail-badges">
            <span className={`review-lifecycle ${lifecycleClass}`}>
              {formatLifecycleState(review.lifecycle_state)}
            </span>
            <span className={`review-enforceability ${rule.enforceability_class}`}>
              {formatEnforceabilityClass(rule.enforceability_class)}
            </span>
            <span
              className={`review-qa-count${review.qa_flags.length > 0 ? " flagged" : " clear"}`}
            >
              {review.qa_flags.length} QA flag{review.qa_flags.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </header>

      <section className="review-detail-panel reveal">
        <h4>Provenance</h4>
        <dl className="review-detail-grid">
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
                <dd>{citation.document_version_id}</dd>
              </div>
              <div className="review-detail-span">
                <dt>Citation</dt>
                <dd>
                  <blockquote className="review-citation-quote">{citation.quote}</blockquote>
                  <p className="review-citation-meta">
                    {citation.section_id} · chars {citation.start_char}–{citation.end_char}
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

      {rule.condition || rule.applicability ? (
        <section className="review-detail-panel reveal" style={{ "--reveal-delay": "60ms" } as CSSProperties}>
          <h4>Machine-checkable shape</h4>
          <dl className="review-detail-grid">
            {rule.condition ? (
              <div className="review-detail-span">
                <dt>Condition</dt>
                <dd>
                  <code>
                    {rule.condition.field} {rule.condition.operator} {rule.condition.value}
                  </code>
                </dd>
              </div>
            ) : null}
            {rule.applicability ? (
              <>
                <div>
                  <dt>Aggregation</dt>
                  <dd>{rule.applicability.aggregation_period.replace("_", " ")}</dd>
                </div>
                <div>
                  <dt>Unit</dt>
                  <dd>{rule.applicability.unit}</dd>
                </div>
                {rule.applicability.currency ? (
                  <div>
                    <dt>Currency</dt>
                    <dd>{rule.applicability.currency}</dd>
                  </div>
                ) : null}
              </>
            ) : null}
          </dl>
        </section>
      ) : null}

      <section
        className="review-detail-panel reveal"
        style={{ "--reveal-delay": "90ms" } as CSSProperties}
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

      {hasEdits ? (
        <section
          className="review-detail-panel reveal"
          style={{ "--reveal-delay": "120ms" } as CSSProperties}
        >
          <h4>Review lineage</h4>
          <p className="review-detail-note">
            Extracted values are preserved separately from committed edits. Full diff and approval
            controls arrive in a later slice.
          </p>
          <dl className="review-detail-grid">
            <div className="review-detail-span">
              <dt>Extracted statement</dt>
              <dd>{review.extracted_rule.statement}</dd>
            </div>
            {review.committed_rule ? (
              <div className="review-detail-span">
                <dt>Committed statement</dt>
                <dd>{review.committed_rule.statement}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      <p className="review-detail-readonly-note reveal" style={{ "--reveal-delay": "150ms" } as CSSProperties}>
        Read-only dossier — approve, reject, and edit actions ship in the next review slice.
      </p>
    </div>
  );
}
