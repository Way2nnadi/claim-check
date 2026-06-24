import type { ReactNode } from "react";
import SearchablePicker from "../shared/ui/SearchablePicker";
import {
	ComplianceReviewPageIcon,
	DocumentPageIcon,
	EvaluationRunPageIcon,
	ExtractionRunPageIcon,
	ExpenseReportPageIcon,
	PolicyVersionPageIcon,
	RulePageIcon,
} from "../shared/ui/PageIcons";
import { AUDIT_ENTITY_TYPE_OPTIONS } from "./format";

const ENTITY_TYPE_ICONS: Record<string, ReactNode> = {
	candidate_rule: <RulePageIcon size={14} />,
	compliance_evaluation_run: <EvaluationRunPageIcon size={14} />,
	compliance_review: <ComplianceReviewPageIcon size={14} />,
	document_version: <DocumentPageIcon size={14} />,
	expense_report: <ExpenseReportPageIcon size={14} />,
	extraction_run: <ExtractionRunPageIcon size={14} />,
	policy_version: <PolicyVersionPageIcon size={14} />,
	rule: <RulePageIcon size={14} />,
	rule_test_case: <RulePageIcon size={14} />,
};

interface EntityTypeFilterPickerProps {
	value: string;
	onChange: (entityType: string) => void;
}

export default function EntityTypeFilterPicker({
	value,
	onChange,
}: EntityTypeFilterPickerProps) {
	return (
		<SearchablePicker
			label="Entity type"
			value={value}
			placeholder="All entity types"
			emptyMessage="No matching entity types"
			clearable
			showAllOnOpen
			onChange={onChange}
			options={AUDIT_ENTITY_TYPE_OPTIONS.filter((option) => option.value !== "").map(
				(option) => ({
					value: option.value,
					label: option.label,
					icon: ENTITY_TYPE_ICONS[option.value],
				}),
			)}
		/>
	);
}
