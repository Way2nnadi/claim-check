import type { CandidateRuleReview, CandidateRuleReviewUpdateRequest } from "../candidate-rules/types";
import { formatEnforceabilityClass } from "./format";
import type { AggregationPeriod, Applicability, CandidateRuleValue, EnforceabilityClass, ManualRuleCreateRequest, RuleCondition, RuleException, Scope } from "./types";

export interface ScopeDraft {
	country: string;
	expense_category: string;
	travel_type: string;
	employee_group: string;
	effective_start_date: string;
	effective_end_date: string;
}

export interface ConditionDraft {
	field: string;
	operator: string;
	value: string;
}

export interface ApplicabilityDraft {
	aggregation_period: AggregationPeriod | "";
	unit: string;
	currency: string;
	limit_basis: string;
}

export interface ExceptionDraft {
	clientKey: string;
	description: string;
	required_evidence: string;
}

export function createExceptionDraft(): ExceptionDraft {
	return {
		clientKey: crypto.randomUUID(),
		description: "",
		required_evidence: "",
	};
}

export interface RuleDraft {
	statement: string;
	enforceability_class: EnforceabilityClass;
	scope: ScopeDraft;
	condition: ConditionDraft;
	applicability: ApplicabilityDraft;
	exceptions: ExceptionDraft[];
}

export interface CitationDraft {
	document_id: string;
	document_version_id: string;
	section_id: string;
	quote: string;
	start_char: string;
	end_char: string;
}

export interface ManualRuleDraft extends RuleDraft {
	rule_id: string;
	rationale: string;
	citation: CitationDraft;
}

export type ValidationErrors = Record<string, string>;

export const ENFORCEABILITY_OPTIONS: readonly EnforceabilityClass[] = [
	"enforceable",
	"guidance",
	"subjective",
];

export const AGGREGATION_PERIOD_OPTIONS: readonly AggregationPeriod[] = [
	"per_transaction",
	"per_day",
	"per_trip",
	"per_night",
	"per_attendee",
];

export const OPERATOR_OPTIONS = ["<=", "<", "==", ">=", ">"] as const;

export const SCOPE_FIELDS: readonly {
	key: keyof ScopeDraft;
	label: string;
	placeholder: string;
}[] = [
	{ key: "country", label: "Country", placeholder: "Country" },
	{
		key: "expense_category",
		label: "Expense category",
		placeholder: "Expense category",
	},
	{ key: "travel_type", label: "Travel type", placeholder: "Travel type" },
	{
		key: "employee_group",
		label: "Employee group",
		placeholder: "Employee group",
	},
	{
		key: "effective_start_date",
		label: "Effective start",
		placeholder: "YYYY-MM-DD",
	},
	{
		key: "effective_end_date",
		label: "Effective end",
		placeholder: "YYYY-MM-DD",
	},
];

export function formatAggregationPeriod(
	value: AggregationPeriod | "" | null,
): string {
	if (!value) {
		return "Not set";
	}
	return value.replaceAll("_", " ");
}

export const ENFORCEABILITY_PICKER_OPTIONS = ENFORCEABILITY_OPTIONS.map(
	(value) => ({
		value,
		label: formatEnforceabilityClass(value),
	}),
);

export const AGGREGATION_PERIOD_PICKER_OPTIONS = [
	{ value: "", label: "Not set" },
	...AGGREGATION_PERIOD_OPTIONS.map((value) => ({
		value,
		label: formatAggregationPeriod(value),
	})),
];

export const OPERATOR_PICKER_OPTIONS = OPERATOR_OPTIONS.map((value) => ({
	value,
	label: value,
}));

export function normalizeOptionalString(value: string): string | null {
	const normalized = value.trim();
	return normalized === "" ? null : normalized;
}

export function hasExtractedBaseline(value: string | null | undefined): boolean {
	return value != null && value.trim().length > 0;
}

export function normalizeCurrencyInput(value: string): string {
	return value
		.replace(/[^A-Za-z]/g, "")
		.toUpperCase()
		.slice(0, 3);
}

export function normalizeCurrencyForSave(value: string): string | null {
	const normalized = normalizeCurrencyInput(value);
	return normalized.length === 0 ? null : normalized;
}

export function normalizeRequiredString(value: string): string {
	return value.trim();
}

export function displayValue(value: string | null | undefined): string {
	return value && value.trim().length > 0 ? value : "Not set";
}

