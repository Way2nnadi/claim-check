import type { CandidateRuleReview } from "./types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedPrincipal } from "../shared/auth/types";
import userEvent from "@testing-library/user-event";

import CandidateRuleLedger from "./CandidateRuleLedger";

const principal: AuthenticatedPrincipal = {
	subject: "approver-user",
	roles: ["approver"],
	auth_backend: "local",
};

function buildReview(
	overrides: Partial<CandidateRuleReview> = {},
): CandidateRuleReview {
	return {
		candidate_rule_id: "rule-meals-cap",
		lifecycle_state: "extracted",
		current_rule: {
			rule_id: "rule-meals-cap",
			statement: "Meals are capped at $75 per day.",
			enforceability_class: "enforceable",
			lifecycle_state: "extracted",
			origin: {
				source_type: "extracted",
				extraction_run_id: "extract-expense-v1",
				rationale: null,
			},
			scope: {
				country: null,
				expense_category: "meals",
				travel_type: null,
				employee_group: "employees",
				effective_start_date: null,
				effective_end_date: null,
			},
			citation: {
				document_id: "expense-policy",
				document_version_id: "docv-expense-v1",
				section_id: "meals#abc",
				quote: "Meals are capped at $75 per day.",
				start_char: 0,
				end_char: 32,
			},
			condition: {
				field: "meal.amount",
				operator: "<=",
				value: "75",
			},
			applicability: {
				aggregation_period: "per_day",
				unit: "money",
				currency: "USD",
				limit_basis: "per employee",
			},
			exceptions: [],
		},
		extracted_rule: {
			rule_id: "rule-meals-cap",
			statement: "Meals are capped at $75 per day.",
			enforceability_class: "enforceable",
			lifecycle_state: "extracted",
			origin: {
				source_type: "extracted",
				extraction_run_id: "extract-expense-v1",
				rationale: null,
			},
			scope: {
				country: null,
				expense_category: "meals",
				travel_type: null,
				employee_group: "employees",
				effective_start_date: null,
				effective_end_date: null,
			},
			citation: {
				document_id: "expense-policy",
				document_version_id: "docv-expense-v1",
				section_id: "meals#abc",
				quote: "Meals are capped at $75 per day.",
				start_char: 0,
				end_char: 32,
			},
			condition: {
				field: "meal.amount",
				operator: "<=",
				value: "75",
			},
			applicability: {
				aggregation_period: "per_day",
				unit: "money",
				currency: "USD",
				limit_basis: "per employee",
			},
			exceptions: [],
		},
		committed_rule: null,
		qa_flags: [],
		reingestion_diff_category: "unchanged",
		...overrides,
	};
}

function renderLedger(
	reviews: CandidateRuleReview[],
	options: {
		selectedCandidateRuleIds?: Set<string>;
		selectableCandidateRuleIds?: Set<string>;
		onToggleCandidateRuleSelection?: (candidateRuleId: string) => void;
		onToggleAllCandidateRuleSelections?: () => void;
		onOpenReview?: (candidateRuleId: string) => void;
		onLifecycleTabChange?: (tab: "queue" | "flagged" | "archive" | "all") => void;
	} = {},
) {
	const selectableCandidateRuleIds =
		options.selectableCandidateRuleIds ??
		new Set(reviews.map((review) => review.candidate_rule_id));
	const selectedCandidateRuleIds =
		options.selectedCandidateRuleIds ?? new Set<string>();

	return render(
		<CandidateRuleLedger
			allReviews={reviews}
			reviews={reviews}
			lifecycleTab="queue"
			tabCounts={{ queue: reviews.length }}
			scopeLabel={`${reviews.length} awaiting review`}
			principal={principal}
			onLifecycleTabChange={options.onLifecycleTabChange ?? vi.fn()}
			onOpenReview={options.onOpenReview ?? vi.fn()}
			onApproveReview={vi.fn()}
			onRejectReview={vi.fn()}
			selectedCandidateRuleIds={selectedCandidateRuleIds}
			selectableCandidateRuleIds={selectableCandidateRuleIds}
			canBulkApprove
			bulkApproveDisabled={selectedCandidateRuleIds.size === 0}
			isBulkApproving={false}
			onToggleCandidateRuleSelection={
				options.onToggleCandidateRuleSelection ?? vi.fn()
			}
			onToggleAllCandidateRuleSelections={
				options.onToggleAllCandidateRuleSelections ?? vi.fn()
			}
			onClearCandidateRuleSelections={vi.fn()}
			onBulkApprove={vi.fn()}
		/>,
	);
}

