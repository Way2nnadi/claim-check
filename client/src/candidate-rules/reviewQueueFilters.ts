import type { CandidateRuleFilters } from "./types";
import { useCallback, useMemo, useState } from "react";
import type { FormEvent } from "react";

export interface ReviewQueueScopeDraft {
	documentId: string;
	documentVersionId: string;
}

export const EMPTY_REVIEW_QUEUE_SCOPE: ReviewQueueScopeDraft = {
	documentId: "",
	documentVersionId: "",
};

export function buildReviewQueueFilters(
	scope: ReviewQueueScopeDraft,
	extractionRunId?: string | null,
): CandidateRuleFilters {
	const filters: CandidateRuleFilters = {};
	const trimmedDocumentId = scope.documentId.trim();
	const trimmedVersionId = scope.documentVersionId.trim();

	if (trimmedDocumentId) {
		filters.documentId = trimmedDocumentId;
	}
	if (trimmedVersionId) {
		filters.documentVersionId = trimmedVersionId;
	}
	if (extractionRunId) {
		filters.extractionRunId = extractionRunId;
	}

	return filters;
}

export function countReviewQueueScopeFilters(
	filters: CandidateRuleFilters,
): number {
	return (
		Number(Boolean(filters.documentId)) +
		Number(Boolean(filters.documentVersionId))
	);
}

export function countActiveScopeFilters(
	filters: CandidateRuleFilters,
	extractionRunId?: string | null,
): number {
	return countReviewQueueScopeFilters(filters) + Number(Boolean(extractionRunId));
}

export function isReviewQueueScopeActiveInDraft(
	draft: ReviewQueueScopeDraft,
): boolean {
	return (
		Boolean(draft.documentId.trim()) ||
		Boolean(draft.documentVersionId.trim())
	);
}

interface UseReviewQueueScopeFiltersOptions {
	extractionRunId?: string | null;
	onScopeChange?: () => void;
	onClearExtractionRunScope?: () => void;
}

export function useReviewQueueScopeFilters(
	options: UseReviewQueueScopeFiltersOptions = {},
) {
	const {
		extractionRunId = null,
		onScopeChange,
		onClearExtractionRunScope,
	} = options;
	const [scopeDraft, setScopeDraft] = useState<ReviewQueueScopeDraft>(
		EMPTY_REVIEW_QUEUE_SCOPE,
	);
	const [appliedScopeFilters, setAppliedScopeFilters] =
		useState<CandidateRuleFilters>({});

	const activeRuleFilters = useMemo(
		() =>
			buildReviewQueueFilters(
				{
					documentId: appliedScopeFilters.documentId ?? "",
					documentVersionId: appliedScopeFilters.documentVersionId ?? "",
				},
				extractionRunId,
			),
		[appliedScopeFilters, extractionRunId],
	);

	const applyScope = useCallback(
		(event: FormEvent<HTMLFormElement>): void => {
			event.preventDefault();
			onScopeChange?.();
			setAppliedScopeFilters(buildReviewQueueFilters(scopeDraft));
		},
		[onScopeChange, scopeDraft],
	);

	const clearScope = useCallback((): void => {
		setScopeDraft(EMPTY_REVIEW_QUEUE_SCOPE);
		onScopeChange?.();
		setAppliedScopeFilters({});
		onClearExtractionRunScope?.();
	}, [onClearExtractionRunScope, onScopeChange]);

	const activeFilterCount = countActiveScopeFilters(
		appliedScopeFilters,
		extractionRunId,
	);
	const hasActiveFilters =
		activeFilterCount > 0 || isReviewQueueScopeActiveInDraft(scopeDraft);

	return {
		scopeDraft,
		setScopeDraft,
		appliedScopeFilters,
		activeRuleFilters,
		scopeFilterCount: countReviewQueueScopeFilters(appliedScopeFilters),
		activeFilterCount,
		hasActiveFilters,
		scopeActiveInDraft: isReviewQueueScopeActiveInDraft(scopeDraft),
		applyScope,
		clearScope,
	};
}