export function createRuleDraft(rule: CandidateRuleValue): RuleDraft {
	return {
		statement: rule.statement,
		enforceability_class: rule.enforceability_class,
		scope: {
			country: rule.scope.country ?? "",
			expense_category: rule.scope.expense_category ?? "",
			travel_type: rule.scope.travel_type ?? "",
			employee_group: rule.scope.employee_group ?? "",
			effective_start_date: rule.scope.effective_start_date ?? "",
			effective_end_date: rule.scope.effective_end_date ?? "",
		},
		condition: {
			field: rule.condition?.field ?? "",
			operator: rule.condition?.operator ?? "",
			value: rule.condition?.value ?? "",
		},
		applicability: {
			aggregation_period: rule.applicability?.aggregation_period ?? "",
			unit: rule.applicability?.unit ?? "",
			currency: normalizeCurrencyInput(rule.applicability?.currency ?? ""),
			limit_basis: rule.applicability?.limit_basis ?? "",
		},
		exceptions:
			rule.exceptions.length > 0
				? rule.exceptions.map((exception) => ({
						clientKey: crypto.randomUUID(),
						description: exception.description,
						required_evidence: exception.required_evidence.join("\n"),
					}))
				: [createExceptionDraft()],
	};
}

export function createEmptyManualRuleDraft(): ManualRuleDraft {
	return {
		rule_id: "",
		statement: "",
		enforceability_class: "enforceable",
		rationale: "",
		scope: {
			country: "",
			expense_category: "",
			travel_type: "",
			employee_group: "",
			effective_start_date: "",
			effective_end_date: "",
		},
		condition: {
			field: "",
			operator: "<=",
			value: "",
		},
		applicability: {
			aggregation_period: "",
			unit: "",
			currency: "",
			limit_basis: "",
		},
		exceptions: [createExceptionDraft()],
		citation: {
			document_id: "",
			document_version_id: "",
			section_id: "",
			quote: "",
			start_char: "",
			end_char: "",
		},
	};
}

export function buildScopeFromDraft(scope: ScopeDraft): Scope {
	return {
		country: normalizeOptionalString(scope.country),
		expense_category: normalizeOptionalString(scope.expense_category),
		travel_type: normalizeOptionalString(scope.travel_type),
		employee_group: normalizeOptionalString(scope.employee_group),
		effective_start_date: normalizeOptionalString(scope.effective_start_date),
		effective_end_date: normalizeOptionalString(scope.effective_end_date),
	};
}

export function buildConditionFromDraft(
	condition: ConditionDraft,
): RuleCondition | null {
	const field = normalizeRequiredString(condition.field);
	const operator = normalizeRequiredString(condition.operator);
	const value = normalizeRequiredString(condition.value);

	if (!field && !operator && !value) {
		return null;
	}

	return {
		field,
		operator,
		value,
	};
}

export function buildRequiredConditionFromDraft(
	condition: ConditionDraft,
): RuleCondition {
	return {
		field: normalizeRequiredString(condition.field),
		operator: normalizeRequiredString(condition.operator),
		value: normalizeRequiredString(condition.value),
	};
}

export function buildApplicabilityFromDraft(
	applicability: ApplicabilityDraft,
): Applicability | null {
	const unit = normalizeRequiredString(applicability.unit);
	const currency = normalizeCurrencyForSave(applicability.currency);
	const limit_basis = normalizeOptionalString(applicability.limit_basis);

	if (
		!applicability.aggregation_period &&
		!unit &&
		!currency &&
		!limit_basis
	) {
		return null;
	}

	return {
		aggregation_period: applicability.aggregation_period as AggregationPeriod,
		unit,
		currency,
		limit_basis,
	} as Applicability;
}

export function buildManualApplicabilityFromDraft(
	applicability: ApplicabilityDraft,
): Applicability | undefined {
	const unit = normalizeRequiredString(applicability.unit);
	const currency = normalizeCurrencyInput(applicability.currency);
	const limit_basis = normalizeOptionalString(applicability.limit_basis);

	if (
		!applicability.aggregation_period &&
		!unit &&
		!currency &&
		!limit_basis
	) {
		return undefined;
	}

	if (!applicability.aggregation_period || !unit) {
		return undefined;
	}

	return {
		aggregation_period: applicability.aggregation_period,
		unit,
		currency: currency || null,
		limit_basis,
	};
}

export function buildExceptionsFromDraft(
	exceptions: ExceptionDraft[],
): RuleException[] {
	return exceptions
		.map((exception) => ({
			description: normalizeRequiredString(exception.description),
			required_evidence: exception.required_evidence
				.split("\n")
				.map((item) => item.trim())
				.filter(Boolean),
		}))
		.filter(
			(exception) =>
				exception.description.length > 0 ||
				exception.required_evidence.length > 0,
		) as RuleException[];
}

export function buildManualExceptionsFromDraft(
	exceptions: ExceptionDraft[],
): RuleException[] {
	return exceptions
		.map((exception) => ({
			description: normalizeRequiredString(exception.description),
			required_evidence: exception.required_evidence
				.split(/[\n,]/u)
				.map((item) => item.trim())
				.filter(Boolean),
		}))
		.filter((exception) => exception.description.length > 0);
}