describe("CandidateRuleLedger", () => {
	it("selects an individual low-risk row via checkbox", async () => {
		const onToggle = vi.fn();
		const review = buildReview();

		renderLedger([review], {
			onToggleCandidateRuleSelection: onToggle,
		});

		await userEvent.click(
			screen.getByRole("checkbox", {
				name: "Select Candidate Rule rule-meals-cap",
			}),
		);

		expect(onToggle).toHaveBeenCalledWith("rule-meals-cap");
	});

	it("disables selection for changed or flagged Candidate Rules", () => {
		const lowRiskReview = buildReview({
			candidate_rule_id: "rule-meals-cap",
			reingestion_diff_category: "unchanged",
			qa_flags: [],
		});
		const changedReview = buildReview({
			candidate_rule_id: "rule-lodging-cap",
			current_rule: {
				...buildReview().current_rule,
				rule_id: "rule-lodging-cap",
				statement: "Lodging is capped at $250 per night.",
			},
			reingestion_diff_category: "changed",
			qa_flags: [],
		});

		renderLedger([lowRiskReview, changedReview], {
			selectableCandidateRuleIds: new Set(["rule-meals-cap"]),
		});

		expect(
			screen.getByRole("checkbox", {
				name: "Select Candidate Rule rule-meals-cap",
			}),
		).toBeEnabled();
		expect(
			screen.getByRole("checkbox", {
				name: "Select Candidate Rule rule-lodging-cap",
			}),
		).toBeDisabled();
	});

	it("toggles all selectable rows from the bulk checkbox", async () => {
		const onToggleAll = vi.fn();
		const firstReview = buildReview({ candidate_rule_id: "rule-meals-cap" });
		const secondReview = buildReview({
			candidate_rule_id: "rule-lodging-cap",
			current_rule: {
				...buildReview().current_rule,
				rule_id: "rule-lodging-cap",
				statement: "Lodging is capped at $250 per night.",
			},
		});

		renderLedger([firstReview, secondReview], {
			onToggleAllCandidateRuleSelections: onToggleAll,
		});

		await userEvent.click(
			screen.getByRole("checkbox", {
				name: "Select all low-risk visible Candidate Rules",
			}),
		);

		expect(onToggleAll).toHaveBeenCalledTimes(1);
	});

	it("supports keyboard navigation across review rows", async () => {
		const onOpenReview = vi.fn();
		const firstReview = buildReview({ candidate_rule_id: "rule-meals-cap" });
		const secondReview = buildReview({
			candidate_rule_id: "rule-lodging-cap",
			current_rule: {
				...buildReview().current_rule,
				rule_id: "rule-lodging-cap",
				statement: "Lodging is capped at $250 per night.",
			},
		});
		const user = userEvent.setup();

		renderLedger([firstReview, secondReview], { onOpenReview });

		const firstRow = screen
			.getByText("Meals are capped at $75 per day.")
			.closest("article");
		const secondRow = screen
			.getByText("Lodging is capped at $250 per night.")
			.closest("article");

		expect(firstRow).not.toBeNull();
		expect(secondRow).not.toBeNull();

		firstRow?.focus();
		expect(firstRow).toHaveFocus();

		await user.keyboard("{ArrowDown}");
		expect(secondRow).toHaveFocus();

		await user.keyboard("{ArrowUp}");
		expect(firstRow).toHaveFocus();

		await user.keyboard("{Enter}");
		expect(onOpenReview).toHaveBeenCalledWith("rule-meals-cap");
	});

	it("switches lifecycle tabs from the tablist", async () => {
		const onLifecycleTabChange = vi.fn();
		const review = buildReview();

		renderLedger([review], { onLifecycleTabChange });

		await userEvent.click(screen.getByRole("tab", { name: /Archive/i }));

		expect(onLifecycleTabChange).toHaveBeenCalledWith("archive");
	});
});
