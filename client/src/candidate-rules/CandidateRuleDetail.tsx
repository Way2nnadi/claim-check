import { fetchCandidateRule, updateCandidateRule } from "./api";
import type { CandidateRuleReview, CandidateRuleReviewUpdateRequest } from "./types";
import { fetchDocumentSections } from "../policy-documents/api";
import type { DocumentSection } from "../policy-documents/types";
import { formatEnforceabilityClass, formatLifecycleState } from "../rules/format";
import type { AggregationPeriod, EnforceabilityClass, CandidateRuleValue, Citation, QAFlag } from "../rules/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode, RefObject } from "react";
import { ApiError } from "../shared/api/client";
import { approvalBlockersForRule, canEditCandidateRules, canResolveCandidateRule, resolveCandidateRuleDecision, resolveDecisionErrorMessage, validateDecisionComment } from "./decisions";
import { describeCandidateRuleError, formatQAFlagCode, formatQAFlagDomain, qaFlagDomain } from "./format";
import { formatDocumentTitle } from "../policy-documents/format";
import { RuleFormFields, type RuleFormFieldWrapperProps } from "../rules/RuleFormFields";
import { applyEnforceabilityChange, buildCandidateRuleUpdatePayload, countRuleDraftDifferences, createRuleDraft, decisionBlockersFor, displayValue, draftAsRuleValue, ENFORCEABILITY_PICKER_OPTIONS, type RuleDraft } from "../rules/ruleDraft";
import type { AuthenticatedPrincipal } from "../shared/auth/types";

import CandidateRuleDecisionModal from "./CandidateRuleDecisionModal";

import SectionBrowserDrawer from "./SectionBrowserDrawer";
import SearchablePicker from "../shared/ui/SearchablePicker";
import Breadcrumbs from "../shared/ui/Breadcrumbs";
import CommentThread, { type CommentEntry } from "../shared/ui/CommentThread";
import RecordPageHeader, {
	type RecordPropertyGroup,
} from "../shared/ui/RecordPageHeader";
import StatusPill, {
	enforceabilityToPillVariant,
	lifecycleToPillVariant,
} from "../shared/ui/StatusPill";
import { RecordPageIcon, RulePageIcon } from "../shared/ui/PageIcons";

export interface CandidateRuleDetailProps {
	candidateRuleId: string;
	principal: AuthenticatedPrincipal;
	onBack?: () => void;
	backLabel?: string;
	onReviewChange?: (review: CandidateRuleReview) => void;
	onReviewResolved?: (
		candidateRuleId: string,
		outcome: "approved" | "rejected",
	) => void;
}

type DetailStatus = "loading" | "ready" | "not_found" | "error";
type DecisionMode = "approve" | "reject";

interface ReviewFieldProps {
	label: string;
	extractedValue: ReactNode;
	changed: boolean;
	showWasLine?: boolean;
	inputId: string;
	children: ReactNode;
	description?: string;
	className?: string;
}