function normalizeExceptionPayload(exceptions: RuleException[]): RuleException[] {
	return exceptions.map((exception) => ({
		description: normalizeRequiredString(exception.description),
		required_evidence: exception.required_evidence
			.map((item) => item.trim())
			.filter(Boolean),
	}));
}

export function areEqual<T>(left: T, right: T): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function buildCandidateRuleUpdatePayload(
	draft: RuleDraft,
	currentRule: CandidateRuleValue,
): CandidateRuleReviewUpdateRequest {
	const payload: CandidateRuleReviewUpdateRequest = {};
	const statement = draft.statement.trim();
	const scope = buildScopeFromDraft(draft.scope);
	const condition = buildConditionFromDraft(draft.condition);
	const applicability = buildApplicabilityFromDraft(draft.applicability);
	const exceptions = buildExceptionsFromDraft(draft.exceptions);

	if (statement !== currentRule.statement) {
		payload.statement = statement;
	}

	if (draft.enforceability_class !== currentRule.enforceability_class) {
		payload.enforceability_class = draft.enforceability_class;
	}

	if (!areEqual(scope, currentRule.scope)) {
		payload.scope = scope;
	}

	if (!areEqual(condition, currentRule.condition)) {
		payload.condition = condition;
	}

	if (!areEqual(applicability, currentRule.applicability)) {
		payload.applicability = applicability;
	}

	if (
		!areEqual(
			normalizeExceptionPayload(exceptions),
			normalizeExceptionPayload(currentRule.exceptions),
		)
	) {
		payload.exceptions = exceptions;
	}

	return payload;
}

export function countRuleDraftDifferences(
	review: CandidateRuleReview,
	draft: RuleDraft,
): number {
	let count = 0;

	if (draft.statement.trim() !== review.extracted_rule.statement) {
		count += 1;
	}
	if (
		draft.enforceability_class !== review.extracted_rule.enforceability_class
	) {
		count += 1;
	}

	for (const field of SCOPE_FIELDS) {
		if (
			normalizeOptionalString(draft.scope[field.key]) !==
			review.extracted_rule.scope[field.key]
		) {
			count += 1;
		}
	}

	if (
		!areEqual(
			buildConditionFromDraft(draft.condition),
			review.extracted_rule.condition,
		)
	) {
		count += 1;
	}

	if (
		!areEqual(
			buildApplicabilityFromDraft(draft.applicability),
			review.extracted_rule.applicability,
		)
	) {
		count += 1;
	}

	if (
		!areEqual(
			normalizeExceptionPayload(buildExceptionsFromDraft(draft.exceptions)),
			normalizeExceptionPayload(review.extracted_rule.exceptions),
		)
	) {
		count += 1;
	}

	return count;
}

export function draftAsRuleValue(
	draft: RuleDraft,
	currentRule: CandidateRuleValue,
): CandidateRuleValue {
	return {
		...currentRule,
		statement: draft.statement,
		enforceability_class: draft.enforceability_class,
		condition: buildConditionFromDraft(draft.condition),
	};
}

export function decisionBlockersFor(unsavedChangeCount: number): string[] {
	if (unsavedChangeCount === 0) {
		return [];
	}

	return ["Save your edits first."];
}

export function applyEnforceabilityChange<T extends RuleDraft>(
	draft: T,
	nextValue: EnforceabilityClass,
): T {
	return {
		...draft,
		enforceability_class: nextValue,
		condition:
			nextValue === "enforceable"
				? draft.condition
				: { field: "", operator: "<=", value: "" },
		applicability:
			nextValue === "enforceable"
				? draft.applicability
				: {
						aggregation_period: "",
						unit: "",
						currency: "",
						limit_basis: "",
					},
	};
}

