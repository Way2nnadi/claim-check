import { downloadPolicyVersionSnapshot, fetchPolicyVersion, fetchPolicyVersions } from "./api";
import { formatPolicyVersionDate } from "./format";
import type { PolicyVersionSnapshot, PolicyVersionSummary } from "./types";
import { formatEnforceabilityClass } from "../rules/format";
import type { Rule } from "../rules/types";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { hasAnyRole } from "../shared/permissions";
import { describePolicyVersionError, describeRuleOrigin, formatEffectiveWindow, formatRuleCount, latestPolicyVersionId, summarizeApplicability, summarizeRuleScope } from "./format";
import type { AuthenticatedPrincipal, Role } from "../shared/auth/types";
import {
  compilePolicyVersion,
  fetchCompiledRuleSetsForPolicyVersion,
} from "../compiled-rule-sets/api";
import type { CompiledRuleEntry, CompiledRuleSet } from "../compiled-rule-sets/types";
import {
  compileStatusVariant,
  describeCompiledRuleSetError,
  formatCompileStatus,
  summarizeCompileCounts,
} from "../compiled-rule-sets/format";

import PublishPolicyVersionDrawer, {
  type PublishedPolicyVersionResult,
} from "./PublishPolicyVersionDrawer";
import Breadcrumbs from "../shared/ui/Breadcrumbs";
import RecordPageHeader, { type RecordPropertyGroup } from "../shared/ui/RecordPageHeader";
import StatusPill from "../shared/ui/StatusPill";
import { PolicyVersionPageIcon, RecordPageIcon } from "../shared/ui/PageIcons";

interface PolicyVersionCatalogProps {
  principal: AuthenticatedPrincipal;
}

type CatalogStatus = "loading" | "ready" | "error";
type DetailStatus = "loading" | "ready" | "error" | "not_found";

interface PolicyVersionDetailProps {
  policyVersionId: string;
  principal: AuthenticatedPrincipal;
  onBack: () => void;
}

const PUBLISH_ALLOWED_ROLES: readonly Role[] = ["admin", "approver"];
const COMPILE_ALLOWED_ROLES: readonly Role[] = ["admin"];

