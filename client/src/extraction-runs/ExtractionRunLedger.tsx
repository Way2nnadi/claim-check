import { formatExtractionRunStatus, formatPinningLabel, shortenId } from "./format";
import type { ExtractionRun, ExtractionRunStatus } from "./types";
import { Fragment, useMemo, useState } from "react";
import { formatUploadDate } from "../policy-documents/format";
import FilterTabs from "../shared/ui/FilterTabs";

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
	emptyMessage = "No extraction runs for this scope.",
	filteredEmptyMessage = "No extraction runs match this filter.",
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
				<p>{emptyMessage}</p>
			</div>
		);
	}

	return (
		<div className="extraction-ledger-wrap">
			<FilterTabs
				tabs={STATUS_TABS.map((tab) => ({
					id: tab.id,
					label: tab.label,
					count: statusCounts[tab.id],
				}))}
				activeTabId={statusTab}
				onTabChange={(tabId) => setStatusTab(tabId as StatusTab)}
				ariaLabel="Filter by run status"
				idPrefix="extraction-status-tab"
				panelId="extraction-run-panel"
			/>

			{filteredRuns.length === 0 ? (
				<div
					id="extraction-run-panel"
					className="extraction-empty reveal compact"
					role="tabpanel"
					aria-labelledby={`extraction-status-tab-${statusTab}`}
				>
					<p>{filteredEmptyMessage}</p>
				</div>
			) : (
				<div
					id="extraction-run-panel"
					className="db-table-wrap extraction-run-table-scroll"
					role="tabpanel"
					aria-labelledby={`extraction-status-tab-${statusTab}`}
				>
					<table className="db-table extraction-run-table" aria-label="Extraction runs">
						<thead>
							<tr>
								<th scope="col">Run</th>
								<th scope="col">Status</th>
								{showDocumentContext ? (
									<>
										<th scope="col">Document</th>
										<th scope="col">Version</th>
									</>
								) : (
									<>
										<th scope="col">Prompt</th>
										<th scope="col">Model</th>
									</>
								)}
								<th scope="col">Rules</th>
								<th scope="col">Recorded</th>
								{onOpenRun ? <th scope="col" /> : null}
							</tr>
						</thead>
						<tbody>
							{filteredRuns.map((run) => {
								const isFailed = run.status === "failed";

								return (
									<Fragment key={run.extraction_run_id}>
										<tr className="extraction-run-row">
											<td className="db-mono extraction-run-col-run" title={run.extraction_run_id}>
												{shortenId(run.extraction_run_id)}
											</td>
											<td className="extraction-run-col-status">
												<span
													className={`extraction-status${isFailed ? " failed" : " completed"}`}
												>
													{formatExtractionRunStatus(run.status)}
												</span>
											</td>
											{showDocumentContext ? (
												<>
													<td className="extraction-run-col-document">{run.document_id}</td>
													<td
														className="db-mono extraction-run-col-version"
														title={run.document_version_id}
													>
														{shortenId(run.document_version_id)}
													</td>
												</>
											) : (
												<>
													<td className="extraction-run-col-prompt">
														{formatPinningLabel(
															run.prompt_template_id,
															run.prompt_template_version,
														)}
													</td>
													<td className="extraction-run-col-model">
														{formatPinningLabel(
															run.model_configuration_id,
															run.model_configuration_version,
														)}
													</td>
												</>
											)}
											<td className="extraction-run-col-rules">{run.candidate_rule_count}</td>
											<td className="extraction-run-col-recorded">
												<time dateTime={run.created_at}>
													{formatUploadDate(run.created_at)}
												</time>
											</td>
											{onOpenRun ? (
												<td className="db-actions extraction-run-col-actions">
													{!isFailed ? (
														<button
															type="button"
															className="db-link"
															disabled={run.candidate_rule_count === 0}
															aria-label={`Review rules from ${run.extraction_run_id}`}
															onClick={() => onOpenRun(run.extraction_run_id)}
														>
															Open
														</button>
													) : (
														<span className="db-secondary">—</span>
													)}
												</td>
											) : null}
										</tr>
									</Fragment>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
