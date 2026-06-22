import { useEffect, useState, type FormEvent } from "react";
import {
	Blocks,
	ClipboardCheck,
	FileOutput,
	FileText,
	GitBranch,
	LayoutDashboard,
	PenLine,
	Receipt,
	ScrollText,
	ShieldCheck,
	type LucideIcon,
} from "lucide-react";
import {
	ApiError,
	clearStoredToken,
	getStoredToken,
	setStoredToken,
} from "../shared/api/client";
import { fetchMe } from "../shared/auth/api";
import { DocumentCatalog } from "../policy-documents";
import { CandidateRuleCatalog } from "../candidate-rules";
import { ExtractionRunCatalog } from "../extraction-runs";
import { ManualRulesPage } from "../manual-rules";
import { PolicyVersionCatalog } from "../policy-versions";
import { CompiledRuleSetCatalog } from "../compiled-rule-sets";
import { ComplianceEvaluationRunCatalog } from "../compliance-evaluation-runs";
import { AuditLogPage } from "../audit";
import { DashboardPage } from "../dashboard";
import ThemeToggle from "../shared/ui/ThemeToggle";
import { hasAnyRole } from "../shared/permissions";
import type { AuthenticatedPrincipal, Role } from "../shared/auth/types";
import ExpenseReportsPage from "../ExpenseReportsPage";

type AuthStatus = "booting" | "signed_out" | "authenticating" | "authenticated";
type SectionId =
	| "dashboard"
	| "documents"
	| "expense-reports"
	| "evaluation-runs"
	| "extraction-runs"
	| "review"
	| "policy-versions"
	| "compliance"
	| "manual-rules"
	| "audit";

interface PersonaOption {
	label: string;
	role: Role;
	token: string;
	blurb: string;
}

interface SectionAction {
	label: string;
	allowedRoles: readonly Role[];
	unavailableBehavior: "hide" | "disable";
}

interface ShellSection {
	id: SectionId;
	label: string;
	kicker: string;
	icon: LucideIcon;
	actions: readonly SectionAction[];
	ledger: readonly string[];
}

function NavIcon({ icon: Icon }: { icon: LucideIcon }) {
	return (
		<span className="nav-link-icon" aria-hidden="true">
			<Icon size={18} strokeWidth={1.75} />
		</span>
	);
}

const shellSections: readonly ShellSection[] = [
	{
		id: "dashboard",
		label: "Dashboard",
		kicker: "Front Desk",
		icon: LayoutDashboard,
		actions: [],
		ledger: [],
	},
	{
		id: "documents",
		label: "Documents",
		kicker: "Source Intake",
		icon: FileText,
		actions: [],
		ledger: [
			"Preserve Citation fidelity before any Candidate Rule enters review.",
		],
	},
	{
		id: "expense-reports",
		label: "Expense Reports",
		kicker: "Expense Intake",
		icon: Receipt,
		actions: [],
		ledger: [
			"Imported rows become the expense facts compliance checks run against.",
		],
	},
	{
		id: "evaluation-runs",
		label: "Evaluation Runs",
		kicker: "Compliance Batch",
		icon: ShieldCheck,
		actions: [],
		ledger: [
			"Batch compliance checks against imported Expense Reports using pinned Compiled Rule Sets.",
		],
	},
	{
		id: "extraction-runs",
		label: "Extraction Runs",
		kicker: "Machine Dossier",
		icon: FileOutput,
		actions: [],
		ledger: [
			"Failed runs surface validation detail so editors can retry with corrected configuration.",
		],
	},
	{
		id: "review",
		label: "Review Rules",
		kicker: "Approval Desk",
		icon: ClipboardCheck,
		actions: [],
		ledger: ["Preserve an auditable rationale before publication."],
	},
	{
		id: "policy-versions",
		label: "Policy Versions",
		kicker: "Version Ledger",
		icon: GitBranch,
		actions: [],
		ledger: ["Change summaries explain why a Policy Version was published."],
	},
	{
		id: "compliance",
		label: "Compliance",
		kicker: "Rule Compiler",
		icon: Blocks,
		actions: [],
		ledger: [
			"Compiled Rule Sets are immutable artifacts pinned to one Policy Version.",
		],
	},
	{
		id: "manual-rules",
		label: "Manual Rules",
		kicker: "Manual Override",
		icon: PenLine,
		actions: [],
		ledger: ["Rationale matters because Citation may be absent for this path."],
	},
	{
		id: "audit",
		label: "Audit",
		kicker: "Trace Archive",
		icon: ScrollText,
		actions: [],
		ledger: ["Immutable record of what changed and who recorded it."],
	},
];

const personaOptions: readonly PersonaOption[] = [
	{
		label: "Admin",
		role: "admin",
		token: "local-admin-token",
		blurb:
			"Owns Document Versions, re-ingestion, and core system configuration.",
	},
	{
		label: "Approver",
		role: "approver",
		token: "local-approver-token",
		blurb:
			"Approves Candidate Rules, publishes Policy Versions, and curates Manual Rules.",
	},
	{
		label: "Viewer",
		role: "viewer",
		token: "local-viewer-token",
		blurb:
			"Reads the current Policy Version, review context, and the audit trail.",
	},
];

