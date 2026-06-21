import { useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import {
  downloadPolicyVersionSnapshot,
  fetchPolicyVersion,
  fetchPolicyVersions,
  publishPolicyVersion,
} from "./api";
import { hasAnyRole } from "./permissions";
import {
  describePolicyVersionError,
  describePolicyVersionPublishError,
  describeRuleOrigin,
  formatEffectiveWindow,
  formatEnforceabilityClass,
  formatPolicyVersionDate,
  formatRuleCount,
  latestPolicyVersionId,
  policyVersionClearanceBlurb,
  summarizeApplicability,
  summarizeRuleScope,
} from "./policyVersionFormat";
import type {
  AuthenticatedPrincipal,
  PolicyVersionSnapshot,
  PolicyVersionSummary,
  Role,
  Rule,
} from "./types";

interface PolicyVersionCatalogProps {
  principal: AuthenticatedPrincipal;
  publishIntentToken?: number;
}

type CatalogStatus = "loading" | "ready" | "error";
type DetailStatus = "loading" | "ready" | "error" | "not_found";

interface PolicyVersionDetailProps {
  policyVersionId: string;
  onBack: () => void;
}

const PUBLISH_ALLOWED_ROLES: readonly Role[] = ["admin", "approver"];

function shortenId(value: string, visible = 8): string {
  if (value.length <= visible * 2 + 1) {
    return value;
  }
  return `${value.slice(0, visible)}…${value.slice(-visible)}`;
}

function summarizePrincipalClearance(principal: AuthenticatedPrincipal): Role {
  if (principal.roles.includes("admin")) {
    return "admin";
  }
  if (principal.roles.includes("approver")) {
    return "approver";
  }
  return "viewer";
}

function hasEffectiveWindow(scope: Rule["scope"]): boolean {
  return Boolean(scope.effective_start_date || scope.effective_end_date);
}

function ruleDetailsEntries(rule: Rule): Array<{ label: string; value: string }> {
  const entries: Array<{ label: string; value: string }> = [
    { label: "ID", value: rule.rule_id },
  ];

  if (hasEffectiveWindow(rule.scope)) {
    entries.push({ label: "Effective", value: formatEffectiveWindow(rule.scope) });
  }

  const applicability = summarizeApplicability(rule.applicability);
  if (applicability !== "Not machine-checkable") {
    entries.push({ label: "Applicability", value: applicability });
  }

  if (rule.origin.rationale) {
    entries.push({ label: "Rationale", value: rule.origin.rationale });
  }

  if (rule.origin.extraction_run_id) {
    entries.push({ label: "Extraction run", value: rule.origin.extraction_run_id });
  }

  if (rule.citation) {
    entries.push({
      label: "Source",
      value: `${rule.citation.document_id} · ${shortenId(rule.citation.document_version_id)} · ${rule.citation.section_id}`,
    });
    entries.push({
      label: "Span",
      value: `${rule.citation.start_char}–${rule.citation.end_char}`,
    });
  }

  return entries;
}

function PolicyRuleCard({ rule }: { rule: Rule }) {
  const details = ruleDetailsEntries(rule);

  return (
    <article className="policy-rule-card">
      <header className="policy-rule-head">
        <h4 className="policy-rule-statement">{rule.statement}</h4>
        <span className={`review-enforceability ${rule.enforceability_class}`}>
          {formatEnforceabilityClass(rule.enforceability_class)}
        </span>
      </header>

      <p className="policy-rule-meta-line">
        {summarizeRuleScope(rule.scope)} · {describeRuleOrigin(rule)}
      </p>

      {rule.condition ? (
        <p className="policy-rule-condition">
          <code>
            {rule.condition.field} {rule.condition.operator} {rule.condition.value}
          </code>
        </p>
      ) : null}

      {rule.citation ? (
        <p className="policy-rule-source" title={rule.citation.quote}>
          {rule.citation.document_id} · {shortenId(rule.citation.section_id, 16)}
        </p>
      ) : null}

      {details.length > 1 ? (
        <details className="policy-rule-details">
          <summary>Details</summary>
          <dl className="policy-rule-details-grid">
            {details.map((entry) => (
              <div key={entry.label}>
                <dt>{entry.label}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      {rule.exceptions.length > 0 ? (
        <ul className="policy-rule-exceptions">
          {rule.exceptions.map((exception) => (
            <li key={`${rule.rule_id}-${exception.description}`}>
              <p>{exception.description}</p>
              {exception.required_evidence.length > 0 ? (
                <span>{exception.required_evidence.join(", ")}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
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
          Loading…
        </p>
      </div>
    );
  }

  if (status === "not_found") {
    return (
      <div className="policy-version-detail">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Versions
        </button>
        <section className="document-not-found">
          <h4>Version not found</h4>
          <p>
            No snapshot exists for <code>{policyVersionId}</code>.
          </p>
        </section>
      </div>
    );
  }

  if (status === "error" || snapshot === null) {
    return (
      <div className="policy-version-detail">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Versions
        </button>
        <p className="error-banner">{errorMessage}</p>
      </div>
    );
  }

  return (
    <div className="policy-version-detail content-enter">
      <header className="policy-version-detail-head">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Versions
        </button>
        <div className="policy-version-detail-head-row">
          <div className="policy-version-detail-intro">
            <h3>{snapshot.policy_version_id}</h3>
            <p className="policy-version-detail-lede">{snapshot.change_summary}</p>
            <p className="catalog-scope policy-version-detail-meta">
              {formatRuleCount(snapshot.rules.length)} · {snapshot.published_by}
            </p>
          </div>
          <div className="policy-version-detail-actions">
            <button
              type="button"
              className="document-command document-command-accent"
              onClick={() => void handleDownload()}
              disabled={isDownloading}
            >
              {isDownloading ? "Exporting…" : "Export JSON"}
            </button>
          </div>
        </div>
        {downloadError ? <p className="error-banner">{downloadError}</p> : null}
      </header>

      <section className="policy-version-rule-stage reveal">
        {snapshot.rules.length === 0 ? (
          <p className="review-detail-empty">No rules in this version.</p>
        ) : (
          <ul className="policy-rule-stack" aria-label="Published rules">
            {snapshot.rules.map((rule, index) => (
              <li key={rule.rule_id}>
                <div
                  className="reveal"
                  style={{ "--reveal-delay": `${50 + index * 55}ms` } as CSSProperties}
                >
                  <PolicyRuleCard rule={rule} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function PolicyVersionCatalog({
  principal,
  publishIntentToken = 0,
}: PolicyVersionCatalogProps) {
  const [status, setStatus] = useState<CatalogStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [policyVersions, setPolicyVersions] = useState<PolicyVersionSummary[]>([]);
  const [selectedPolicyVersionId, setSelectedPolicyVersionId] = useState<string | null>(
    null,
  );
  const [publishPanelOpen, setPublishPanelOpen] = useState(false);
  const [policyVersionIdDraft, setPolicyVersionIdDraft] = useState("");
  const [changeSummaryDraft, setChangeSummaryDraft] = useState("");
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const canPublish = hasAnyRole(principal, PUBLISH_ALLOWED_ROLES);
  const latestId = latestPolicyVersionId(policyVersions);
  const clearanceRole = summarizePrincipalClearance(principal);

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

  useEffect(() => {
    if (!canPublish || publishIntentToken === 0) {
      return;
    }
    setSelectedPolicyVersionId(null);
    setPublishError(null);
    setPublishPanelOpen(true);
  }, [canPublish, publishIntentToken]);

  function handleOpenPublishPanel(): void {
    if (!canPublish) {
      return;
    }
    setPublishError(null);
    setPublishPanelOpen(true);
  }

  function handleClosePublishPanel(): void {
    if (isPublishing) {
      return;
    }
    setPublishError(null);
    setPublishPanelOpen(false);
  }

  async function handlePublish(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canPublish || isPublishing) {
      return;
    }

    const nextPolicyVersionId = policyVersionIdDraft.trim();
    const nextChangeSummary = changeSummaryDraft.trim();

    if (!nextPolicyVersionId) {
      setPublishError("Enter a Policy Version id.");
      return;
    }
    if (!nextChangeSummary) {
      setPublishError("Enter a change summary.");
      return;
    }

    setIsPublishing(true);
    setPublishError(null);

    try {
      const published = await publishPolicyVersion({
        policy_version_id: nextPolicyVersionId,
        change_summary: nextChangeSummary,
      });

      const optimisticSummary: PolicyVersionSummary = {
        policy_version_id: published.policy_version_id,
        published_by: published.published_by,
        change_summary: nextChangeSummary,
        rule_count: published.rule_count,
        created_at: new Date().toISOString(),
      };

      setPolicyVersions((current) => [
        optimisticSummary,
        ...current.filter(
          (version) => version.policy_version_id !== published.policy_version_id,
        ),
      ]);
      setStatus("ready");
      setErrorMessage(null);
      setPublishPanelOpen(false);
      setPolicyVersionIdDraft("");
      setChangeSummaryDraft("");
      setSelectedPolicyVersionId(published.policy_version_id);

      void fetchPolicyVersions()
        .then((response) => {
          setPolicyVersions(response.items);
        })
        .catch(() => {
          // Keep the optimistic list update if the ledger refresh fails.
        });
    } catch (error: unknown) {
      setPublishError(describePolicyVersionPublishError(error));
    } finally {
      setIsPublishing(false);
    }
  }

  if (selectedPolicyVersionId) {
    return (
      <PolicyVersionDetail
        policyVersionId={selectedPolicyVersionId}
        onBack={() => setSelectedPolicyVersionId(null)}
      />
    );
  }

  return (
    <div className="policy-version-catalog content-enter">
      <header className="policy-version-catalog-head reveal">
        <div className="policy-version-command-deck">
          <div className="policy-version-command-copy">
            <p className="eyebrow">Release Desk</p>
            <h3>Publish immutable Policy Versions from approved Rules.</h3>
            <p className="policy-version-catalog-lede">
              Cut a new snapshot with a precise identifier and a change summary
              that explains why this release exists.
            </p>
          </div>
          <div className="policy-version-command-actions">
            <button
              type="button"
              className="document-command document-command-accent"
              onClick={handleOpenPublishPanel}
              disabled={!canPublish}
            >
              Stage publish
            </button>
          </div>
        </div>
        <p className="policy-version-clearance">
          {policyVersionClearanceBlurb(clearanceRole)}
        </p>
      </header>

      {publishPanelOpen ? (
        <section
          className="policy-version-publisher reveal"
          aria-labelledby="policy-version-publisher-heading"
        >
          <div className="policy-version-publisher-head">
            <div>
              <p className="eyebrow">Publication Order</p>
              <h3 id="policy-version-publisher-heading">Publish Policy Version</h3>
              <p className="policy-version-publisher-lede">
                The snapshot will include every currently approved Rule and lock
                them into an immutable Policy Version.
              </p>
            </div>
            <button
              type="button"
              className="detail-back"
              onClick={handleClosePublishPanel}
              disabled={isPublishing}
            >
              Close
            </button>
          </div>

          <form
            className="policy-version-publisher-form"
            onSubmit={(event) => void handlePublish(event)}
          >
            <label htmlFor="policy-version-id">
              Policy Version id
              <input
                id="policy-version-id"
                name="policy-version-id"
                value={policyVersionIdDraft}
                spellCheck={false}
                disabled={isPublishing}
                onChange={(event) => {
                  setPolicyVersionIdDraft(event.target.value);
                  setPublishError(null);
                }}
              />
            </label>

            <label className="policy-version-publisher-summary" htmlFor="change-summary">
              Change summary
              <textarea
                id="change-summary"
                name="change-summary"
                rows={4}
                value={changeSummaryDraft}
                disabled={isPublishing}
                onChange={(event) => {
                  setChangeSummaryDraft(event.target.value);
                  setPublishError(null);
                }}
              />
            </label>

            <dl className="policy-version-publisher-ledger">
              <div>
                <dt>Source set</dt>
                <dd>All currently approved Rules</dd>
              </div>
              <div>
                <dt>Snapshot law</dt>
                <dd>Immutable after publication</dd>
              </div>
              <div>
                <dt>Outcome</dt>
                <dd>Redirects into the new release ledger entry</dd>
              </div>
            </dl>

            {publishError ? (
              <p className="error-banner" role="alert">
                {publishError}
              </p>
            ) : null}

            <div className="policy-version-publisher-actions">
              <button
                type="button"
                className="document-command"
                onClick={handleClosePublishPanel}
                disabled={isPublishing}
              >
                Dismiss
              </button>
              <button
                type="submit"
                className="document-command document-command-accent"
                disabled={isPublishing || !canPublish}
              >
                {isPublishing ? "Publishing…" : "Publish snapshot"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {status === "loading" ? (
        <p className="catalog-status">
          <span className="catalog-status-rule" aria-hidden="true" />
          Loading…
        </p>
      ) : null}

      {status === "error" ? <p className="error-banner">{errorMessage}</p> : null}

      {status === "ready" && policyVersions.length === 0 ? (
        <div className="catalog-empty reveal">
          <h3>No published versions</h3>
          <p>Published releases appear here.</p>
        </div>
      ) : null}

      {status === "ready" && policyVersions.length > 0 ? (
        <>
          <p className="catalog-scope">
            {policyVersions.length} published
            {latestId ? ` · latest ${latestId}` : ""}
          </p>

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
                    <h3>{version.policy_version_id}</h3>
                  </div>
                  <p className="policy-version-summary">{version.change_summary}</p>
                  <dl className="catalog-meta">
                    <div>
                      <dt>Released</dt>
                      <dd>{formatPolicyVersionDate(version.created_at)}</dd>
                    </div>
                    <div>
                      <dt>Rules</dt>
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
                      Latest
                    </p>
                    <p className="catalog-open-hint">Open →</p>
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
