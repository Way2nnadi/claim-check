import { formatEnforceabilityClass } from "./format";
import type { AggregationPeriod, Applicability, CandidateRuleValue, EnforceabilityClass, RuleCondition } from "./types";
import type { CSSProperties, ComponentType, ReactNode } from "react";
import { AGGREGATION_PERIOD_PICKER_OPTIONS, ENFORCEABILITY_PICKER_OPTIONS, OPERATOR_PICKER_OPTIONS, SCOPE_FIELDS, displayValue, formatAggregationPeriod, hasExtractedBaseline, normalizeCurrencyForSave, normalizeCurrencyInput, normalizeOptionalString, type RuleDraft, type ValidationErrors } from "./ruleDraft";
import SearchablePicker from "../shared/ui/SearchablePicker";

export interface RuleFormFieldWrapperProps {
	label: string;
	inputId: string;
	children: ReactNode;
	error?: string;
	description?: string;
	extractedValue?: ReactNode;
	changed?: boolean;
	showWasLine?: boolean;
	className?: string;
}

export interface RuleFormFieldsProps {
	draft: RuleDraft;
	idPrefix: string;
	disabled: boolean;
	isEnforceable: boolean;
	onDraftChange: (draft: RuleDraft) => void;
	onEnforceabilityChange: (value: EnforceabilityClass) => void;
	FieldWrapper: ComponentType<RuleFormFieldWrapperProps>;
	validationErrors?: ValidationErrors;
	extractedRule?: CandidateRuleValue;
	useOperatorPicker?: boolean;
	showEnforceabilitySection?: boolean;
	enforceabilityDescription?: string;
	panelDelayMs?: number;
}

