import type { CandidateRuleValue } from "./types";
import { describe, expect, it } from "vitest";
import { buildCandidateRuleUpdatePayload, buildManualRuleRequest, createEmptyManualRuleDraft, createRuleDraft, validateManualRuleDraft } from "./ruleDraft";

const baseRule: CandidateRuleValue = {
	rule_id: "rule-1",
	statement: "Domestic meals are capped at $75 per day.",
	enforceability_class: "enforceable",
	lifecycle_state: "extracted",
	origin: {
		source_type: "extracted",
		extraction_run_id: "extract-1",
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
		document_version_id: "docv-1",
		section_id: "meals#abc",
		quote: "Domestic meals are capped at $75 per day.",
		start_char: 10,
		end_char: 50,
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
};

describe("createRuleDraft", () => {
	it("maps a Candidate Rule into editable draft fields", () => {
		const draft = createRuleDraft(baseRule);

		expect(draft.statement).toBe(baseRule.statement);
		expect(draft.scope.expense_category).toBe("meals");
		expect(draft.condition.value).toBe("75");
		expect(draft.applicability.currency).toBe("USD");
	});
});

describe("buildCandidateRuleUpdatePayload", () => {
	it("returns an empty payload when the draft matches the current rule", () => {
		const draft = createRuleDraft(baseRule);

		expect(buildCandidateRuleUpdatePayload(draft, baseRule)).toEqual({});
	});

	it("includes changed statement and threshold values", () => {
		const draft = createRuleDraft(baseRule);
		draft.statement = "Domestic meals are capped at $80 per day.";
		draft.condition.value = "80";

		expect(buildCandidateRuleUpdatePayload(draft, baseRule)).toEqual({
			statement: "Domestic meals are capped at $80 per day.",
			condition: {
				field: "meal.amount",
				operator: "<=",
				value: "80",
			},
		});
	});
});

describe("validateManualRuleDraft", () => {
	it("requires core manual rule fields", () => {
		const errors = validateManualRuleDraft(createEmptyManualRuleDraft());

		expect(errors.rule_id).toBeTruthy();
		expect(errors.statement).toBeTruthy();
		expect(errors.rationale).toBeTruthy();
	});

	it("requires enforceable condition fields", () => {
		const draft = createEmptyManualRuleDraft();
		draft.rule_id = "rule-manual-1";
		draft.statement = "Manual rule statement.";
		draft.rationale = "Finance approved exception.";
		draft.condition = { field: "", operator: "", value: "" };

		const errors = validateManualRuleDraft(draft);

		expect(errors.condition_field).toBeTruthy();
		expect(errors.condition_operator).toBeTruthy();
		expect(errors.condition_value).toBeTruthy();
	});
});

describe("buildManualRuleRequest", () => {
	it("builds a manual rule request from a valid draft", () => {
		const draft = createEmptyManualRuleDraft();
		draft.rule_id = "rule-manual-offsite";
		draft.statement = "Team offsites may reimburse dinner up to $120.";
		draft.rationale = "Finance approved offsite exception.";
		draft.condition = {
			field: "meal.amount",
			operator: "<=",
			value: "120",
		};
		draft.applicability = {
			aggregation_period: "per_transaction",
			unit: "money",
			currency: "USD",
			limit_basis: "per employee",
		};

		expect(buildManualRuleRequest(draft)).toEqual({
			rule_id: "rule-manual-offsite",
			statement: "Team offsites may reimburse dinner up to $120.",
			enforceability_class: "enforceable",
			rationale: "Finance approved offsite exception.",
			scope: {
				country: null,
				expense_category: null,
				travel_type: null,
				employee_group: null,
				effective_start_date: null,
				effective_end_date: null,
			},
			condition: {
				field: "meal.amount",
				operator: "<=",
				value: "120",
			},
			applicability: {
				aggregation_period: "per_transaction",
				unit: "money",
				currency: "USD",
				limit_basis: "per employee",
			},
			exceptions: [],
		});
	});
});
