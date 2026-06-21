import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  downloadPolicyVersionSnapshot,
  fetchPolicyVersion,
  fetchPolicyVersions,
} from "./api";
import {
  describePolicyVersionError,
  describeRuleOrigin,
  formatEffectiveWindow,
  formatEnforceabilityClass,
  formatLifecycleState,
  formatPolicyVersionDate,
  formatRuleCount,
  latestPolicyVersionId,
  policyVersionClearanceBlurb,
  summarizeApplicability,
  summarizeRuleScope,
} from "./policyVersionFormat";
import { lifecycleStateClassName } from "./candidateRuleFormat";
import type {
  AuthenticatedPrincipal,
  PolicyVersionSnapshot,
  PolicyVersionSummary,
  Rule,
} from "./types";

interface PolicyVersionCatalogProps {
  principal: AuthenticatedPrincipal;
}

type CatalogStatus = "loading" | "ready" | "error";
type DetailStatus = "loading" | "ready" | "error" | "not_found";

interface PolicyVersionDetailProps {
  policyVersionId: string;
  onBack: () => void;
}

function renderRuleMetadata(rule: Rule) {
  return (
    <dl className="policy-rule-grid">
      <div>
        <dt>Scope</dt>
        <dd>{summarizeRuleScope(rule.scope)}</dd>
      </div>
      <div>
        <dt>Effective window</dt>
        <dd>{formatEffectiveWindow(rule.scope)}</dd>
      </div>
      <div>
        <dt>Origin</dt>
        <dd>{describeRuleOrigin(rule)}</dd>
      </div>
      <div>
        <dt>Applicability</dt>
        <dd>{summarizeApplicability(rule.applicability)}</dd>
      </div>
      <div className="policy-rule-grid-span">
        <dt>Condition</dt>
        <dd>
          {rule.condition ? (
            <code>
              {rule.condition.field} {rule.condition.operator} {rule.condition.value}
            </code>
          ) : (
            "No machine condition"
          )}
        </dd>
      </div>
      {rule.origin.rationale ? (
        <div className="policy-rule-grid-span">
          <dt>Manual rationale</dt>
          <dd>{rule.origin.rationale}</dd>
        </div>
      ) : null}
      {rule.citation ? (
        <div className="policy-rule-grid-span">
          <dt>Citation</dt>
          <dd>
            <blockquote className="policy-rule-quote">{rule.citation.quote}</blockquote>
            <p className="policy-rule-citation-meta">
              {rule.citation.document_id} · {rule.citation.document_version_id} ·{" "}
              {rule.citation.section_id} · chars {rule.citation.start_char}–
              {rule.citation.end_char}
            </p>
          </dd>
        </div>
      ) : (
        <div className="policy-rule-grid-span">
          <dt>Citation</dt>
          <dd>No Citation attached</dd>
        </div>
      )}
    </dl>
  );
}

