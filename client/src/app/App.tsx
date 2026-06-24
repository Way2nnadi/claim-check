import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { LucideIcon } from "lucide-react";
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
import { ComplianceReviewCatalog } from "../compliance-review";
import { RuleTestCaseCatalog } from "../rule-test-cases";
import { AuditLogPage } from "../audit";
import { DashboardPage } from "../dashboard";
import ThemeToggle from "../shared/ui/ThemeToggle";
import type { AuthenticatedPrincipal, Role } from "../shared/auth/types";
import ExpenseReportsPage from "../ExpenseReportsPage";
import GuidedTourRail from "./GuidedTourRail";
import {
	getShellSection,
	getVisibleGuidedTourSteps,
	getVisibleNavGroups,
	isSectionVisible,
	type SectionId,
	type ShellSection,
} from "./navigation";

type AuthStatus = "booting" | "signed_out" | "authenticating" | "authenticated";

interface PersonaOption {
	label: string;
	role: Role;
	token: string;
	blurb: string;
}

function NavIcon({ icon: Icon }: { icon: LucideIcon }) {
	return (
		<span className="nav-link-icon" aria-hidden="true">
			<Icon size={18} strokeWidth={1.75} />
		</span>
	);
}

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
	const [selectedComplianceReviewRunId, setSelectedComplianceReviewRunId] =
		useState<string | null>(null);
	const [customToken, setCustomToken] = useState("");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [guidedTourActive, setGuidedTourActive] = useState(false);
	const [guidedTourStepIndex, setGuidedTourStepIndex] = useState(0);

	const visibleTourSteps = useMemo(
		() => (principal ? getVisibleGuidedTourSteps(principal) : []),
		[principal],
	);
	const visibleNavGroups = useMemo(
		() => (principal ? getVisibleNavGroups(principal) : []),
		[principal],
	);
	const dashboardSection = getShellSection("dashboard");

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

	const tourExcludedSections: readonly SectionId[] = ["dashboard", "audit"];
	const showGuidedTourRail =
		guidedTourActive &&
		visibleTourSteps.length > 0 &&
		!tourExcludedSections.includes(activeSection);

	function navigateToSection(sectionId: SectionId): void {
		if (principal && !isSectionVisible(principal, sectionId)) {
			return;
		}
		if (sectionId === "review") {
			setReviewExtractionRunId(null);
		}
		if (sectionId === "evaluation-runs") {
			setSelectedEvaluationRunId(null);
		}
		if (sectionId === "compliance-review") {
			setSelectedComplianceReviewRunId(null);
		}
		if (sectionId === "dashboard" || sectionId === "audit") {
			setGuidedTourActive(false);
			setGuidedTourStepIndex(0);
		}
		setActiveSection(sectionId);
	}

	function startGuidedTour(): void {
		if (visibleTourSteps.length === 0) {
			return;
		}
		setGuidedTourActive(true);
		setGuidedTourStepIndex(0);
		navigateToSection(visibleTourSteps[0].sectionId);
	}

	function goToTourStep(stepIndex: number): void {
		const step = visibleTourSteps[stepIndex];
		if (!step) {
			return;
		}
		setGuidedTourStepIndex(stepIndex);
		navigateToSection(step.sectionId);
	}

	function dismissGuidedTour(): void {
		setGuidedTourActive(false);
		setGuidedTourStepIndex(0);
	}

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
			setGuidedTourActive(false);
			setGuidedTourStepIndex(0);
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
		setGuidedTourActive(false);
		setGuidedTourStepIndex(0);
		setStatus("signed_out");
	}

	if (
		status === "booting" ||
		(status === "authenticating" && principal === null)
	) {
		return (
			<main className="signin-page signin-page-loading page-enter">
				<section className="signin-surface signin-surface-loading reveal">
					<header className="signin-head">
						<span className="signin-kicker">Policy operations</span>
						<h1>Policy Nexus</h1>
						<p className="signin-lede">
							Resolving credentials and loading your workspace.
						</p>
					</header>
					<div className="signin-loading-indicator" aria-hidden="true">
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
					<span className="signin-toolbar-kicker">Local development</span>
					<ThemeToggle />
				</header>

				<section className="signin-surface reveal">
					<header className="signin-head">
						<span className="signin-kicker">Policy operations</span>
						<h1>Policy Nexus</h1>
						<p className="signin-lede">Select a role to sign in.</p>
					</header>

					<ul className="signin-personas">
						{personaOptions.map((persona, index) => (
							<li
								key={persona.role}
								className="signin-persona-item reveal"
								style={{ animationDelay: `${80 + index * 60}ms` }}
							>
								<button
									type="button"
									className={`signin-persona${persona.role === "admin" ? " is-primary" : ""}`}
									onClick={() => void authenticate(persona.token)}
									disabled={status === "authenticating"}
									title={persona.blurb}
									aria-label={`Enter as ${persona.label}`}
								>
									<span className="signin-persona-label">
										{persona.label}
									</span>
									<span className="signin-persona-blurb">{persona.blurb}</span>
								</button>
							</li>
						))}
					</ul>

					{errorMessage ? (
						<p className="error-banner signin-error">{errorMessage}</p>
					) : null}

					<footer className="signin-footer">
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
								<button
									type="submit"
									className="guided-tour-btn guided-tour-btn-primary"
									disabled={status === "authenticating"}
								>
									Sign in with custom token
								</button>
							</form>
						</details>
					</footer>
				</section>
			</main>
		);
	}

	const currentSection = getShellSection(activeSection);
	const roleLabel = principal.roles.map(formatRole).join(" + ");
	const activeTourStepIndex = guidedTourActive
		? visibleTourSteps.findIndex((step) => step.sectionId === activeSection)
		: -1;
	const resolvedTourStepIndex =
		activeTourStepIndex >= 0 ? activeTourStepIndex : guidedTourStepIndex;

	function renderNavLink(section: ShellSection) {
		return (
			<li key={section.id}>
				<button
					type="button"
					className={
						section.id === activeSection ? "nav-link active" : "nav-link"
					}
					onClick={() => navigateToSection(section.id)}
					tabIndex={sidebarOpen ? undefined : -1}
				>
					<NavIcon icon={section.icon} />
					<span className="nav-link-copy">
						<span className="nav-link-label">{section.label}</span>
						<small>{section.kicker}</small>
					</span>
				</button>
			</li>
		);
	}

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
					<ul className="nav-list">{renderNavLink(dashboardSection)}</ul>

					{visibleNavGroups.map((group) => (
						<div key={group.id} className="nav-group">
							<p className="nav-group-label">{group.label}</p>
							<ul className="nav-list">
								{group.sections.map((section) => renderNavLink(section))}
							</ul>
						</div>
					))}
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

				{showGuidedTourRail ? (
					<GuidedTourRail
						steps={visibleTourSteps}
						activeStepIndex={resolvedTourStepIndex}
						onGoToStep={goToTourStep}
						onDismiss={dismissGuidedTour}
					/>
				) : null}

				<header className="shell-header">
					<div className="shell-header-copy">
						<p className="shell-section-kicker">{currentSection.kicker}</p>
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
					) : activeSection === "compliance-review" ? (
						<ComplianceReviewCatalog
							principal={principal}
							initialRunId={selectedComplianceReviewRunId}
						/>
					) : activeSection === "rule-test-cases" ? (
						<RuleTestCaseCatalog principal={principal} />
					) : activeSection === "dashboard" ? (
						<DashboardPage
							onOpenSection={(section) => navigateToSection(section)}
							onOpenRun={(extractionRunId) => {
								setReviewExtractionRunId(extractionRunId);
								setActiveSection("review");
							}}
							onStartGuidedTour={startGuidedTour}
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
