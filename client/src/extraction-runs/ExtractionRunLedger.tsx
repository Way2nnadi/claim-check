import { formatExtractionRunStatus, formatPinningLabel, shortenId } from "./format";
import type { ExtractionRun, ExtractionRunStatus } from "./types";
import { useMemo, useState } from "react";
import { formatUploadDate } from "../policy-documents/format";

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
					className="db-table-wrap"
					role="tabpanel"
					aria-labelledby={`extraction-status-tab-${statusTab}`}
				>
					<table className="db-table" aria-label="Extraction runs">
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
									<tr key={run.extraction_run_id}>
										<td className="db-mono" title={run.extraction_run_id}>
											{shortenId(run.extraction_run_id)}
										</td>
										<td>
											<span
												className={`extraction-status${isFailed ? " failed" : " completed"}`}
											>
												{formatExtractionRunStatus(run.status)}
											</span>
											{isFailed && run.failure_detail ? (
												<span className="db-secondary">{run.failure_detail}</span>
											) : null}
										</td>
										{showDocumentContext ? (
											<>
												<td>{run.document_id}</td>
												<td className="db-mono" title={run.document_version_id}>
													{shortenId(run.document_version_id)}
												</td>
											</>
										) : (
											<>
												<td className="db-secondary">
													{formatPinningLabel(
														run.prompt_template_id,
														run.prompt_template_version,
													)}
												</td>
												<td className="db-secondary">
													{formatPinningLabel(
														run.model_configuration_id,
														run.model_configuration_version,
													)}
												</td>
											</>
										)}
										<td>{run.candidate_rule_count}</td>
										<td>
											<time dateTime={run.created_at}>
												{formatUploadDate(run.created_at)}
											</time>
										</td>
										{onOpenRun ? (
											<td className="db-actions">
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
													<span
														className="db-secondary"
														title={run.failure_detail ?? undefined}
													>
														Failed
													</span>
												)}
											</td>
										) : null}
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
