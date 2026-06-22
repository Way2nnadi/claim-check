import { hasAnyRole } from "./permissions";
import type {
	AuthenticatedPrincipal,
	CandidateRuleReview,
	CandidateRuleValue,
	Role,
} from "./types";

export const CANDIDATE_RULE_EDITOR_ROLES: readonly Role[] = ["admin", "approver"];

export const CANDIDATE_RULE_QUEUE_LIFECYCLE_STATES = new Set([
	"extracted",
	"in_review",
]);

const APPROVAL_BLOCKING_QA_CODES = new Set(["unresolvable_citation"]);

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
