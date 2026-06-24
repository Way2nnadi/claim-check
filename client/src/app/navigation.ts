import {
	Blocks,
	ClipboardCheck,
	FileOutput,
	FileText,
	GitBranch,
	LayoutDashboard,
	ListChecks,
	PenLine,
	Receipt,
	ScrollText,
	ShieldCheck,
	TestTube2,
	type LucideIcon,
} from "lucide-react";
import { hasAnyRole } from "../shared/permissions";
import type { AuthenticatedPrincipal, Role } from "../shared/auth/types";

export type SectionId =
	| "dashboard"
	| "documents"
	| "rule-test-cases"
	| "expense-reports"
	| "evaluation-runs"
	| "compliance-review"
	| "extraction-runs"
	| "review"
	| "policy-versions"
	| "compliance"
	| "manual-rules"
	| "audit";

export type NavGroupId = "operate" | "author" | "governance";

export interface ShellSection {
	id: SectionId;
	label: string;
	kicker: string;
	icon: LucideIcon;
	ledger: readonly string[];
	visibleRoles: readonly Role[];
}

export interface NavGroup {
	id: NavGroupId;
	label: string;
	sectionIds: readonly SectionId[];
}

export interface GuidedTourStep {
	sectionId: SectionId;
	title: string;
	summary: string;
}

export const shellSections: readonly ShellSection[] = [
	{
		id: "dashboard",
		label: "Dashboard",
		kicker: "Front Desk",
		icon: LayoutDashboard,
		ledger: [],
		visibleRoles: ["admin", "approver", "viewer"],
	},
	{
		id: "rule-test-cases",
		label: "Rule Test Cases",
		kicker: "Regression Gate",
		icon: TestTube2,
		ledger: [
			"Generated fixtures and green Rule Test Runs gate Compliance Evaluation.",
		],
		visibleRoles: ["admin", "approver"],
	},
	{
		id: "expense-reports",
		label: "Expense Reports",
		kicker: "Expense Intake",
		icon: Receipt,
		ledger: [
			"Imported rows become the expense facts compliance checks run against.",
		],
		visibleRoles: ["admin", "approver", "viewer"],
	},
	{
		id: "evaluation-runs",
		label: "Evaluation Runs",
		kicker: "Compliance Batch",
		icon: ShieldCheck,
		ledger: [
			"Batch compliance checks against imported Expense Reports using pinned Compiled Rule Sets.",
		],
		visibleRoles: ["admin", "approver", "viewer"],
	},
	{
		id: "compliance-review",
		label: "Compliance Review",
		kicker: "Outcome Desk",
		icon: ListChecks,
		ledger: [
			"Human queue for needs_review, missing_evidence, and unresolved violations.",
		],
		visibleRoles: ["admin", "approver", "viewer"],
	},
	{
		id: "documents",
		label: "Documents",
		kicker: "Source Intake",
		icon: FileText,
		ledger: [
			"Preserve Citation fidelity before any Candidate Rule enters review.",
		],
		visibleRoles: ["admin", "approver", "viewer"],
	},
	{
		id: "extraction-runs",
		label: "Extraction Runs",
		kicker: "Machine Dossier",
		icon: FileOutput,
		ledger: [
			"Failed runs surface validation detail so editors can retry with corrected configuration.",
		],
		visibleRoles: ["admin", "approver"],
	},
	{
		id: "review",
		label: "Review Rules",
		kicker: "Approval Desk",
		icon: ClipboardCheck,
		ledger: ["Preserve an auditable rationale before publication."],
		visibleRoles: ["admin", "approver"],
	},
	{
		id: "policy-versions",
		label: "Policy Versions",
		kicker: "Version Ledger",
		icon: GitBranch,
		ledger: ["Change summaries explain why a Policy Version was published."],
		visibleRoles: ["admin", "approver", "viewer"],
	},
	{
		id: "compliance",
		label: "Compiled Rule Sets",
		kicker: "Rule Compiler",
		icon: Blocks,
		ledger: [
			"Compiled Rule Sets are immutable artifacts pinned to one Policy Version.",
		],
		visibleRoles: ["admin", "approver"],
	},
	{
		id: "manual-rules",
		label: "Manual Rules",
		kicker: "Manual Override",
		icon: PenLine,
		ledger: ["Rationale matters because Citation may be absent for this path."],
		visibleRoles: ["admin", "approver", "viewer"],
	},
	{
		id: "audit",
		label: "Audit",
		kicker: "Trace Archive",
		icon: ScrollText,
		ledger: ["Immutable record of what changed and who recorded it."],
		visibleRoles: ["admin", "approver", "viewer"],
	},
];

