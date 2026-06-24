import { useCallback, useEffect, useState } from "react";
import { fetchCompiledRuleSet, fetchCompiledRuleSets } from "./api";
import {
  compileStatusVariant,
  describeCompiledRuleSetError,
  formatCompileStatus,
  summarizeCompileCounts,
} from "./format";
import type { CompiledRuleEntry, CompiledRuleSet } from "./types";
import {
  disableRuleTestCase,
  editRuleTestCase,
  enableRuleTestCase,
  downloadRuleTestRunReport,
  executeRuleTestRun,
  fetchRuleTestCases,
  fetchRuleTestRuns,
  generateRuleTestCases,
} from "../rule-test-cases/api";
import RuleTestCasesSection from "../rule-test-cases/RuleTestCasesSection";
import type { RuleTestCaseStatusAction } from "../rule-test-cases/RuleTestCaseStatusModal";
import type {
  RuleTestCase,
  RuleTestCaseGroup,
  RuleTestRun,
} from "../rule-test-cases/types";
import { describeRuleTestCaseError } from "../rule-test-cases/format";
import {
  buildEditDraft,
  buildEditRequest,
  validateEditDraft,
  type RuleTestCaseEditDraft,
} from "../rule-test-cases/edits";
import Breadcrumbs from "../shared/ui/Breadcrumbs";
import RecordPageHeader, {
  type RecordPropertyGroup,
} from "../shared/ui/RecordPageHeader";
import StatusPill from "../shared/ui/StatusPill";
import { PolicyVersionPageIcon, RecordPageIcon } from "../shared/ui/PageIcons";
import { shortenId } from "../shared/format/common";
import { formatRelativeTime } from "../shared/format/relativeTime";
import { hasAnyRole } from "../shared/permissions";
import type { AuthenticatedPrincipal, Role } from "../shared/auth/types";

interface CompiledRuleSetCatalogProps {
  principal: AuthenticatedPrincipal;
  initialCompiledRuleSetId?: string | null;
  variant?: "full" | "rule-test-cases";
}