function PolicyVersionDetail({
  policyVersionId,
  onBack,
}: PolicyVersionDetailProps) {
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [snapshot, setSnapshot] = useState<PolicyVersionSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setStatus("loading");
    setErrorMessage(null);

    void fetchPolicyVersion(policyVersionId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setSnapshot(response);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const message = describePolicyVersionError(
          error,
          "Unable to load the published Policy Version.",
        );
        setErrorMessage(message);
        setStatus(message === "Policy Version was not found." ? "not_found" : "error");
      });

    return () => {
      cancelled = true;
    };
  }, [policyVersionId]);

  async function handleDownload(): Promise<void> {
    setIsDownloading(true);
    setDownloadError(null);

    try {
      await downloadPolicyVersionSnapshot(policyVersionId);
    } catch (error: unknown) {
      setDownloadError(
        describePolicyVersionError(error, "Unable to export the immutable JSON snapshot."),
      );
    } finally {
      setIsDownloading(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="catalog-stage">
        <p className="catalog-status">
          <span className="catalog-status-rule" aria-hidden="true" />
          Retrieving immutable snapshot…
        </p>
      </div>
    );
  }

  if (status === "not_found") {
    return (
      <div className="policy-version-detail">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Back to Policy Versions
        </button>
        <section className="document-not-found">
          <span className="folio">Release ledger · missing node</span>
          <h4>Policy Version not found</h4>
          <p>
            The published snapshot <code>{policyVersionId}</code> could not be resolved.
          </p>
        </section>
      </div>
    );
  }

  if (status === "error" || snapshot === null) {
    return (
      <div className="policy-version-detail">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Back to Policy Versions
        </button>
        <p className="error-banner">{errorMessage}</p>
      </div>
    );
  }

  return (
    <div className="policy-version-detail content-enter">
      <header className="policy-version-detail-head">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Back to Policy Versions
        </button>
        <div className="policy-version-detail-head-row">
          <div className="policy-version-detail-intro">
            <span className="folio">Published release · immutable</span>
            <h3>{snapshot.policy_version_id}</h3>
            <p className="policy-version-detail-lede">{snapshot.change_summary}</p>
          </div>
          <div className="policy-version-detail-actions">
            <button
              type="button"
              className="document-command document-command-accent"
              onClick={() => void handleDownload()}
              disabled={isDownloading}
            >
              {isDownloading ? "Exporting…" : "Export JSON snapshot"}
            </button>
          </div>
        </div>
        <div className="policy-version-detail-badges">
          <span className="version-badge">{formatRuleCount(snapshot.rules.length)}</span>
          <span className="version-badge muted">Published by {snapshot.published_by}</span>
        </div>
        {downloadError ? <p className="error-banner">{downloadError}</p> : null}
      </header>

      <section className="policy-version-rule-stage reveal">
        <div className="policy-version-rule-stage-head">
          <h4>Rule snapshot</h4>
          <p>
            Published Rules stay frozen in this Policy Version so downstream systems can pin
            to a reproducible snapshot.
          </p>
        </div>

        {snapshot.rules.length === 0 ? (
          <p className="review-detail-empty">
            This Policy Version contains no published Rules.
          </p>
        ) : (
          <ul className="policy-rule-stack" aria-label="Published Rule snapshot">
            {snapshot.rules.map((rule, index) => {
              const lifecycleClass = lifecycleStateClassName(rule.lifecycle_state);

              return (
                <li key={rule.rule_id}>
                  <article
                    className="policy-rule-card reveal"
                    style={{ "--reveal-delay": `${50 + index * 55}ms` } as CSSProperties}
                  >
                    <div className="policy-rule-head">
                      <div>
                        <p className="policy-rule-id">{rule.rule_id}</p>
                        <h4>{rule.statement}</h4>
                      </div>
                      <div className="review-detail-badges">
                        <span className={`review-lifecycle ${lifecycleClass}`}>
                          {formatLifecycleState(rule.lifecycle_state)}
                        </span>
                        <span className={`review-enforceability ${rule.enforceability_class}`}>
                          {formatEnforceabilityClass(rule.enforceability_class)}
                        </span>
                      </div>
                    </div>

                    {renderRuleMetadata(rule)}

                    <section className="policy-rule-exceptions">
                      <h5>Exceptions</h5>
                      {rule.exceptions.length === 0 ? (
                        <p className="review-detail-note">
                          No Exceptions recorded in this published snapshot.
                        </p>
                      ) : (
                        <ul>
                          {rule.exceptions.map((exception) => (
                            <li key={`${rule.rule_id}-${exception.description}`}>
                              <p>{exception.description}</p>
                              <span>
                                Evidence:{" "}
                                {exception.required_evidence.length > 0
                                  ? exception.required_evidence.join(", ")
                                  : "None specified"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function PolicyVersionCatalog({
  principal,
}: PolicyVersionCatalogProps) {
  const [status, setStatus] = useState<CatalogStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [policyVersions, setPolicyVersions] = useState<PolicyVersionSummary[]>([]);
  const [selectedPolicyVersionId, setSelectedPolicyVersionId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    void fetchPolicyVersions()
      .then((response) => {
        if (cancelled) {
          return;
        }
        setPolicyVersions(response.items);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setErrorMessage(
          describePolicyVersionError(
            error,
            "Unable to load the published Policy Version ledger.",
          ),
        );
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (selectedPolicyVersionId) {
    return (
      <PolicyVersionDetail
        policyVersionId={selectedPolicyVersionId}
        onBack={() => setSelectedPolicyVersionId(null)}
      />
    );
  }

  const latestId = latestPolicyVersionId(policyVersions);
  const primaryRole = principal.roles[0] ?? "viewer";

  return (
    <div className="policy-version-catalog content-enter">
      <header className="policy-version-catalog-head reveal">
        <span className="folio">Release ledger · published</span>
        <p className="policy-version-catalog-lede">
          Browse published Policy Versions, inspect the frozen Rule snapshot, and export the
          attachment that downstream systems pin to for reproducible runs.
        </p>
        <p className="policy-version-clearance">{policyVersionClearanceBlurb(primaryRole)}</p>
      </header>

      {status === "loading" ? (
        <p className="catalog-status">
          <span className="catalog-status-rule" aria-hidden="true" />
          Consulting the release ledger…
        </p>
      ) : null}

      {status === "error" ? <p className="error-banner">{errorMessage}</p> : null}

      {status === "ready" && policyVersions.length === 0 ? (
        <div className="catalog-empty reveal">
          <span className="folio">Release ledger · null set</span>
          <h3>No published Policy Versions</h3>
          <p>
            Once approved Rules are published, immutable Policy Versions will appear here for
            browse and export.
          </p>
        </div>
      ) : null}

      {status === "ready" && policyVersions.length > 0 ? (
        <>
          <div className="catalog-header">
            <p className="catalog-count">
              <span className="folio">{policyVersions.length} published</span>
            </p>
            <p className="catalog-status">
              <span className="catalog-status-rule" aria-hidden="true" />
              Latest snapshot: {latestId}
            </p>
          </div>

          <ul className="catalog-grid" aria-label="Published Policy Version catalog">
            {policyVersions.map((version, index) => (
              <li key={version.policy_version_id}>
                <button
                  type="button"
                  className="catalog-folio policy-version-folio reveal"
                  style={{ "--reveal-delay": `${80 + index * 65}ms` } as CSSProperties}
                  aria-label={`Open Policy Version ${version.policy_version_id}`}
                  onClick={() => setSelectedPolicyVersionId(version.policy_version_id)}
                >
                  <div className="catalog-folio-head">
                    <p className="catalog-slug">Policy Version</p>
                    <h3>{version.policy_version_id}</h3>
                  </div>
                  <p className="policy-version-summary">{version.change_summary}</p>
                  <dl className="catalog-meta">
                    <div>
                      <dt>Published by</dt>
                      <dd>{version.published_by}</dd>
                    </div>
                    <div>
                      <dt>Released</dt>
                      <dd>{formatPolicyVersionDate(version.created_at)}</dd>
                    </div>
                    <div>
                      <dt>Contents</dt>
                      <dd>{formatRuleCount(version.rule_count)}</dd>
                    </div>
                  </dl>
                  <div className="catalog-folio-foot">
                    <p
                      className={
                        version.policy_version_id === latestId
                          ? "catalog-flag"
                          : "catalog-flag is-empty"
                      }
                      aria-hidden={version.policy_version_id !== latestId}
                    >
                      Latest published snapshot
                    </p>
                    <div className="policy-version-folio-foot">
                      <span className="version-badge">{formatRuleCount(version.rule_count)}</span>
                      <p className="catalog-open-hint">Inspect snapshot →</p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