function describeAuthError(error: unknown): string {
	if (error instanceof ApiError && error.status === 401) {
		return "Token rejected. Use a local persona token or provide a valid custom bearer token.";
	}
	if (error instanceof Error) {
		return error.message;
	}
	return "Authentication failed.";
}

function formatRole(role: Role): string {
	if (role === "approver") {
		return "Approver";
	}
	return role.charAt(0).toUpperCase() + role.slice(1);
}

export default function App() {
	const [status, setStatus] = useState<AuthStatus>("booting");
	const [principal, setPrincipal] = useState<AuthenticatedPrincipal | null>(
		null,
	);
	const [activeSection, setActiveSection] = useState<SectionId>("dashboard");
	const [reviewExtractionRunId, setReviewExtractionRunId] = useState<
		string | null
	>(null);
	const [selectedEvaluationRunId, setSelectedEvaluationRunId] = useState<
		string | null
	>(null);
	const [customToken, setCustomToken] = useState("");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [sidebarOpen, setSidebarOpen] = useState(true);

	useEffect(() => {
		const token = getStoredToken();
		if (!token) {
			setStatus("signed_out");
			return;
		}

		let cancelled = false;
		setStatus("authenticating");

		void fetchMe(token)
			.then((nextPrincipal) => {
				if (cancelled) {
					return;
				}
				setStoredToken(token);
				setPrincipal(nextPrincipal);
				setStatus("authenticated");
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return;
				}
				clearStoredToken();
				setErrorMessage(describeAuthError(error));
				setPrincipal(null);
				setStatus("signed_out");
			});

		return () => {
			cancelled = true;
		};
	}, []);

	async function authenticate(token: string): Promise<void> {
		const nextToken = token.trim();
		if (!nextToken) {
			setErrorMessage("Enter a bearer token before signing in.");
			return;
		}

		setStatus("authenticating");
		setErrorMessage(null);

		try {
			const nextPrincipal = await fetchMe(nextToken);
			setStoredToken(nextToken);
			setPrincipal(nextPrincipal);
			setCustomToken("");
			setActiveSection("dashboard");
			setStatus("authenticated");
		} catch (error: unknown) {
			clearStoredToken();
			setPrincipal(null);
			setStatus("signed_out");
			setErrorMessage(describeAuthError(error));
		}
	}

	function handleCustomTokenSubmit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		void authenticate(customToken);
	}

	function handleSignOut(): void {
		clearStoredToken();
		setPrincipal(null);
		setCustomToken("");
		setErrorMessage(null);
		setStatus("signed_out");
	}

	if (
		status === "booting" ||
		(status === "authenticating" && principal === null)
	) {
		return (
			<main className="loading-stage">
				<section className="loading-card page-enter">
					<h1>Policy Nexus</h1>
					<p>Resolving credentials and loading your workspace.</p>
					<div className="loading-indicator" aria-hidden="true">
						<span />
						<span />
						<span />
					</div>
				</section>
			</main>
		);
	}

	if (status === "signed_out" || principal === null) {
		return (
			<main className="signin-page page-enter">
				<header className="signin-toolbar">
					<span className="folio">Local development</span>
					<ThemeToggle />
				</header>

				<section className="signin-surface reveal">
					<h1>Policy Nexus</h1>
					<p className="signin-lede">Select a role to sign in.</p>

					<ul className="clearance-list">
						{personaOptions.map((persona) => (
							<li key={persona.role}>
								<button
									type="button"
									className={`clearance-chip${persona.role === "admin" ? " is-primary" : ""}`}
									onClick={() => void authenticate(persona.token)}
									disabled={status === "authenticating"}
									title={persona.blurb}
									aria-label={`Enter as ${persona.label}`}
								>
									{persona.label}
								</button>
							</li>
						))}
					</ul>

					{errorMessage ? (
						<p className="error-banner signin-error">{errorMessage}</p>
					) : null}

					<details className="custom-token-gate">
						<summary>Custom bearer token</summary>
						<p className="custom-token-note">
							The client stores the bearer token in session storage and sends it
							on every API request.
						</p>
						<form className="token-form" onSubmit={handleCustomTokenSubmit}>
							<label htmlFor="custom-token">Bearer token</label>
							<textarea
								id="custom-token"
								name="custom-token"
								value={customToken}
								onChange={(event) => setCustomToken(event.target.value)}
								placeholder="Paste a custom token"
								rows={3}
							/>
							<button type="submit" disabled={status === "authenticating"}>
								Sign in with custom token
							</button>
						</form>
					</details>
				</section>
			</main>
		);
	}

	const currentSection =
		shellSections.find((section) => section.id === activeSection) ??
		shellSections[0];
	const roleLabel = principal.roles.map(formatRole).join(" + ");
	const visibleActions = currentSection.actions.filter((action) => {
		const allowed = hasAnyRole(principal, action.allowedRoles);
		return allowed || action.unavailableBehavior !== "hide";
	});

	return (
		<main
			className={`shell-page page-enter${sidebarOpen ? "" : " sidebar-collapsed"}`}
		>
			<aside
				className={`shell-sidebar${sidebarOpen ? "" : " collapsed"}`}
				aria-hidden={!sidebarOpen}
			>
				<div className="sidebar-header">
					<h1>Policy Nexus</h1>
					<button
						type="button"
						className="sidebar-toggle dismiss"
						aria-label="Collapse navigation"
						aria-expanded={sidebarOpen}
						onClick={() => setSidebarOpen(false)}
					>
						<span className="sidebar-toggle-glyph" aria-hidden="true">
							‹
						</span>
					</button>
				</div>

				<nav aria-label="Primary">
					<ul className="nav-list">
						{shellSections.map((section) => (
							<li key={section.id}>
								<button
									type="button"
									className={
										section.id === activeSection
											? "nav-link active"
											: "nav-link"
									}
									onClick={() => {
										if (section.id === "review") {
											setReviewExtractionRunId(null);
										}
										if (section.id === "evaluation-runs") {
											setSelectedEvaluationRunId(null);
										}
										setActiveSection(section.id);
									}}
									tabIndex={sidebarOpen ? undefined : -1}
								>
									<NavIcon icon={section.icon} />
									<span>{section.label}</span>
								</button>
							</li>
						))}
					</ul>
				</nav>

				<footer className="sidebar-footer">
					<div className="sidebar-session">
						<span className="session-subject">{principal.subject}</span>
						<span className="session-role">
							{roleLabel} · {principal.auth_backend}
						</span>
						<div className="sidebar-session-row">
							<button
								type="button"
								className="session-eject"
								onClick={handleSignOut}
							>
								Sign out
							</button>
							<ThemeToggle />
						</div>
					</div>
				</footer>
			</aside>

			<section className="shell-main">
				{!sidebarOpen ? (
					<button
						type="button"
						className="sidebar-toggle reopen"
						aria-label="Expand navigation"
						aria-expanded={false}
						onClick={() => setSidebarOpen(true)}
					>
						<span className="sidebar-toggle-glyph" aria-hidden="true">
							☰
						</span>
					</button>
				) : null}

				<header className="shell-header">
					<div className="shell-header-copy">
						<h2>{currentSection.label}</h2>
						{currentSection.ledger[0] ? (
							<p className="shell-section-lede">{currentSection.ledger[0]}</p>
						) : null}
					</div>
				</header>

				<section
					key={activeSection}
					className="section-card workflow-surface content-enter"
				>
					{visibleActions.length > 0 ? (
						<div className="action-row">
							{visibleActions.map((action) => {
								const allowed = hasAnyRole(principal, action.allowedRoles);
								return (
									<button
										key={action.label}
										type="button"
										className="action-chip"
										disabled={!allowed}
										onClick={() => {
											// Section-specific actions are handled inside each catalog view.
										}}
									>
										{action.label}
									</button>
								);
							})}
						</div>
					) : null}
					{activeSection === "documents" ? (
						<DocumentCatalog principal={principal} />
					) : activeSection === "expense-reports" ? (
						<ExpenseReportsPage
							principal={principal}
							onOpenEvaluationRun={(complianceEvaluationRunId) => {
								setSelectedEvaluationRunId(complianceEvaluationRunId);
								setActiveSection("evaluation-runs");
							}}
						/>
					) : activeSection === "evaluation-runs" ? (
						<ComplianceEvaluationRunCatalog
							principal={principal}
							initialRunId={selectedEvaluationRunId}
						/>
					) : activeSection === "dashboard" ? (
						<DashboardPage
							onOpenSection={(section) => {
								if (section === "review") {
									setReviewExtractionRunId(null);
								}
								setActiveSection(section);
							}}
							onOpenRun={(extractionRunId) => {
								setReviewExtractionRunId(extractionRunId);
								setActiveSection("review");
							}}
						/>
					) : activeSection === "extraction-runs" ? (
						<ExtractionRunCatalog
							onOpenRun={(extractionRunId) => {
								setReviewExtractionRunId(extractionRunId);
								setActiveSection("review");
							}}
						/>
					) : activeSection === "review" ? (
						<CandidateRuleCatalog
							principal={principal}
							extractionRunId={reviewExtractionRunId}
							onClearExtractionRunScope={() => setReviewExtractionRunId(null)}
						/>
					) : activeSection === "policy-versions" ? (
						<PolicyVersionCatalog principal={principal} />
					) : activeSection === "compliance" ? (
						<CompiledRuleSetCatalog principal={principal} />
					) : activeSection === "manual-rules" ? (
						<ManualRulesPage principal={principal} />
					) : activeSection === "audit" ? (
						<AuditLogPage />
					) : (
						<div className="catalog-page content-enter">
							<div className="ledger-grid">
								{currentSection.ledger.map((item) => (
									<article key={item} className="ledger-card">
										<p>{item}</p>
									</article>
								))}
							</div>
						</div>
					)}
				</section>
			</section>
		</main>
	);
}
