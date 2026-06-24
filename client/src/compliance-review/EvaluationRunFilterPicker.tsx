import type { ComplianceEvaluationRun } from "../compliance-evaluation-runs/types";
import SearchablePicker from "../shared/ui/SearchablePicker";
import { ExpenseReportPageIcon } from "../shared/ui/PageIcons";
import { shortenId } from "../shared/format/common";
import { actionableCountForRun } from "./ComplianceReviewLedger";

interface EvaluationRunFilterPickerProps {
  value: string;
  runs: ComplianceEvaluationRun[];
  onChange: (complianceEvaluationRunId: string) => void;
}

export default function EvaluationRunFilterPicker({
  value,
  runs,
  onChange,
}: EvaluationRunFilterPickerProps) {
  return (
    <SearchablePicker
      label="Evaluation run"
      value={value}
      placeholder="All runs"
      emptyMessage="No matching evaluation runs"
      clearable
      showAllOnOpen
      mono
      onChange={onChange}
      options={runs.map((run) => ({
        value: run.compliance_evaluation_run_id,
        label: shortenId(run.compliance_evaluation_run_id, 18),
        secondary: shortenId(run.expense_report_id, 12),
        meta: `${actionableCountForRun(run)} actionable`,
        icon: <ExpenseReportPageIcon size={14} />,
      }))}
    />
  );
}
