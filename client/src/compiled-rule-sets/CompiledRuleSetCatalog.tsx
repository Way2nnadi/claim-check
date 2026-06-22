import { useEffect, useState } from "react";
import { fetchCompiledRuleSet, fetchCompiledRuleSets } from "./api";
import {
  compileStatusVariant,
  describeCompiledRuleSetError,
  formatCompileStatus,
  summarizeCompileCounts,
} from "./format";
import type { CompiledRuleEntry, CompiledRuleSet } from "./types";
import Breadcrumbs from "../shared/ui/Breadcrumbs";
import RecordPageHeader, {
  type RecordPropertyGroup,
} from "../shared/ui/RecordPageHeader";
import StatusPill from "../shared/ui/StatusPill";
import { PolicyVersionPageIcon, RecordPageIcon } from "../shared/ui/PageIcons";
import { shortenId } from "../shared/format/common";
import { formatRelativeTime } from "../shared/format/relativeTime";

interface CompiledRuleSetCatalogProps {
  initialCompiledRuleSetId?: string | null;
}

type CatalogStatus = "loading" | "ready" | "error";
type DetailStatus = "loading" | "ready" | "error" | "not_found";

function CompileEntryRow({ entry }: { entry: CompiledRuleEntry }) {
  const detail =
    entry.status === "compiled"
      ? entry.compiled_rule?.condition
        ? `${entry.compiled_rule.condition.field} ${entry.compiled_rule.condition.operator} ${entry.compiled_rule.condition.value}`
        : "Executable rule"
      : entry.skip_reason ?? entry.error_reason ?? "No detail recorded.";

  return (
    <tr>
      <td className="db-mono">{entry.rule_id}</td>
      <td>{entry.source_rule.statement}</td>
      <td>
        <StatusPill
          label={formatCompileStatus(entry.status)}
          variant={compileStatusVariant(entry.status)}
        />
      </td>
      <td>{detail}</td>
    </tr>
  );
}