function shortenId(value: string, visible = 8): string {
  if (value.length <= visible * 2 + 1) {
    return value;
  }
  return `${value.slice(0, visible)}…${value.slice(-visible)}`;
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

function PolicyRuleCard({
  rule,
  compileEntry,
}: {
  rule: Rule;
  compileEntry?: CompiledRuleEntry;
}) {
  const details = ruleDetailsEntries(rule);

  return (
    <article className="policy-rule-card">
      <header className="policy-rule-head">
        <h4 className="policy-rule-statement">{rule.statement}</h4>
        <div className="policy-rule-badges">
          <span className={`review-enforceability ${rule.enforceability_class}`}>
            {formatEnforceabilityClass(rule.enforceability_class)}
          </span>
          {compileEntry ? (
            <StatusPill
              label={formatCompileStatus(compileEntry.status)}
              variant={compileStatusVariant(compileEntry.status)}
            />
          ) : null}
        </div>
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
          <div className="db-table-wrap policy-rule-details-table-wrap">
            <table className="db-table policy-rule-details-table" aria-label="Rule details">
              <tbody>
                {details.map((entry) => (
                  <tr key={entry.label}>
                    <th scope="row">{entry.label}</th>
                    <td className="db-mono">{entry.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
  principal,
  onBack,
}: PolicyVersionDetailProps) {
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [snapshot, setSnapshot] = useState<PolicyVersionSnapshot | null>(null);
  const [compiledRuleSet, setCompiledRuleSet] = useState<CompiledRuleSet | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);

  const canCompile = hasAnyRole(principal, COMPILE_ALLOWED_ROLES);

  useEffect(() => {
    let cancelled = false;

    setStatus("loading");
    setErrorMessage(null);
    setCompiledRuleSet(null);

    void Promise.all([
      fetchPolicyVersion(policyVersionId),
      fetchCompiledRuleSetsForPolicyVersion(policyVersionId),
    ])
      .then(([policyVersion, compiledRuleSets]) => {
        if (cancelled) {
          return;
        }
        setSnapshot(policyVersion);
        setCompiledRuleSet(compiledRuleSets.items[0] ?? null);
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

  async function handleCompile(): Promise<void> {
    setIsCompiling(true);
    setCompileError(null);

    try {
      const nextCompiledRuleSet = await compilePolicyVersion(policyVersionId);
      setCompiledRuleSet(nextCompiledRuleSet);
    } catch (error: unknown) {
      setCompileError(
        describeCompiledRuleSetError(error, "Unable to compile this Policy Version."),
      );
    } finally {
      setIsCompiling(false);
    }
  }

  function compileStatusForRule(ruleId: string): CompiledRuleEntry | undefined {
    return compiledRuleSet?.entries.find((entry) => entry.rule_id === ruleId);
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
      <RecordPageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              {
                label: "Policy Versions",
                icon: <PolicyVersionPageIcon size={14} />,
                onClick: onBack,
              },
              {
                label: snapshot.policy_version_id,
                icon: <PolicyVersionPageIcon size={14} />,
              },
            ]}
          />
        }
        icon={
          <RecordPageIcon icon={<PolicyVersionPageIcon size={22} />} />
        }
        title={snapshot.policy_version_id}
        subtitle={snapshot.change_summary}
        recordId={snapshot.policy_version_id}
        propertyGroups={
          [
            {
              title: "Publication",
              properties: [
                {
                  label: "Published by",
                  value: snapshot.published_by,
                },
                {
                  label: "Status",
                  value: <StatusPill label="Published" variant="success" />,
                },
                {
                  label: "Rules",
                  value: formatRuleCount(snapshot.rules.length),
                },
              ],
            },
            {
              title: "Compile",
              properties: [
                {
                  label: "Status",
                  value: compiledRuleSet ? (
                    <StatusPill label="Compiled" variant="success" />
                  ) : (
                    <StatusPill label="Not compiled" variant="neutral" />
                  ),
                },
                ...(compiledRuleSet
                  ? [
                      {
                        label: "Summary",
                        value: summarizeCompileCounts(compiledRuleSet.summary),
                      },
                      {
                        label: "Artifact",
                        value: (
                          <code
                            className="db-mono"
                            title={compiledRuleSet.compiled_rule_set_id}
                          >
                            {shortenId(compiledRuleSet.compiled_rule_set_id)}
                          </code>
                        ),
                      },
                    ]
                  : []),
              ],
            },
          ] satisfies RecordPropertyGroup[]
        }
        propertyLayout="stacked"
        actions={
          <>
            {canCompile ? (
              <button
                type="button"
                className="document-command"
                onClick={() => void handleCompile()}
                disabled={isCompiling}
              >
                {isCompiling
                  ? "Compiling…"
                  : compiledRuleSet
                    ? "Re-open compile"
                    : "Compile Rule Set"}
              </button>
            ) : null}
            <button
              type="button"
              className="document-command document-command-accent"
              onClick={() => void handleDownload()}
              disabled={isDownloading}
            >
              {isDownloading ? "Exporting…" : "Export JSON"}
            </button>
          </>
        }
      />
      {compileError ? <p className="error-banner">{compileError}</p> : null}
      {downloadError ? <p className="error-banner">{downloadError}</p> : null}

      {compiledRuleSet ? (
        <>
          <h4 className="record-section-heading">Compile summary</h4>
          <div className="db-table-wrap">
            <table className="db-table" aria-label="Compiled rule status">
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">Statement</th>
                  <th scope="col">Status</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {compiledRuleSet.entries.map((entry) => (
                  <tr key={entry.rule_id}>
                    <td className="db-mono">{entry.rule_id}</td>
                    <td>{entry.source_rule.statement}</td>
                    <td>
                      <StatusPill
                        label={formatCompileStatus(entry.status)}
                        variant={compileStatusVariant(entry.status)}
                      />
                    </td>
                    <td>
                      {entry.skip_reason ??
                        entry.error_reason ??
                        (entry.compiled_rule
                          ? `${entry.compiled_rule.condition.field} ${entry.compiled_rule.condition.operator} ${entry.compiled_rule.condition.value}`
                          : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h4 className="record-section-heading">Published rules</h4>
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
                  <PolicyRuleCard
                    rule={rule}
                    compileEntry={compileStatusForRule(rule.rule_id)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function PolicyVersionCatalog({ principal }: PolicyVersionCatalogProps) {
  const [status, setStatus] = useState<CatalogStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [policyVersions, setPolicyVersions] = useState<PolicyVersionSummary[]>([]);
  const [selectedPolicyVersionId, setSelectedPolicyVersionId] = useState<string | null>(
    null,
  );
  const [publishDrawerOpen, setPublishDrawerOpen] = useState(false);

  const canPublish = hasAnyRole(principal, PUBLISH_ALLOWED_ROLES);
  const latestId = latestPolicyVersionId(policyVersions);

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

  function handleClosePublishDrawer(): void {
    setPublishDrawerOpen(false);
  }

  function handlePublished(result: PublishedPolicyVersionResult): void {
    const optimisticSummary: PolicyVersionSummary = {
      policy_version_id: result.policy_version_id,
      published_by: result.published_by,
      change_summary: result.change_summary,
      rule_count: result.rule_count,
      created_at: new Date().toISOString(),
    };

    setPolicyVersions((current) => [
      optimisticSummary,
      ...current.filter(
        (version) => version.policy_version_id !== result.policy_version_id,
      ),
    ]);
    setStatus("ready");
    setErrorMessage(null);
    setPublishDrawerOpen(false);
    setSelectedPolicyVersionId(result.policy_version_id);

    void fetchPolicyVersions()
      .then((response) => {
        setPolicyVersions(response.items);
      })
      .catch(() => {
        // Keep the optimistic list update if the ledger refresh fails.
      });
  }

  if (selectedPolicyVersionId) {
    return (
      <PolicyVersionDetail
        policyVersionId={selectedPolicyVersionId}
        principal={principal}
        onBack={() => setSelectedPolicyVersionId(null)}
      />
    );
  }

  return (
    <div className="policy-version-catalog catalog-page content-enter">
      <PublishPolicyVersionDrawer
        open={publishDrawerOpen}
        onClose={handleClosePublishDrawer}
        onPublished={handlePublished}
      />

      {status === "loading" ? (
        <p className="catalog-status">
          <span className="catalog-status-rule" aria-hidden="true" />
          Loading…
        </p>
      ) : null}

      {status === "error" ? <p className="error-banner">{errorMessage}</p> : null}

      {status === "ready" ? (
        <>
          <div className="catalog-toolbar">
            <p className="catalog-scope">
              {policyVersions.length === 0
                ? "No published versions"
                : `${policyVersions.length} published${latestId ? ` · latest ${latestId}` : ""}`}
            </p>
            {canPublish ? (
              <button
                type="button"
                className={`document-command${publishDrawerOpen ? " active" : ""}`}
                aria-expanded={publishDrawerOpen}
                onClick={() => {
                  setSelectedPolicyVersionId(null);
                  setPublishDrawerOpen((current) => !current);
                }}
              >
                Publish Policy Version
              </button>
            ) : null}
          </div>

          {policyVersions.length === 0 ? (
            <div className="catalog-empty reveal">
              <h3>No published versions</h3>
              <p>Published policy versions will appear here.</p>
            </div>
          ) : (
            <div className="db-table-wrap">
              <table className="db-table" aria-label="Policy versions">
                <thead>
                  <tr>
                    <th scope="col">Version</th>
                    <th scope="col">Summary</th>
                    <th scope="col">Published</th>
                    <th scope="col">Rules</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {policyVersions.map((version) => (
                    <tr key={version.policy_version_id}>
                      <td className="db-mono">
                        <button
                          type="button"
                          className="db-row-button"
                          aria-label={`Open ${version.policy_version_id}`}
                          onClick={() => setSelectedPolicyVersionId(version.policy_version_id)}
                        >
                          {version.policy_version_id}
                        </button>
                      </td>
                      <td>{version.change_summary}</td>
                      <td>{formatPolicyVersionDate(version.created_at)}</td>
                      <td>{formatRuleCount(version.rule_count)}</td>
                      <td>
                        {version.policy_version_id === latestId ? (
                          <span className="db-tag latest">Latest</span>
                        ) : (
                          <span className="db-tag">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
