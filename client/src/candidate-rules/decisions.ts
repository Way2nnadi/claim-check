import { approveCandidateRule, fetchCandidateRule, rejectCandidateRule } from "./api";
import type { CandidateRuleReview } from "./types";
import type { CandidateRuleValue } from "../rules/types";
import { hasAnyRole } from "../shared/permissions";
import type { AuthenticatedPrincipal, Role } from "../shared/auth/types";

export const CANDIDATE_RULE_EDITOR_ROLES: readonly Role[] = ["admin", "approver"];

export const CANDIDATE_RULE_QUEUE_LIFECYCLE_STATES = new Set([
	"extracted",
	"in_review",
]);

const APPROVAL_BLOCKING_QA_CODES = new Set(["unresolvable_citation"]);

export type CandidateRuleDecisionMode = "approve" | "reject";

function normalizeStatement(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

function hasMachineCheckableCondition(rule: CandidateRuleValue): boolean {
	return rule.condition !== null;
}

export function canEditCandidateRules(
	principal: AuthenticatedPrincipal,
): boolean {
	return hasAnyRole(principal, CANDIDATE_RULE_EDITOR_ROLES);
}

export function canResolveCandidateRule(
	review: CandidateRuleReview,
	canEdit: boolean,
): boolean {
	return canEdit && CANDIDATE_RULE_QUEUE_LIFECYCLE_STATES.has(review.lifecycle_state);
}

export function approvalBlockersForRule(
	review: CandidateRuleReview,
	rule: CandidateRuleValue,
): string[] {
	const blockers = new Set<string>();
	const normalizedStatement = normalizeStatement(rule.statement);
	const hasCondition = hasMachineCheckableCondition(rule);

	if (normalizedStatement.length === 0) {
		blockers.add("Add a Rule statement before approval.");
	}

	if (rule.enforceability_class === "enforceable" && !hasCondition) {
		blockers.add("Complete the machine-checkable condition before approval.");
	}

	if (rule.enforceability_class !== "enforceable" && hasCondition) {
		blockers.add("Remove the machine-checkable condition before approval.");
	}

	if (rule.citation === null) {
		blockers.add("Resolve the Citation issue before approving this Candidate Rule.");
	}

	for (const flag of review.qa_flags) {
		if (APPROVAL_BLOCKING_QA_CODES.has(flag.code)) {
			blockers.add("Resolve the Citation issue before approving this Candidate Rule.");
		}
	}

	return [...blockers];
}

export function catalogApproveDisabled(
	review: CandidateRuleReview,
	canEdit: boolean,
): boolean {
	return (
		!canResolveCandidateRule(review, canEdit) ||
		approvalBlockersForRule(review, review.current_rule).length > 0
	);
}

export function catalogRejectDisabled(
	review: CandidateRuleReview,
	canEdit: boolean,
): boolean {
	return !canResolveCandidateRule(review, canEdit);
}

export function isLowRiskBulkApprovalCandidate(
	review: CandidateRuleReview,
	canBulkApprove: boolean,
): boolean {
	const diffCategory = review.reingestion_diff_category;

	return (
		canBulkApprove &&
		!catalogApproveDisabled(review, canBulkApprove) &&
		review.qa_flags.length === 0 &&
		diffCategory !== "changed" &&
		diffCategory !== "removed"
	);
}

export function bulkSelectableCandidateRuleIds(
	reviews: CandidateRuleReview[],
	canBulkApprove: boolean,
): Set<string> {
	return new Set(
		reviews
			.filter((review) =>
				isLowRiskBulkApprovalCandidate(review, canBulkApprove),
			)
			.map((review) => review.candidate_rule_id),
	);
}

export function selectedBulkCandidateRuleIds(
	selectedCandidateRuleIds: ReadonlySet<string>,
	selectableCandidateRuleIds: ReadonlySet<string>,
): string[] {
	return [...selectedCandidateRuleIds].filter((candidateRuleId) =>
		selectableCandidateRuleIds.has(candidateRuleId),
	);
}

export function bulkApproveDisabled(
	canBulkApprove: boolean,
	selectedCount: number,
	isBulkApproving: boolean,
): boolean {
	return !canBulkApprove || selectedCount === 0 || isBulkApproving;
}

export function pruneSelectedCandidateRuleIds(
	current: ReadonlySet<string>,
	selectableCandidateRuleIds: ReadonlySet<string>,
): Set<string> {
	return new Set(
		[...current].filter((candidateRuleId) =>
			selectableCandidateRuleIds.has(candidateRuleId),
		),
	);
}

export function toggleCandidateRuleSelection(
	current: ReadonlySet<string>,
	candidateRuleId: string,
	selectableCandidateRuleIds: ReadonlySet<string>,
): Set<string> {
	const next = new Set(current);
	if (next.has(candidateRuleId)) {
		next.delete(candidateRuleId);
	} else if (selectableCandidateRuleIds.has(candidateRuleId)) {
		next.add(candidateRuleId);
	}
	return next;
}

export function toggleAllCandidateRuleSelections(
	current: ReadonlySet<string>,
	selectableCandidateRuleIds: ReadonlySet<string>,
): Set<string> {
	const allSelected =
		selectableCandidateRuleIds.size > 0 &&
		[...selectableCandidateRuleIds].every((candidateRuleId) =>
			current.has(candidateRuleId),
		);
	if (allSelected) {
		return new Set();
	}
	return new Set(selectableCandidateRuleIds);
}

export function decisionCommentRequiredError(
	mode: CandidateRuleDecisionMode,
): string {
	return mode === "approve" ? "Rationale is required." : "Reason is required.";
}

export function validateDecisionComment(
	mode: CandidateRuleDecisionMode,
	comment: string,
): string | null {
	if (!comment.trim()) {
		return decisionCommentRequiredError(mode);
	}
	return null;
}

export function resolveDecisionErrorMessage(
	mode: CandidateRuleDecisionMode,
): string {
	return mode === "approve"
		? "Unable to approve Candidate Rule."
		: "Unable to reject Candidate Rule.";
}

export async function resolveCandidateRuleDecision(
	candidateRuleId: string,
	mode: CandidateRuleDecisionMode,
	comment: string,
): Promise<CandidateRuleReview> {
	const trimmedComment = comment.trim();

	if (mode === "approve") {
		await approveCandidateRule(candidateRuleId, {
			rationale: trimmedComment,
		});
	} else {
		await rejectCandidateRule(candidateRuleId, {
			reason: trimmedComment,
		});
	}

	return fetchCandidateRule(candidateRuleId);
}