export const navGroups: readonly NavGroup[] = [
	{
		id: "operate",
		label: "Operate",
		sectionIds: [
			"rule-test-cases",
			"expense-reports",
			"evaluation-runs",
			"compliance-review",
		],
	},
	{
		id: "author",
		label: "Author Policy",
		sectionIds: [
			"documents",
			"extraction-runs",
			"review",
			"policy-versions",
			"compliance",
			"manual-rules",
		],
	},
	{
		id: "governance",
		label: "Governance",
		sectionIds: ["audit"],
	},
];

export const guidedTourSteps: readonly GuidedTourStep[] = [
	{
		sectionId: "documents",
		title: "Upload policy",
		summary:
			"Register company policy documents as immutable Document Versions.",
	},
	{
		sectionId: "extraction-runs",
		title: "Extract rules",
		summary:
			"Run machine extraction to produce Candidate Rules with Citations.",
	},
	{
		sectionId: "review",
		title: "Review rules",
		summary: "Approvers triage QA flags and approve rules for publication.",
	},
	{
		sectionId: "policy-versions",
		title: "Publish version",
		summary: "Snapshot approved rules into an immutable Policy Version.",
	},
	{
		sectionId: "compliance",
		title: "Compile rules",
		summary:
			"Generate a deterministic Compiled Rule Set from the Policy Version.",
	},
	{
		sectionId: "rule-test-cases",
		title: "Test rules",
		summary:
			"Generate fixtures and run a green Rule Test Run before batch evaluation.",
	},
	{
		sectionId: "expense-reports",
		title: "Import expenses",
		summary: "Load normalized expense rows that evaluation will check.",
	},
	{
		sectionId: "evaluation-runs",
		title: "Run evaluation",
		summary: "Batch-check expenses against the pinned Compiled Rule Set.",
	},
	{
		sectionId: "compliance-review",
		title: "Resolve outcomes",
		summary: "Humans decide on needs_review, missing_evidence, and violations.",
	},
];

const sectionById = new Map(
	shellSections.map((section) => [section.id, section]),
);

export function getShellSection(sectionId: SectionId): ShellSection {
	return sectionById.get(sectionId) ?? shellSections[0];
}

export function isSectionVisible(
	principal: AuthenticatedPrincipal,
	sectionId: SectionId,
): boolean {
	const section = sectionById.get(sectionId);
	if (!section) {
		return false;
	}
	return hasAnyRole(principal, section.visibleRoles);
}

export function getVisibleNavGroups(
	principal: AuthenticatedPrincipal,
): Array<NavGroup & { sections: ShellSection[] }> {
	return navGroups
		.map((group) => ({
			...group,
			sections: group.sectionIds
				.map((sectionId) => sectionById.get(sectionId))
				.filter(
					(section): section is ShellSection =>
						section !== undefined && isSectionVisible(principal, section.id),
				),
		}))
		.filter((group) => group.sections.length > 0);
}

export type DashboardSectionId = Exclude<SectionId, "dashboard" | "audit">;

export function getVisibleGuidedTourSteps(
	principal: AuthenticatedPrincipal,
): GuidedTourStep[] {
	return guidedTourSteps.filter((step) =>
		isSectionVisible(principal, step.sectionId),
	);
}