export function validateManualRuleDraft(
	draft: ManualRuleDraft,
): ValidationErrors {
	const errors: ValidationErrors = {};

	if (!normalizeRequiredString(draft.rule_id)) {
		errors.rule_id = "Rule ID is required.";
	}
	if (!normalizeRequiredString(draft.statement)) {
		errors.statement = "Statement is required.";
	}
	if (!normalizeRequiredString(draft.rationale)) {
		errors.rationale = "Rationale is required.";
	}

	if (draft.enforceability_class === "enforceable") {
		if (!normalizeRequiredString(draft.condition.field)) {
			errors.condition_field =
				"Condition field is required for enforceable Rules.";
		}
		if (!normalizeRequiredString(draft.condition.operator)) {
			errors.condition_operator =
				"Operator is required for enforceable Rules.";
		}
		if (!normalizeRequiredString(draft.condition.value)) {
			errors.condition_value =
				"Threshold value is required for enforceable Rules.";
		}
	}

	const applicabilityTouched =
		Boolean(draft.applicability.aggregation_period) ||
		Boolean(normalizeRequiredString(draft.applicability.unit)) ||
		Boolean(normalizeCurrencyInput(draft.applicability.currency)) ||
		Boolean(normalizeRequiredString(draft.applicability.limit_basis));

	if (
		applicabilityTouched &&
		!normalizeRequiredString(draft.applicability.unit)
	) {
		errors.applicability_unit =
			"Unit is required when Applicability is provided.";
	}
	if (
		applicabilityTouched &&
		!draft.applicability.aggregation_period
	) {
		errors.applicability_aggregation_period =
			"Aggregation period is required when Applicability is provided.";
	}

	const citationTouched = Object.values(draft.citation).some((value) =>
		normalizeRequiredString(value).length > 0,
	);

	if (citationTouched) {
		if (!normalizeRequiredString(draft.citation.document_id)) {
			errors.citation_document_id = "Citation document ID is required.";
		}
		if (!normalizeRequiredString(draft.citation.document_version_id)) {
			errors.citation_document_version_id =
				"Citation Document Version is required.";
		}
		if (!normalizeRequiredString(draft.citation.section_id)) {
			errors.citation_section_id = "Citation section ID is required.";
		}
		if (!normalizeRequiredString(draft.citation.quote)) {
			errors.citation_quote = "Citation quote is required.";
		}

		const startChar = Number(draft.citation.start_char);
		const endChar = Number(draft.citation.end_char);

		if (!normalizeRequiredString(draft.citation.start_char)) {
			errors.citation_start_char = "Citation start character is required.";
		} else if (!Number.isInteger(startChar) || startChar < 0) {
			errors.citation_start_char =
				"Citation start character must be zero or greater.";
		}

		if (!normalizeRequiredString(draft.citation.end_char)) {
			errors.citation_end_char = "Citation end character is required.";
		} else if (!Number.isInteger(endChar) || endChar < 0) {
			errors.citation_end_char =
				"Citation end character must be zero or greater.";
		} else if (Number.isInteger(startChar) && endChar <= startChar) {
			errors.citation_end_char =
				"Citation end character must be greater than the start character.";
		}
	}

	draft.exceptions.forEach((exception, index) => {
		if (
			normalizeRequiredString(exception.required_evidence).length > 0 &&
			!normalizeRequiredString(exception.description)
		) {
			errors[`exception_${index}`] =
				"Exception description is required when required evidence is listed.";
		}
	});

	return errors;
}

export function buildManualRuleRequest(
	draft: ManualRuleDraft,
): ManualRuleCreateRequest {
	const request: ManualRuleCreateRequest = {
		rule_id: normalizeRequiredString(draft.rule_id),
		statement: normalizeRequiredString(draft.statement),
		enforceability_class: draft.enforceability_class,
		rationale: normalizeRequiredString(draft.rationale),
		scope: buildScopeFromDraft(draft.scope),
		exceptions: buildManualExceptionsFromDraft(draft.exceptions),
	};

	if (draft.enforceability_class === "enforceable") {
		request.condition = buildRequiredConditionFromDraft(draft.condition);
		const applicability = buildManualApplicabilityFromDraft(
			draft.applicability,
		);
		if (applicability) {
			request.applicability = applicability;
		}
	}

	const citationTouched = Object.values(draft.citation).some((value) =>
		normalizeRequiredString(value).length > 0,
	);
	if (citationTouched) {
		request.citation = {
			document_id: normalizeRequiredString(draft.citation.document_id),
			document_version_id: normalizeRequiredString(
				draft.citation.document_version_id,
			),
			section_id: normalizeRequiredString(draft.citation.section_id),
			quote: normalizeRequiredString(draft.citation.quote),
			start_char: Number(draft.citation.start_char),
			end_char: Number(draft.citation.end_char),
		};
	}

	return request;
}

export function updateScopeField(
	draft: RuleDraft,
	key: keyof ScopeDraft,
	value: string,
): RuleDraft {
	return {
		...draft,
		scope: {
			...draft.scope,
			[key]: value,
		},
	};
}

export function updateExceptionField(
	draft: RuleDraft,
	index: number,
	key: "description" | "required_evidence",
	value: string,
): RuleDraft {
	return {
		...draft,
		exceptions: draft.exceptions.map((exception, exceptionIndex) =>
			exceptionIndex === index ? { ...exception, [key]: value } : exception,
		),
	};
}

export function addExceptionToDraft(draft: RuleDraft): RuleDraft {
	return {
		...draft,
		exceptions: [...draft.exceptions, createExceptionDraft()],
	};
}

export function removeExceptionFromDraft(
	draft: RuleDraft,
	index: number,
): RuleDraft {
	return {
		...draft,
		exceptions:
			draft.exceptions.length === 1
				? [createExceptionDraft()]
				: draft.exceptions.filter((_, exceptionIndex) => exceptionIndex !== index),
	};
}