export function RuleFormFields({
	draft,
	idPrefix,
	disabled,
	isEnforceable,
	onDraftChange,
	onEnforceabilityChange,
	FieldWrapper,
	validationErrors = {},
	extractedRule,
	useOperatorPicker = false,
	showEnforceabilitySection = true,
	enforceabilityDescription,
	panelDelayMs = 0,
}: RuleFormFieldsProps) {
	const extractedCondition = extractedRule?.condition;
	const extractedApplicability = extractedRule?.applicability;
	const isReviewMode = extractedRule !== undefined;

	function updateDraft(nextDraft: RuleDraft): void {
		onDraftChange(nextDraft);
	}

	function updateScopeField(key: keyof RuleDraft["scope"], value: string): void {
		updateDraft({
			...draft,
			scope: {
				...draft.scope,
				[key]: value,
			},
		});
	}

	function updateException(
		index: number,
		key: "description" | "required_evidence",
		value: string,
	): void {
		updateDraft({
			...draft,
			exceptions: draft.exceptions.map((exception, exceptionIndex) =>
				exceptionIndex === index ? { ...exception, [key]: value } : exception,
			),
		});
	}

	function addException(): void {
		updateDraft({
			...draft,
			exceptions: [
				...draft.exceptions,
				{ description: "", required_evidence: "" },
			],
		});
	}

	function removeException(index: number): void {
		updateDraft({
			...draft,
			exceptions:
				draft.exceptions.length === 1
					? [{ description: "", required_evidence: "" }]
					: draft.exceptions.filter((_, exceptionIndex) => exceptionIndex !== index),
		});
	}

	function reviewScopeProps(fieldKey: keyof RuleDraft["scope"]) {
		if (!isReviewMode || !extractedRule) {
			return {};
		}

		const extractedValue = extractedRule.scope[fieldKey];
		const changed =
			normalizeOptionalString(draft.scope[fieldKey]) !== extractedValue;

		return {
			extractedValue: displayValue(extractedValue),
			changed,
			showWasLine: changed && hasExtractedBaseline(extractedValue),
		};
	}

	function reviewConditionProps(
		key: keyof RuleCondition,
		currentValue: string,
	): Partial<RuleFormFieldWrapperProps> {
		if (!isReviewMode) {
			return {};
		}

		const extractedValue = extractedCondition?.[key];
		const changed = currentValue.trim() !== (extractedValue ?? "");

		return {
			extractedValue: displayValue(extractedValue),
			changed,
			showWasLine: changed && hasExtractedBaseline(extractedValue),
		};
	}

	function reviewApplicabilityProps(
		key: keyof Applicability | "aggregation_period",
		currentValue: string | AggregationPeriod | "",
		formatter?: (value: string | AggregationPeriod | "" | null | undefined) => string,
	): Partial<RuleFormFieldWrapperProps> {
		if (!isReviewMode || !extractedApplicability) {
			return {};
		}

		let extractedValue: string | null | undefined;
		let changed = false;

		if (key === "aggregation_period") {
			extractedValue = extractedApplicability.aggregation_period ?? "";
			changed = currentValue !== (extractedApplicability.aggregation_period ?? "");
		} else if (key === "currency") {
			extractedValue = extractedApplicability.currency;
			changed =
				normalizeCurrencyForSave(String(currentValue)) !==
				extractedApplicability.currency;
		} else {
			extractedValue = extractedApplicability[key];
			changed = String(currentValue).trim() !== (extractedValue ?? "");
		}

		const display =
			formatter?.(currentValue) ??
			(key === "aggregation_period"
				? formatAggregationPeriod(
						extractedApplicability.aggregation_period ?? null,
					)
				: displayValue(extractedValue));

		return {
			extractedValue: display,
			changed,
			showWasLine: changed && hasExtractedBaseline(extractedValue),
		};
	}

	return (
		<>
			{showEnforceabilitySection ? (
				<section className="review-detail-panel reveal">
					<FieldWrapper
						label="Enforceability"
						inputId={`${idPrefix}-enforceability`}
						description={enforceabilityDescription}
						extractedValue={
							isReviewMode && extractedRule
								? formatEnforceabilityClass(
										extractedRule.enforceability_class,
									)
								: undefined
						}
						changed={
							isReviewMode && extractedRule
								? draft.enforceability_class !==
									extractedRule.enforceability_class
								: undefined
						}
					>
						<SearchablePicker
							label="Enforceability class"
							inputId={`${idPrefix}-enforceability`}
							hideLabel
							value={draft.enforceability_class}
							options={ENFORCEABILITY_PICKER_OPTIONS}
							placeholder="Select enforceability class"
							emptyMessage="No matching classes"
							disabled={disabled}
							mono
							showAllOnOpen
							onChange={(nextValue) =>
								onEnforceabilityChange(nextValue as EnforceabilityClass)
							}
						/>
					</FieldWrapper>
				</section>
			) : null}

			<section
				className="review-detail-panel reveal"
				style={
					panelDelayMs > 0
						? ({ "--reveal-delay": `${panelDelayMs}ms` } as CSSProperties)
						: undefined
				}
			>
				<h4>Scope</h4>
				<div className="review-field-grid cols-2">
					{SCOPE_FIELDS.map((field) => (
						<FieldWrapper
							key={field.key}
							label={field.label}
							inputId={`${idPrefix}-${field.key}`}
							{...reviewScopeProps(field.key)}
						>
							<input
								id={`${idPrefix}-${field.key}`}
								name={field.key}
								value={draft.scope[field.key]}
								onChange={(event) =>
									updateScopeField(field.key, event.target.value)
								}
								placeholder={field.placeholder}
								disabled={disabled}
								spellCheck={false}
							/>
						</FieldWrapper>
					))}
				</div>
			</section>

			<section
				className={`review-detail-panel reveal${isEnforceable ? "" : " is-muted"}`}
				style={
					panelDelayMs > 0
						? ({ "--reveal-delay": `${panelDelayMs + 40}ms` } as CSSProperties)
						: undefined
				}
				aria-disabled={!isEnforceable}
			>
				<h4>Machine-checkable shape</h4>
				{!isEnforceable ? (
					<p className="review-field-description">
						Guidance and subjective rules route to humans instead of machine
						checks.
					</p>
				) : null}
				<div className="review-field-grid cols-3 review-condition-row">
					<FieldWrapper
						label="Field"
						inputId={`${idPrefix}-condition-field`}
						error={validationErrors.condition_field}
						{...reviewConditionProps("field", draft.condition.field)}
					>
						<input
							id={`${idPrefix}-condition-field`}
							name="condition_field"
							value={draft.condition.field}
							onChange={(event) =>
								updateDraft({
									...draft,
									condition: {
										...draft.condition,
										field: event.target.value,
									},
								})
							}
							placeholder="meal.amount"
							disabled={disabled || !isEnforceable}
							spellCheck={false}
						/>
					</FieldWrapper>

					<FieldWrapper
						label="Operator"
						inputId={`${idPrefix}-condition-operator`}
						error={validationErrors.condition_operator}
						{...reviewConditionProps("operator", draft.condition.operator)}
					>
						{useOperatorPicker ? (
							<SearchablePicker
								label="Operator"
								inputId={`${idPrefix}-condition-operator`}
								hideLabel
								value={draft.condition.operator}
								options={OPERATOR_PICKER_OPTIONS}
								placeholder="Select operator"
								emptyMessage="No matching operators"
								disabled={disabled || !isEnforceable}
								mono
								showAllOnOpen
								onChange={(nextValue) =>
									updateDraft({
										...draft,
										condition: {
											...draft.condition,
											operator: nextValue,
										},
									})
								}
							/>
						) : (
							<input
								id={`${idPrefix}-condition-operator`}
								value={draft.condition.operator}
								disabled={disabled || !isEnforceable}
								spellCheck={false}
								placeholder="<="
								onChange={(event) =>
									updateDraft({
										...draft,
										condition: {
											...draft.condition,
											operator: event.target.value,
										},
									})
								}
							/>
						)}
					</FieldWrapper>

					<FieldWrapper
						label="Value"
						inputId={`${idPrefix}-condition-value`}
						error={validationErrors.condition_value}
						{...reviewConditionProps("value", draft.condition.value)}
					>
						<input
							id={`${idPrefix}-condition-value`}
							name="condition_value"
							value={draft.condition.value}
							onChange={(event) =>
								updateDraft({
									...draft,
									condition: {
										...draft.condition,
										value: event.target.value,
									},
								})
							}
							placeholder={useOperatorPicker ? "120" : "75"}
							disabled={disabled || !isEnforceable}
							spellCheck={false}
						/>
					</FieldWrapper>
				</div>

				<div className="review-field-grid cols-2 review-applicability-grid">
					<FieldWrapper
						label="Aggregation period"
						inputId={`${idPrefix}-aggregation-period`}
						error={validationErrors.applicability_aggregation_period}
						{...reviewApplicabilityProps(
							"aggregation_period",
							draft.applicability.aggregation_period,
							(value) => formatAggregationPeriod(value as AggregationPeriod | ""),
						)}
					>
						<SearchablePicker
							label="Aggregation period"
							inputId={`${idPrefix}-aggregation-period`}
							hideLabel
							value={draft.applicability.aggregation_period}
							options={AGGREGATION_PERIOD_PICKER_OPTIONS}
							placeholder="Select aggregation period"
							emptyMessage="No matching periods"
							disabled={disabled || !isEnforceable}
							mono
							showAllOnOpen
							onChange={(nextValue) =>
								updateDraft({
									...draft,
									applicability: {
										...draft.applicability,
										aggregation_period: nextValue as AggregationPeriod | "",
									},
								})
							}
						/>
					</FieldWrapper>

					<FieldWrapper
						label="Unit"
						inputId={`${idPrefix}-applicability-unit`}
						error={validationErrors.applicability_unit}
						{...reviewApplicabilityProps("unit", draft.applicability.unit)}
					>
						<input
							id={`${idPrefix}-applicability-unit`}
							name="applicability_unit"
							value={draft.applicability.unit}
							onChange={(event) =>
								updateDraft({
									...draft,
									applicability: {
										...draft.applicability,
										unit: event.target.value,
									},
								})
							}
							placeholder="money"
							disabled={disabled || !isEnforceable}
							spellCheck={false}
						/>
					</FieldWrapper>

					<FieldWrapper
						label="Currency"
						inputId={`${idPrefix}-applicability-currency`}
						description="3-letter ISO code (e.g. USD)."
						{...reviewApplicabilityProps(
							"currency",
							draft.applicability.currency,
						)}
					>
						<input
							id={`${idPrefix}-applicability-currency`}
							name="applicability_currency"
							value={draft.applicability.currency}
							onChange={(event) =>
								updateDraft({
									...draft,
									applicability: {
										...draft.applicability,
										currency: normalizeCurrencyInput(event.target.value),
									},
								})
							}
							placeholder="USD"
							maxLength={3}
							disabled={disabled || !isEnforceable}
							spellCheck={false}
						/>
					</FieldWrapper>

					<FieldWrapper
						label="Limit basis"
						inputId={`${idPrefix}-applicability-limit-basis`}
						{...reviewApplicabilityProps(
							"limit_basis",
							draft.applicability.limit_basis,
						)}
					>
						<input
							id={`${idPrefix}-applicability-limit-basis`}
							name="applicability_limit_basis"
							value={draft.applicability.limit_basis}
							onChange={(event) =>
								updateDraft({
									...draft,
									applicability: {
										...draft.applicability,
										limit_basis: event.target.value,
									},
								})
							}
							placeholder="per employee"
							disabled={disabled || !isEnforceable}
							spellCheck={false}
						/>
					</FieldWrapper>
				</div>
			</section>

			<details className="review-detail-meta reveal">
				<summary>Exceptions</summary>
				<div className="review-detail-meta-body">
					<div className="review-detail-section-head">
						<p className="review-detail-note">
							Evidence that modifies the rule outcome.
						</p>
						<button
							type="button"
							className="review-secondary-button compact"
							onClick={addException}
							disabled={disabled}
						>
							Add exception
						</button>
					</div>

					<div className="review-exceptions">
						{draft.exceptions.map((exception, index) => (
							<article key={index} className="review-exception-card">
								<div className="review-exception-head">
									<span className="review-exception-title">
										Exception {index + 1}
									</span>
									<button
										type="button"
										className="review-secondary-button compact"
										onClick={() => removeException(index)}
										disabled={disabled}
									>
										Remove
									</button>
								</div>

								<FieldWrapper
									label={
										index === 0 ? "Exception" : `Exception ${index + 1}`
									}
									inputId={`${idPrefix}-exception-${index}`}
									error={validationErrors[`exception_${index}`]}
								>
									<textarea
										id={`${idPrefix}-exception-${index}`}
										value={exception.description}
										onChange={(event) =>
											updateException(index, "description", event.target.value)
										}
										rows={2}
										placeholder="Director approval is required."
										disabled={disabled}
									/>
								</FieldWrapper>

								<FieldWrapper
									label={
										index === 0
											? "Required evidence"
											: `Required evidence ${index + 1}`
									}
									inputId={`${idPrefix}-exception-evidence-${index}`}
								>
									<textarea
										id={`${idPrefix}-exception-evidence-${index}`}
										value={exception.required_evidence}
										onChange={(event) =>
											updateException(
												index,
												"required_evidence",
												event.target.value,
											)
										}
										rows={2}
										placeholder="director_approval"
										disabled={disabled}
									/>
								</FieldWrapper>
							</article>
						))}
					</div>
				</div>
			</details>
		</>
	);
}