function normalizeStatement(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

function statementsMatch(left: string, right: string): boolean {
	const normalizedLeft = normalizeStatement(left);
	const normalizedRight = normalizeStatement(right);
	return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

function sectionLocation(section: DocumentSection): string {
	const path =
		section.heading_path.length > 0 ? section.heading_path : ["Preamble"];
	return path.join(" › ");
}

function shortenId(value: string, visible = 6): string {
	if (value.length <= visible * 2 + 1) {
		return value;
	}
	return `${value.slice(0, visible)}…${value.slice(-visible)}`;
}

function cleanSourceFragment(text: string): string {
	return text
		.replace(/^\s*[•·▪◦\-*–—]\s*$/gm, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function truncateContext(text: string, maxLength = 320): string {
	const cleaned = cleanSourceFragment(text);
	if (cleaned.length <= maxLength) {
		return cleaned;
	}
	return `…${cleaned.slice(-maxLength).trimStart()}`;
}

interface CitationSplit {
	before: string;
	highlight: string;
	after: string;
}

function splitSectionCitation(
	section: DocumentSection,
	citation: Citation,
): CitationSplit | null {
	const overlapStart = Math.max(citation.start_char, section.start_char);
	const overlapEnd = Math.min(citation.end_char, section.end_char);
	if (overlapEnd <= overlapStart) {
		return null;
	}

	const localStart = overlapStart - section.start_char;
	const localEnd = overlapEnd - section.start_char;

	return {
		before: cleanSourceFragment(section.content.slice(0, localStart)),
		highlight:
			cleanSourceFragment(section.content.slice(localStart, localEnd)) ||
			citation.quote,
		after: cleanSourceFragment(section.content.slice(localEnd)),
	};
}

function ReviewField({
	label,
	extractedValue,
	changed,
	showWasLine,
	inputId,
	children,
	description,
	className,
}: ReviewFieldProps) {
	const displayWasLine = showWasLine ?? changed;

	return (
		<div
			className={`review-field${changed ? " changed" : ""}${className ? ` ${className}` : ""}`}
		>
			<label htmlFor={inputId}>{label}</label>
			{children}
			{displayWasLine ? (
				<p className="review-field-was">
					<span className="review-field-was-label">Previously</span> {extractedValue}
				</p>
			) : null}
			{description ? (
				<p className="review-field-description">{description}</p>
			) : null}
		</div>
	);
}

function ReviewFieldWrapper({
	label,
	extractedValue,
	changed,
	showWasLine,
	inputId,
	children,
	description,
	className,
}: RuleFormFieldWrapperProps) {
	return (
		<ReviewField
			label={label}
			extractedValue={extractedValue ?? "Not set"}
			changed={changed ?? false}
			showWasLine={showWasLine}
			inputId={inputId}
			description={description}
			className={className}
		>
			{children}
		</ReviewField>
	);
}

interface SourceCitationViewProps {
	section: DocumentSection;
	citation: Citation;
	showFullSection: boolean;
	suppressHighlight?: boolean;
}

function SourceCitationView({
	section,
	citation,
	showFullSection,
	suppressHighlight = false,
}: SourceCitationViewProps) {
	const split = splitSectionCitation(section, citation);

	if (!showFullSection || !split) {
		if (suppressHighlight) {
			return null;
		}
		return <div className="review-source-passage">{citation.quote}</div>;
	}

	const hasContext = Boolean(split.before || split.after);

	if (suppressHighlight && !hasContext) {
		return null;
	}

	return (
		<div className="review-source-context">
			{split.before ? (
				<p className="review-source-context-muted">
					{truncateContext(split.before)}
				</p>
			) : null}
			{!suppressHighlight ? (
				<div className="review-source-passage">{split.highlight}</div>
			) : null}
			{split.after ? (
				<p className="review-source-context-muted">
					{truncateContext(split.after)}
				</p>
			) : null}
		</div>
	);
}

function QaFlagsBanner({ flags }: { flags: QAFlag[] }) {
	if (flags.length === 0) {
		return null;
	}

	return (
		<aside className="review-qa-banner reveal" aria-label="QA flags">
			<ul className="review-qa-domain-list">
				{flags.map((flag) => {
					const domain = qaFlagDomain(flag.code);
					return (
						<li
							key={`${flag.code}-${flag.detail}`}
							className={`review-qa-domain-card ${domain}`}
						>
							<div className="review-qa-domain-head">
								<span className="review-qa-domain-label">
									{formatQAFlagDomain(domain)}
								</span>
								<span className="review-qa-code">
									{formatQAFlagCode(flag.code)}
								</span>
							</div>
							<p>{flag.detail}</p>
						</li>
					);
				})}
			</ul>
		</aside>
	);
}

interface CitationStripProps {
	citation: Citation;
	currentStatement: string;
	sections: DocumentSection[];
	sectionsStatus: "idle" | "loading" | "ready" | "error";
	sectionsError: string | null;
	selectedSection: DocumentSection | null;
	viewingCitedSection: boolean;
	showFullSection: boolean;
	sectionsOpen: boolean;
	sectionFilter: string;
	sourceBodyRef: RefObject<HTMLElement | null>;
	onToggleContext: () => void;
	onBrowseSections: () => void;
	onSectionFilterChange: (value: string) => void;
	onSectionSelect: (sectionId: string) => void;
	onCloseSections: () => void;
}

function CitationStrip({
	citation,
	currentStatement,
	sections,
	sectionsStatus,
	sectionsError,
	selectedSection,
	viewingCitedSection,
	showFullSection,
	sectionsOpen,
	sectionFilter,
	sourceBodyRef,
	onToggleContext,
	onBrowseSections,
	onSectionFilterChange,
	onSectionSelect,
	onCloseSections,
}: CitationStripProps) {
	const canBrowse = sections.length > 0;
	const quoteMatchesStatement = statementsMatch(
		citation.quote,
		currentStatement,
	);
	const locationLabel = selectedSection
		? sectionLocation(selectedSection)
		: formatDocumentTitle(citation.document_id);

	let stripBody: ReactNode = null;

	if (sectionsStatus === "loading") {
		stripBody = (
			<>
				{!quoteMatchesStatement ? (
					<div className="review-source-passage">{citation.quote}</div>
				) : null}
				<p className="review-citation-status">
					<span className="catalog-status-rule" aria-hidden="true" />
					Loading source…
				</p>
			</>
		);
	} else if (sectionsStatus === "error") {
		stripBody = (
			<>
				{!quoteMatchesStatement ? (
					<div className="review-source-passage">{citation.quote}</div>
				) : null}
				<p className="review-citation-status error">{sectionsError}</p>
			</>
		);
	} else if (selectedSection && viewingCitedSection) {
		stripBody = (
			<SourceCitationView
				section={selectedSection}
				citation={citation}
				showFullSection={showFullSection}
				suppressHighlight={quoteMatchesStatement}
			/>
		);
	} else if (selectedSection) {
		stripBody = (
			<div className="review-source-text">
				{cleanSourceFragment(selectedSection.content)}
			</div>
		);
	} else if (!quoteMatchesStatement) {
		stripBody = <div className="review-source-passage">{citation.quote}</div>;
	}

	return (
		<section
			className="review-citation-strip review-source-group reveal"
			aria-label="Source citation"
		>
			<header className="review-citation-strip-head">
				<div className="review-citation-strip-intro">
					<span className="review-citation-kicker">Source</span>
					<p className="review-citation-location">{locationLabel}</p>
				</div>
				<div className="review-citation-strip-actions">
					{viewingCitedSection ? (
						<button
							type="button"
							className="review-source-context-toggle"
							onClick={onToggleContext}
						>
							{showFullSection ? "Passage only" : "More context"}
						</button>
					) : null}
					{canBrowse ? (
						<button
							type="button"
							className="review-source-browse-toggle"
							onClick={onBrowseSections}
						>
							Browse sections ({sections.length})
						</button>
					) : null}
				</div>
			</header>

			{stripBody ? (
				<div
					ref={sourceBodyRef as RefObject<HTMLDivElement>}
					className="review-citation-strip-body"
				>
					{stripBody}
				</div>
			) : null}

			{canBrowse ? (
				<SectionBrowserDrawer
					open={sectionsOpen}
					documentId={citation.document_id}
					sections={sections}
					filter={sectionFilter}
					selectedSectionId={selectedSection?.section_id ?? citation.section_id}
					citedSectionId={citation.section_id}
					onFilterChange={onSectionFilterChange}
					onSelect={onSectionSelect}
					onClose={onCloseSections}
				/>
			) : null}
		</section>
	);
}

export default function CandidateRuleDetail({
	candidateRuleId,
	principal,
	onBack,
	backLabel = "Clear selection",
	onReviewChange,
	onReviewResolved,
}: CandidateRuleDetailProps) {
	const [status, setStatus] = useState<DetailStatus>("loading");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [saveMessage, setSaveMessage] = useState<string | null>(null);
	const [review, setReview] = useState<CandidateRuleReview | null>(null);
	const [draft, setDraft] = useState<RuleDraft | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [isResolving, setIsResolving] = useState(false);
	const [decisionMode, setDecisionMode] = useState<DecisionMode | null>(null);
	const [decisionComment, setDecisionComment] = useState("");
	const [decisionError, setDecisionError] = useState<string | null>(null);
	const [sections, setSections] = useState<DocumentSection[]>([]);
	const [sectionsStatus, setSectionsStatus] = useState<
		"idle" | "loading" | "ready" | "error"
	>("idle");
	const [sectionsError, setSectionsError] = useState<string | null>(null);
	const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
		null,
	);
	const [sectionsOpen, setSectionsOpen] = useState(false);
	const [sectionFilter, setSectionFilter] = useState("");
	const [showFullSection, setShowFullSection] = useState(false);
	const sourceBodyRef = useRef<HTMLElement | null>(null);

	const canEdit = canEditCandidateRules(principal);

	const loadReview = useCallback(async (): Promise<void> => {
		setStatus("loading");
		setErrorMessage(null);
		setSaveMessage(null);
		setSections([]);
		setSectionsStatus("idle");
		setSectionsError(null);
		setSelectedSectionId(null);
		setSectionsOpen(false);
		setSectionFilter("");
		setShowFullSection(false);
		setIsResolving(false);
		setDecisionMode(null);
		setDecisionComment("");
		setDecisionError(null);

		try {
			const response = await fetchCandidateRule(candidateRuleId);
			setReview(response);
			setDraft(createRuleDraft(response.current_rule));
			setStatus("ready");

			const citation = response.current_rule.citation;
			if (!citation) {
				return;
			}

			setSelectedSectionId(citation.section_id);
			setSectionsStatus("loading");

			try {
				const sectionsResponse = await fetchDocumentSections(
					citation.document_id,
					citation.document_version_id,
				);
				setSections(
					Array.isArray(sectionsResponse.items) ? sectionsResponse.items : [],
				);
				setSectionsStatus("ready");
			} catch (error: unknown) {
				setSectionsStatus("error");
				setSectionsError(
					describeCandidateRuleError(
						error,
						"Unable to load document sections for this citation.",
					),
				);
			}
		} catch (error: unknown) {
			if (error instanceof ApiError && error.status === 404) {
				setReview(null);
				setDraft(null);
				setStatus("not_found");
				return;
			}
			setErrorMessage(
				describeCandidateRuleError(
					error,
					"Unable to load Candidate Rule details.",
				),
			);
			setReview(null);
			setDraft(null);
			setStatus("error");
		}
	}, [candidateRuleId]);

	useEffect(() => {
		void loadReview();
	}, [loadReview]);

	const updatePayload = useMemo<CandidateRuleReviewUpdateRequest>(() => {
		if (!review || !draft) {
			return {};
		}
		return buildCandidateRuleUpdatePayload(draft, review.current_rule);
	}, [draft, review]);

	const unsavedChangeCount = Object.keys(updatePayload).length;
	const differenceCount = review && draft ? countRuleDraftDifferences(review, draft) : 0;

	const citation = review?.current_rule.citation ?? null;
	const selectedSection =
		sections.find((section) => section.section_id === selectedSectionId) ??
		null;
	const viewingCitedSection = Boolean(
		citation &&
			selectedSection &&
			selectedSection.section_id === citation.section_id,
	);
	const approvalBlockers =
		review && draft
			? approvalBlockersForRule(
					review,
					draftAsRuleValue(draft, review.current_rule),
				)
			: [];
	const decisionBlockers = decisionBlockersFor(unsavedChangeCount);

	function clearFeedback(): void {
		if (errorMessage !== null) {
			setErrorMessage(null);
		}
		if (saveMessage !== null) {
			setSaveMessage(null);
		}
	}

	function updateDraftState(nextDraft: RuleDraft): void {
		clearFeedback();
		setDraft(nextDraft);
	}

	function openDecisionModal(mode: DecisionMode): void {
		clearFeedback();
		setDecisionMode(mode);
		setDecisionComment("");
		setDecisionError(null);
	}

	function closeDecisionModal(): void {
		setDecisionMode(null);
		setDecisionComment("");
		setDecisionError(null);
	}

	function handleSectionSelect(sectionId: string): void {
		setSelectedSectionId(sectionId);
		setShowFullSection(false);
		sourceBodyRef.current?.scrollTo({ top: 0 });
	}

	async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		if (
			!review ||
			!draft ||
			!canEdit ||
			isResolving ||
			unsavedChangeCount === 0
		) {
			return;
		}

		setIsSaving(true);
		setErrorMessage(null);
		setSaveMessage(null);

		try {
			const updatedReview = await updateCandidateRule(
				candidateRuleId,
				updatePayload,
			);
			setReview(updatedReview);
			setDraft(createRuleDraft(updatedReview.current_rule));
			setSaveMessage("Candidate Rule moved to in review.");
			onReviewChange?.(updatedReview);
		} catch (error: unknown) {
			setErrorMessage(
				describeCandidateRuleError(
					error,
					"Unable to save Candidate Rule edits.",
				),
			);
		} finally {
			setIsSaving(false);
		}
	}

	async function handleResolveReview(): Promise<void> {
		if (!review || decisionMode === null || !canEdit || isSaving) {
			return;
		}

		const validationError = validateDecisionComment(
			decisionMode,
			decisionComment,
		);
		if (validationError) {
			setDecisionError(validationError);
			return;
		}

		setIsResolving(true);
		setDecisionError(null);
		setErrorMessage(null);
		setSaveMessage(null);

		try {
			const updatedReview = await resolveCandidateRuleDecision(
				candidateRuleId,
				decisionMode,
				decisionComment,
			);
			setReview(updatedReview);
			setDraft(createRuleDraft(updatedReview.current_rule));
			onReviewChange?.(updatedReview);
			setSaveMessage(decisionMode === "approve" ? "Approved." : "Rejected.");
			const outcome = decisionMode === "approve" ? "approved" : "rejected";
			closeDecisionModal();
			onReviewResolved?.(candidateRuleId, outcome);
		} catch (error: unknown) {
			setErrorMessage(
				describeCandidateRuleError(
					error,
					resolveDecisionErrorMessage(decisionMode),
				),
			);
		} finally {
			setIsResolving(false);
		}
	}

	if (status === "loading") {
		return (
			<div className="review-detail content-enter">
				<p className="catalog-status compact">
					<span className="catalog-status-rule" aria-hidden="true" />
					Opening Candidate Rule…
				</p>
			</div>
		);
	}

	if (status === "not_found") {
		return (
			<div className="review-detail content-enter">
				{onBack ? (
					<button type="button" className="detail-back" onClick={onBack}>
						{backLabel}
					</button>
				) : null}
				<div className="review-not-found reveal">
					<span className="folio">Signal lost</span>
					<h4>Candidate Rule not found</h4>
					<p>
						No Candidate Rule exists for <code>{candidateRuleId}</code>.
					</p>
				</div>
			</div>
		);
	}

	if (status === "error" || review === null || draft === null) {
		return (
			<div className="review-detail content-enter">
				{onBack ? (
					<button type="button" className="detail-back" onClick={onBack}>
						{backLabel}
					</button>
				) : null}
				<p className="error-banner">{errorMessage}</p>
			</div>
		);
	}

	const rule = review.current_rule;
	const canResolve = canResolveCandidateRule(review, canEdit);
	const saveDisabled =
		!canEdit || isSaving || isResolving || unsavedChangeCount === 0;
	const approveDisabled =
		!canResolve ||
		isSaving ||
		isResolving ||
		decisionBlockers.length > 0 ||
		approvalBlockers.length > 0;
	const rejectDisabled =
		!canResolve || isSaving || isResolving || decisionBlockers.length > 0;
	const hasCommittedEdits = review.committed_rule !== null;

	const pageTitle = citation
		? formatDocumentTitle(citation.document_id)
		: (rule.scope.expense_category ?? review.candidate_rule_id);
	const showEnforceabilityHint =
		draft.enforceability_class !== "enforceable" ||
		draft.enforceability_class !== review.extracted_rule.enforceability_class;

	const headerPropertyGroups: RecordPropertyGroup[] = [
		{
			title: "Review",
			properties: [
				{
					label: "Status",
					value: (
						<StatusPill
							label={formatLifecycleState(review.lifecycle_state)}
							variant={lifecycleToPillVariant(review.lifecycle_state)}
						/>
					),
				},
				{
					label: "Enforceability",
					value: (
						<StatusPill
							label={formatEnforceabilityClass(draft.enforceability_class)}
							variant={enforceabilityToPillVariant(draft.enforceability_class)}
						/>
					),
				},
				{
					label: "QA flags",
					value:
						review.qa_flags.length > 0 ? (
							<StatusPill
								label={`${review.qa_flags.length} flag${review.qa_flags.length === 1 ? "" : "s"}`}
								variant="danger"
							/>
						) : (
							<StatusPill label="Clear" variant="success" />
						),
				},
			],
		},
		{
			title: "Provenance",
			properties: [
				{
					label: "Rule ID",
					value: <code className="db-mono">{review.candidate_rule_id}</code>,
				},
				{
					label: "Document",
					value: citation ? (
						<code className="db-mono">{citation.document_id}</code>
					) : null,
					empty: !citation,
				},
				{
					label: "Extraction run",
					value: rule.origin.extraction_run_id ? (
						<code className="db-mono">{rule.origin.extraction_run_id}</code>
					) : null,
					empty: !rule.origin.extraction_run_id,
				},
			],
		},
	];

	const headerActions = canEdit ? (
		<>
			<button
				type="button"
				className="document-command"
				disabled={approveDisabled}
				onClick={() => openDecisionModal("approve")}
			>
				Approve
			</button>
			<button
				type="button"
				className="document-command document-command-danger"
				disabled={rejectDisabled}
				onClick={() => openDecisionModal("reject")}
			>
				Reject
			</button>
			<button
				type="submit"
				form="candidate-rule-edit-form"
				className="document-command document-command-accent"
				disabled={saveDisabled}
			>
				{isSaving ? "Saving…" : "Save Candidate Rule"}
			</button>
		</>
	) : undefined;

	const activityEntries: CommentEntry[] = [];
	const rationale =
		review.committed_rule?.origin.rationale ?? rule.origin.rationale;
	if (rationale) {
		activityEntries.push({
			id: "origin-rationale",
			author: rule.origin.source_type === "manual" ? "Manual entry" : "Extraction",
			body: rationale,
		});
	}

	return (
		<div className="review-detail content-enter">
			<RecordPageHeader
				breadcrumbs={
					onBack ? (
						<Breadcrumbs
							items={[
								{
									label: backLabel,
									icon: <RulePageIcon size={14} />,
									onClick: onBack,
								},
								{
									label: shortenId(review.candidate_rule_id, 10),
									icon: <RulePageIcon size={14} />,
								},
							]}
						/>
					) : undefined
				}
				icon={<RecordPageIcon icon={<RulePageIcon size={22} />} />}
				title={pageTitle}
				subtitle={normalizeStatement(draft.statement)}
				recordId={review.candidate_rule_id}
				propertyGroups={headerPropertyGroups}
				propertyLayout="stacked"
				actions={headerActions}
				meta={
					!canEdit ? (
						<p className="review-edit-ledger">Read-only access</p>
					) : differenceCount > 0 || unsavedChangeCount > 0 ? (
						<p className="review-edit-ledger">
							{differenceCount} divergent · {unsavedChangeCount} unsaved
							{decisionBlockers.length > 0 ? " · save before deciding" : ""}
						</p>
					) : undefined
				}
			/>

			{activityEntries.length > 0 ? (
				<CommentThread
					entries={activityEntries}
					title="Rationale"
					emptyMessage="No rationale recorded."
				/>
			) : null}

			<div className="review-detail-body">
				{errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
				{saveMessage ? (
					<p className="review-save-banner">{saveMessage}</p>
				) : null}

				<div className="review-detail-workspace">
					<QaFlagsBanner flags={review.qa_flags} />

					<form
						id="candidate-rule-edit-form"
						className="review-edit-form"
						onSubmit={handleSave}
					>
						<section className="review-detail-panel review-property-section reveal">
							<h4 className="record-section-heading">Rule fields</h4>
							<ReviewField
								label="Statement"
								className="review-field--statement"
								extractedValue={review.extracted_rule.statement}
								changed={
									draft.statement.trim() !== review.extracted_rule.statement
								}
								inputId="candidate-rule-statement"
							>
								<textarea
									id="candidate-rule-statement"
									value={draft.statement}
									disabled={!canEdit || isSaving}
									rows={4}
									onChange={(event) =>
										updateDraftState({
											...draft,
											statement: event.target.value,
										})
									}
								/>
							</ReviewField>

							<ReviewField
								label="Enforceability"
								extractedValue={formatEnforceabilityClass(
									review.extracted_rule.enforceability_class,
								)}
								changed={
									draft.enforceability_class !==
									review.extracted_rule.enforceability_class
								}
								inputId="candidate-rule-enforceability"
								description={
									showEnforceabilityHint
										? "If you switch away from enforceable, clear the machine-checkable condition before saving."
										: undefined
								}
							>
								<SearchablePicker
									label="Enforceability class"
									inputId="candidate-rule-enforceability"
									hideLabel
									value={draft.enforceability_class}
									options={ENFORCEABILITY_PICKER_OPTIONS}
									placeholder="Select enforceability class"
									emptyMessage="No matching classes"
									disabled={!canEdit || isSaving}
									showAllOnOpen
									onChange={(nextValue) =>
										updateDraftState(
											applyEnforceabilityChange(draft, nextValue),
										)
									}
								/>
							</ReviewField>
						</section>

						{citation ? (
							<CitationStrip
								citation={citation}
								currentStatement={draft.statement}
								sections={sections}
								sectionsStatus={sectionsStatus}
								sectionsError={sectionsError}
								selectedSection={selectedSection}
								viewingCitedSection={viewingCitedSection}
								showFullSection={showFullSection}
								sectionsOpen={sectionsOpen}
								sectionFilter={sectionFilter}
								sourceBodyRef={sourceBodyRef}
								onToggleContext={() =>
									setShowFullSection((current) => !current)
								}
								onBrowseSections={() => setSectionsOpen(true)}
								onSectionFilterChange={setSectionFilter}
								onSectionSelect={handleSectionSelect}
								onCloseSections={() => setSectionsOpen(false)}
							/>
						) : (
							<div className="review-source-group reveal">
								<p className="review-citation-empty">
									No source linked for this rule.
								</p>
							</div>
						)}

						<RuleFormFields
							draft={draft}
							idPrefix="candidate-rule"
							disabled={!canEdit || isSaving}
							isEnforceable={draft.enforceability_class === "enforceable"}
							onDraftChange={updateDraftState}
							onEnforceabilityChange={(nextValue) =>
								updateDraftState(applyEnforceabilityChange(draft, nextValue))
							}
							FieldWrapper={ReviewFieldWrapper}
							extractedRule={review.extracted_rule}
							showEnforceabilitySection={false}
							panelDelayMs={40}
						/>

						{approvalBlockers.length > 0 ? (
							<div
								className="notion-callout error reveal"
								aria-label="Approval blockers"
								style={{ "--reveal-delay": "140ms" } as CSSProperties}
							>
								<p className="review-blocker-lede">
									Resolve these issues before approving this Candidate Rule.
								</p>
								<ul className="review-blocker-list">
									{approvalBlockers.map((blocker) => (
										<li key={blocker}>{blocker}</li>
									))}
								</ul>
							</div>
						) : null}

						{decisionBlockers.length > 0 ? (
							<div
								className="notion-callout reveal"
								aria-label="Decision blockers"
								style={{ "--reveal-delay": "150ms" } as CSSProperties}
							>
								<p className="review-blocker-lede">Save edits before deciding.</p>
								<ul className="review-blocker-list">
									{decisionBlockers.map((blocker) => (
										<li key={blocker}>{blocker}</li>
									))}
								</ul>
							</div>
						) : null}

						<details
							className="review-detail-meta notion-collapsible reveal"
							style={{ "--reveal-delay": "180ms" } as CSSProperties}
						>
							<summary>Audit & provenance</summary>
							<div className="review-detail-meta-body">
								<dl className="review-detail-grid compact">
									<div>
										<dt>Extraction run</dt>
										<dd>{rule.origin.extraction_run_id ?? "—"}</dd>
									</div>
									<div>
										<dt>Principal</dt>
										<dd>{principal.subject}</dd>
									</div>
									{citation ? (
										<>
											<div>
												<dt>Document</dt>
												<dd>{citation.document_id}</dd>
											</div>
											<div>
												<dt>Version</dt>
												<dd>{shortenId(citation.document_version_id)}</dd>
											</div>
											<div className="review-detail-span">
												<dt>Citation span</dt>
												<dd>
													{citation.section_id} · chars {citation.start_char}–
													{citation.end_char}
												</dd>
											</div>
										</>
									) : null}
								</dl>
								<p className="review-detail-note">
									{hasCommittedEdits
										? "Committed edits remain separate from the extracted Candidate Rule for auditability."
										: "No committed edits yet. Saving will preserve the extracted Rule and create a reviewed value set."}
								</p>
								{hasCommittedEdits ? (
									<dl className="review-detail-grid compact">
										<div className="review-detail-span">
											<dt>Extracted statement</dt>
											<dd>{review.extracted_rule.statement}</dd>
										</div>
										<div className="review-detail-span">
											<dt>Current statement</dt>
											<dd>{rule.statement}</dd>
										</div>
									</dl>
								) : null}
							</div>
						</details>
					</form>
				</div>
			</div>

			{decisionMode ? (
				<CandidateRuleDecisionModal
					mode={decisionMode}
					isResolving={isResolving}
					comment={decisionComment}
					error={decisionError}
					onCommentChange={(value) => {
						setDecisionComment(value);
						if (decisionError !== null) {
							setDecisionError(null);
						}
					}}
					onConfirm={() => void handleResolveReview()}
					onCancel={closeDecisionModal}
				/>
			) : null}
		</div>
	);
}