const GENERATE_ALLOWED_ROLES: readonly Role[] = ["admin"];
const DISABLE_ALLOWED_ROLES: readonly Role[] = ["approver"];
const EDIT_ALLOWED_ROLES: readonly Role[] = ["approver"];

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
  principal,
  onBack,
  variant = "full",
}: {
  compiledRuleSetId: string;
  principal: AuthenticatedPrincipal;
  onBack: () => void;
  variant?: "full" | "rule-test-cases";
}) {
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [compiledRuleSet, setCompiledRuleSet] = useState<CompiledRuleSet | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ruleTestCaseGroups, setRuleTestCaseGroups] = useState<RuleTestCaseGroup[]>([]);
  const [ruleTestCaseTotal, setRuleTestCaseTotal] = useState(0);
  const [ruleTestCaseActiveCount, setRuleTestCaseActiveCount] = useState(0);
  const [ruleTestCaseDisabledCount, setRuleTestCaseDisabledCount] = useState(0);
  const [ruleTestCaseStatus, setRuleTestCaseStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [ruleTestCaseError, setRuleTestCaseError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isDownloadingReport, setIsDownloadingReport] = useState(false);
  const [latestRuleTestRun, setLatestRuleTestRun] = useState<RuleTestRun | null>(null);
  const [ruleTestRunStatus, setRuleTestRunStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [ruleTestRunError, setRuleTestRunError] = useState<string | null>(null);
  const [statusActionTarget, setStatusActionTarget] = useState<{
    testCase: RuleTestCase;
    mode: RuleTestCaseStatusAction;
  } | null>(null);
  const [statusActionRationale, setStatusActionRationale] = useState("");
  const [statusActionError, setStatusActionError] = useState<string | null>(null);
  const [isStatusActionSubmitting, setIsStatusActionSubmitting] = useState(false);
  const [editTarget, setEditTarget] = useState<RuleTestCase | null>(null);
  const [editDraft, setEditDraft] = useState<RuleTestCaseEditDraft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);
  const canGenerate = hasAnyRole(principal, GENERATE_ALLOWED_ROLES);
  const canRun = canGenerate;
  const canDisable = hasAnyRole(principal, DISABLE_ALLOWED_ROLES);
  const canEdit = hasAnyRole(principal, EDIT_ALLOWED_ROLES);

  const applyRuleTestCaseList = useCallback(
    (response: {
      groups: RuleTestCaseGroup[];
      total_count: number;
      active_count: number;
      disabled_count: number;
    }) => {
      setRuleTestCaseGroups(response.groups);
      setRuleTestCaseTotal(response.total_count);
      setRuleTestCaseActiveCount(response.active_count);
      setRuleTestCaseDisabledCount(response.disabled_count);
      setRuleTestCaseStatus("ready");
    },
    [],
  );

  const loadRuleTestCases = async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setRuleTestCaseStatus("loading");
    }
    setRuleTestCaseError(null);
    const response = await fetchRuleTestCases(compiledRuleSetId);
    applyRuleTestCaseList(response);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setRuleTestCaseError(null);
    try {
      const response = await generateRuleTestCases(compiledRuleSetId);
      applyRuleTestCaseList({
        groups: response.groups,
        total_count: response.generated_count,
        active_count: response.generated_count,
        disabled_count: 0,
      });
    } catch (error: unknown) {
      setRuleTestCaseError(
        describeRuleTestCaseError(error, "Unable to generate Rule Test Cases."),
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRun = async () => {
    setIsRunning(true);
    setRuleTestRunError(null);
    try {
      const run = await executeRuleTestRun(compiledRuleSetId);
      setLatestRuleTestRun(run);
      setRuleTestRunStatus("ready");
    } catch (error: unknown) {
      setRuleTestRunError(
        describeRuleTestCaseError(error, "Unable to execute Rule Test Run."),
      );
    } finally {
      setIsRunning(false);
    }
  };

  const handleDownloadReport = async () => {
    if (latestRuleTestRun === null) {
      return;
    }
    setIsDownloadingReport(true);
    setRuleTestRunError(null);
    try {
      await downloadRuleTestRunReport(latestRuleTestRun.rule_test_run_id);
    } catch (error: unknown) {
      setRuleTestRunError(
        describeRuleTestCaseError(error, "Unable to download Rule Test Run report."),
      );
    } finally {
      setIsDownloadingReport(false);
    }
  };

  const handleStatusActionRequest = (
    testCase: RuleTestCase,
    mode: RuleTestCaseStatusAction,
  ) => {
    setStatusActionTarget({ testCase, mode });
    setStatusActionRationale("");
    setStatusActionError(null);
  };

  const handleStatusActionCancel = () => {
    if (isStatusActionSubmitting) {
      return;
    }
    setStatusActionTarget(null);
    setStatusActionRationale("");
    setStatusActionError(null);
  };

  const handleStatusActionConfirm = async () => {
    if (statusActionTarget === null || statusActionRationale.trim().length === 0) {
      return;
    }
    setIsStatusActionSubmitting(true);
    setStatusActionError(null);
    try {
      const rationale = statusActionRationale.trim();
      if (statusActionTarget.mode === "disable") {
        await disableRuleTestCase(statusActionTarget.testCase.rule_test_case_id, {
          rationale,
        });
      } else {
        await enableRuleTestCase(statusActionTarget.testCase.rule_test_case_id, {
          rationale,
        });
      }
      setStatusActionTarget(null);
      setStatusActionRationale("");
      await loadRuleTestCases({ silent: true });
    } catch (error: unknown) {
      setStatusActionError(
        describeRuleTestCaseError(
          error,
          statusActionTarget.mode === "disable"
            ? "Unable to disable Rule Test Case."
            : "Unable to enable Rule Test Case.",
        ),
      );
    } finally {
      setIsStatusActionSubmitting(false);
    }
  };

  const handleEditRequest = (testCase: RuleTestCase) => {
    setEditTarget(testCase);
    setEditDraft(buildEditDraft(testCase));
    setEditError(null);
  };

  const handleEditCancel = () => {
    if (isEditSubmitting) {
      return;
    }
    setEditTarget(null);
    setEditDraft(null);
    setEditError(null);
  };

  const handleEditConfirm = async () => {
    if (editTarget === null || editDraft === null) {
      return;
    }
    const validationError = validateEditDraft(editTarget, editDraft);
    if (validationError) {
      setEditError(validationError);
      return;
    }

    setIsEditSubmitting(true);
    setEditError(null);
    try {
      const request = buildEditRequest(editTarget, editDraft);
      await editRuleTestCase(editTarget.rule_test_case_id, request);
      setEditTarget(null);
      setEditDraft(null);
      await loadRuleTestCases({ silent: true });
    } catch (error: unknown) {
      setEditError(
        describeRuleTestCaseError(error, "Unable to edit Rule Test Case."),
      );
    } finally {
      setIsEditSubmitting(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrorMessage(null);
    setRuleTestCaseStatus("loading");
    setRuleTestCaseError(null);
    setRuleTestRunStatus("loading");
    setRuleTestRunError(null);

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

    void fetchRuleTestCases(compiledRuleSetId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        applyRuleTestCaseList(response);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setRuleTestCaseError(
          describeRuleTestCaseError(error, "Unable to load Rule Test Cases."),
        );
        setRuleTestCaseStatus("error");
      });

    void fetchRuleTestRuns(compiledRuleSetId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setLatestRuleTestRun(response.items[0] ?? null);
        setRuleTestRunStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setRuleTestRunError(
          describeRuleTestCaseError(error, "Unable to load Rule Test Runs."),
        );
        setRuleTestRunStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [applyRuleTestCaseList, compiledRuleSetId]);

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

  const listLabel =
    variant === "rule-test-cases" ? "Rule Test Cases" : "Compiled Rule Sets";

  return (
    <div className="policy-version-detail content-enter">
      <RecordPageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              {
                label: listLabel,
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

      {variant === "full" ? (
        <>
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
        </>
      ) : null}

      <RuleTestCasesSection
        canGenerate={canGenerate}
        canRun={canRun}
        canDisable={canDisable}
        canEdit={canEdit}
        compiledCount={compiledRuleSet.summary.compiled}
        ruleTestCaseGroups={ruleTestCaseGroups}
        ruleTestCaseTotal={ruleTestCaseTotal}
        ruleTestCaseActiveCount={ruleTestCaseActiveCount}
        ruleTestCaseDisabledCount={ruleTestCaseDisabledCount}
        ruleTestCaseStatus={ruleTestCaseStatus}
        ruleTestCaseError={ruleTestCaseError}
        isGenerating={isGenerating}
        isRunning={isRunning}
        isDownloadingReport={isDownloadingReport}
        latestRuleTestRun={latestRuleTestRun}
        ruleTestRunStatus={ruleTestRunStatus}
        ruleTestRunError={ruleTestRunError}
        statusActionTarget={statusActionTarget}
        statusActionRationale={statusActionRationale}
        statusActionError={statusActionError}
        isStatusActionSubmitting={isStatusActionSubmitting}
        editTarget={editTarget}
        editDraft={editDraft}
        editError={editError}
        isEditSubmitting={isEditSubmitting}
        onGenerate={() => void handleGenerate()}
        onRun={() => void handleRun()}
        onDownloadReport={() => void handleDownloadReport()}
        onStatusActionRequest={handleStatusActionRequest}
        onStatusActionConfirm={() => void handleStatusActionConfirm()}
        onStatusActionCancel={handleStatusActionCancel}
        onStatusActionRationaleChange={setStatusActionRationale}
        onEditRequest={handleEditRequest}
        onEditConfirm={() => void handleEditConfirm()}
        onEditCancel={handleEditCancel}
        onEditDraftChange={setEditDraft}
      />
    </div>
  );
}

export default function CompiledRuleSetCatalog({
  principal,
  initialCompiledRuleSetId = null,
  variant = "full",
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
        principal={principal}
        onBack={() => setSelectedCompiledRuleSetId(null)}
        variant={variant}
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
                ? variant === "rule-test-cases"
                  ? "No compiled rule sets to test"
                  : "No compiled rule sets"
                : `${compiledRuleSets.length} compiled rule set${compiledRuleSets.length === 1 ? "" : "s"}`}
            </p>
          </div>

          {compiledRuleSets.length === 0 ? (
            <div className="catalog-empty reveal">
              <h3>
                {variant === "rule-test-cases"
                  ? "No Compiled Rule Sets to test yet"
                  : "No Compiled Rule Sets yet"}
              </h3>
              <p>
                {variant === "rule-test-cases"
                  ? "Compile a published Policy Version first, then generate and run Rule Test Cases here."
                  : "An admin compiles a published Policy Version into an immutable executable artifact."}
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