function CompiledRuleSetDetail({
  compiledRuleSetId,
  onBack,
}: {
  compiledRuleSetId: string;
  onBack: () => void;
}) {
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [compiledRuleSet, setCompiledRuleSet] = useState<CompiledRuleSet | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrorMessage(null);

    void fetchCompiledRuleSet(compiledRuleSetId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setCompiledRuleSet(response);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const message = describeCompiledRuleSetError(
          error,
          "Unable to load the Compiled Rule Set.",
        );
        setErrorMessage(message);
        setStatus(message.includes("not found") ? "not_found" : "error");
      });

    return () => {
      cancelled = true;
    };
  }, [compiledRuleSetId]);

  if (status === "loading") {
    return (
      <p className="catalog-status">
        <span className="catalog-status-rule" aria-hidden="true" />
        Loading…
      </p>
    );
  }

  if (status === "not_found") {
    return (
      <div className="policy-version-detail">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Compiled Rule Sets
        </button>
        <section className="document-not-found">
          <h4>Compiled Rule Set not found</h4>
          <p>
            No artifact exists for <code>{compiledRuleSetId}</code>.
          </p>
        </section>
      </div>
    );
  }

  if (status === "error" || compiledRuleSet === null) {
    return (
      <div className="policy-version-detail">
        <button type="button" className="detail-back" onClick={onBack}>
          ← Compiled Rule Sets
        </button>
        <p className="error-banner">{errorMessage}</p>
      </div>
    );
  }

  const headerPropertyGroups: RecordPropertyGroup[] = [
    {
      title: "Compile result",
      properties: [
        {
          label: "Summary",
          value: summarizeCompileCounts(compiledRuleSet.summary),
        },
        {
          label: "Compiled rules",
          value: String(compiledRuleSet.summary.compiled),
        },
        {
          label: "Skipped",
          value: String(compiledRuleSet.summary.skipped_non_enforceable),
        },
        ...(compiledRuleSet.summary.compile_error > 0
          ? [
              {
                label: "Errors",
                value: (
                  <StatusPill
                    label={`${compiledRuleSet.summary.compile_error} compile error${compiledRuleSet.summary.compile_error === 1 ? "" : "s"}`}
                    variant="danger"
                  />
                ),
              },
            ]
          : []),
        {
          label: "Compiled by",
          value: compiledRuleSet.compiled_by,
        },
        {
          label: "Compiled",
          value: formatRelativeTime(compiledRuleSet.compiled_at),
        },
      ],
    },
    {
      title: "Pinned to",
      properties: [
        {
          label: "Policy Version",
          value: (
            <code className="db-mono">{compiledRuleSet.policy_version_id}</code>
          ),
        },
        {
          label: "Artifact ID",
          value: (
            <code className="db-mono">{compiledRuleSet.compiled_rule_set_id}</code>
          ),
        },
      ],
    },
  ];

  return (
    <div className="policy-version-detail content-enter">
      <RecordPageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              {
                label: "Compliance",
                icon: <PolicyVersionPageIcon size={14} />,
                onClick: onBack,
              },
              {
                label: shortenId(compiledRuleSet.compiled_rule_set_id, 10),
                icon: <PolicyVersionPageIcon size={14} />,
              },
            ]}
          />
        }
        icon={<RecordPageIcon icon={<PolicyVersionPageIcon size={22} />} />}
        title={compiledRuleSet.compiled_rule_set_id}
        subtitle={`Pinned to ${compiledRuleSet.policy_version_id}`}
        lastUpdated={compiledRuleSet.compiled_at}
        recordId={compiledRuleSet.compiled_rule_set_id}
        propertyGroups={headerPropertyGroups}
        propertyLayout="stacked"
      />

      <h4 className="record-section-heading">Per-rule compile status</h4>
      <div className="db-table-wrap">
        <table className="db-table" aria-label="Compiled rule entries">
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
              <CompileEntryRow key={entry.rule_id} entry={entry} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CompiledRuleSetCatalog({
  initialCompiledRuleSetId = null,
}: CompiledRuleSetCatalogProps) {
  const [status, setStatus] = useState<CatalogStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [compiledRuleSets, setCompiledRuleSets] = useState<CompiledRuleSet[]>([]);
  const [selectedCompiledRuleSetId, setSelectedCompiledRuleSetId] = useState<
    string | null
  >(initialCompiledRuleSetId);

  useEffect(() => {
    let cancelled = false;

    void fetchCompiledRuleSets()
      .then((response) => {
        if (cancelled) {
          return;
        }
        setCompiledRuleSets(response.items);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setErrorMessage(
          describeCompiledRuleSetError(
            error,
            "Unable to load Compiled Rule Sets.",
          ),
        );
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (selectedCompiledRuleSetId) {
    return (
      <CompiledRuleSetDetail
        compiledRuleSetId={selectedCompiledRuleSetId}
        onBack={() => setSelectedCompiledRuleSetId(null)}
      />
    );
  }

  return (
    <div className="catalog-page content-enter">
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
              {compiledRuleSets.length === 0
                ? "No compiled rule sets"
                : `${compiledRuleSets.length} compiled rule set${compiledRuleSets.length === 1 ? "" : "s"}`}
            </p>
          </div>

          {compiledRuleSets.length === 0 ? (
            <div className="catalog-empty reveal">
              <h3>No Compiled Rule Sets yet</h3>
              <p>
                An admin compiles a published Policy Version into an immutable executable artifact.
              </p>
            </div>
          ) : (
            <div className="db-table-wrap">
              <table className="db-table" aria-label="Compiled Rule Sets">
                <thead>
                  <tr>
                    <th scope="col">Compiled Rule Set</th>
                    <th scope="col">Policy Version</th>
                    <th scope="col">Summary</th>
                    <th scope="col">Compiled by</th>
                    <th scope="col">Compiled</th>
                  </tr>
                </thead>
                <tbody>
                  {compiledRuleSets.map((compiledRuleSet) => (
                    <tr key={compiledRuleSet.compiled_rule_set_id}>
                      <td className="db-mono">
                        <button
                          type="button"
                          className="db-row-button"
                          aria-label={`Open ${compiledRuleSet.compiled_rule_set_id}`}
                          onClick={() =>
                            setSelectedCompiledRuleSetId(compiledRuleSet.compiled_rule_set_id)
                          }
                        >
                          {compiledRuleSet.compiled_rule_set_id}
                        </button>
                      </td>
                      <td className="db-mono">{compiledRuleSet.policy_version_id}</td>
                      <td>{summarizeCompileCounts(compiledRuleSet.summary)}</td>
                      <td>{compiledRuleSet.compiled_by}</td>
                      <td title={new Date(compiledRuleSet.compiled_at).toLocaleString()}>
                        {formatRelativeTime(compiledRuleSet.compiled_at)}
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
