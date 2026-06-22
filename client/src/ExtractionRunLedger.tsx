import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { formatUploadDate } from "./documentFormat";
import {
	formatExtractionRunStatus,
	formatPinningLabel,
	shortenId,
} from "./extractionRunFormat";
import type { ExtractionRun, ExtractionRunStatus } from "./types";

type StatusTab = "all" | ExtractionRunStatus;

interface ExtractionRunLedgerProps {
	runs: ExtractionRun[];
	showDocumentContext?: boolean;
	emptyMessage?: string;
	filteredEmptyMessage?: string;
	onOpenRun?: (extractionRunId: string) => void;
}

const STATUS_TABS: { id: StatusTab; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "completed", label: "Completed" },
	{ id: "failed", label: "Failed" },
];

function countByStatus(runs: ExtractionRun[]): Record<StatusTab, number> {
	let completed = 0;
	let failed = 0;
	for (const run of runs) {
		if (run.status === "completed") {
			completed += 1;
		} else {
			failed += 1;
		}
	}
	return { all: runs.length, completed, failed };
}

export default function ExtractionRunLedger({
	runs,
	showDocumentContext = false,
	emptyMessage = "No Extraction Runs recorded for this scope.",
	filteredEmptyMessage = "No Extraction Runs match this status.",
	onOpenRun,
}: ExtractionRunLedgerProps) {
	const [statusTab, setStatusTab] = useState<StatusTab>("all");

	const statusCounts = useMemo(() => countByStatus(runs), [runs]);

	const filteredRuns = useMemo(() => {
		if (statusTab === "all") {
			return runs;
		}
		return runs.filter((run) => run.status === statusTab);
	}, [runs, statusTab]);

	if (runs.length === 0) {
		return (
			<div className="extraction-empty reveal">
				<span className="folio">Run log · empty</span>
				<p>{emptyMessage}</p>
			</div>
		);
	}

	return (
		<div className="extraction-ledger-wrap">
			<div
				className="extraction-status-tabs"
				role="tablist"
				aria-label="Filter by run status"
			>
				{STATUS_TABS.map((tab) => {
					const count = statusCounts[tab.id];
					const isSelected = statusTab === tab.id;

					return (
						<button
							key={tab.id}
							type="button"
							role="tab"
							id={`extraction-status-tab-${tab.id}`}
							className={`extraction-status-tab${isSelected ? " active" : ""}${tab.id !== "all" ? ` ${tab.id}` : ""}`}
							aria-selected={isSelected}
							aria-controls="extraction-run-panel"
							onClick={() => setStatusTab(tab.id)}
						>
							<span>{tab.label}</span>
							<span className="extraction-status-tab-count">{count}</span>
						</button>
					);
				})}
			</div>

			{filteredRuns.length === 0 ? (
				<div className="extraction-empty reveal compact">
					<p>{filteredEmptyMessage}</p>
				</div>
			) : (
				<ol
					id="extraction-run-panel"
					className="extraction-ledger"
					role="tabpanel"
					aria-labelledby={`extraction-status-tab-${statusTab}`}
					aria-label="Extraction Run history"
				>
					{filteredRuns.map((run, index) => {
						const isFailed = run.status === "failed";

						return (
							<li key={run.extraction_run_id}>
								<article
									className={`extraction-run reveal${isFailed ? " failed" : " completed"}`}
									style={
										{
											"--reveal-delay": `${40 + index * 45}ms`,
										} as CSSProperties
									}
								>
									<header className="extraction-run-head">
										<div className="extraction-run-idline">
											{showDocumentContext ? (
												<h3 className="extraction-run-document">
													{run.document_id}
												</h3>
											) : null}
											<code title={run.extraction_run_id}>
												{shortenId(run.extraction_run_id)}
											</code>
											<span
												className={`extraction-status${isFailed ? " failed" : " completed"}`}
											>
												{formatExtractionRunStatus(run.status)}
											</span>
										</div>
										<time
											className="extraction-run-time"
											dateTime={run.created_at}
										>
											{formatUploadDate(run.created_at)}
										</time>
									</header>

									{showDocumentContext ? (
										<dl className="extraction-context-grid">
											<div>
												<dt>Version</dt>
												<dd title={run.document_version_id}>
													{shortenId(run.document_version_id)}
												</dd>
											</div>
											<div>
												<dt>Candidate rules</dt>
												<dd>{run.candidate_rule_count}</dd>
											</div>
										</dl>
									) : null}

									<dl className="extraction-pin-grid">
										<div>
											<dt>Prompt template</dt>
											<dd>
												{formatPinningLabel(
													run.prompt_template_id,
													run.prompt_template_version,
												)}
											</dd>
										</div>
										<div>
											<dt>Model configuration</dt>
											<dd>
												{formatPinningLabel(
													run.model_configuration_id,
													run.model_configuration_version,
												)}
											</dd>
										</div>
										{!showDocumentContext ? (
											<div>
												<dt>Candidate rules</dt>
												<dd>{run.candidate_rule_count}</dd>
											</div>
										) : null}
									</dl>

									{isFailed && run.failure_detail ? (
										<div className="extraction-failure" role="alert">
											<span className="extraction-failure-label">
												Failure detail
											</span>
											<p>{run.failure_detail}</p>
										</div>
									) : null}

									{onOpenRun && !isFailed ? (
										<footer className="extraction-run-foot">
											<button
												type="button"
												className="review-open-button"
												disabled={run.candidate_rule_count === 0}
												aria-label={`Review ${run.candidate_rule_count} Candidate Rule${run.candidate_rule_count === 1 ? "" : "s"} from ${run.extraction_run_id}`}
												onClick={() => onOpenRun(run.extraction_run_id)}
											>
												Open
											</button>
										</footer>
									) : null}
								</article>
							</li>
						);
					})}
				</ol>
			)}
		</div>
	);
}
