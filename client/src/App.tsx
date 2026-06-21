import { useEffect, useState, type FormEvent } from "react";
import {
	ApiError,
	clearStoredToken,
	fetchMe,
	getStoredToken,
	setStoredToken,
} from "./api";
import DocumentCatalog from "./DocumentCatalog";
import CandidateRuleCatalog from "./CandidateRuleCatalog";
import ExtractionRunCatalog from "./ExtractionRunCatalog";
import PolicyVersionCatalog from "./PolicyVersionCatalog";
import ThemeToggle from "./ThemeToggle";
import { hasAnyRole } from "./permissions";
import type { AuthenticatedPrincipal, Role } from "./types";

type AuthStatus = "booting" | "signed_out" | "authenticating" | "authenticated";
type SectionId =
	| "documents"
	| "extraction-runs"
	| "review"
	| "policy-versions"
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
	actions: readonly SectionAction[];
	ledger: readonly string[];
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

const shellSections: readonly ShellSection[] = [
	{
		id: "documents",
		label: "Documents",
		kicker: "Source Intake",
		actions: [],
		ledger: ["Preserve Citation fidelity before any Candidate Rule enters review."],
	},
	{
		id: "extraction-runs",
		label: "Extraction Runs",
		kicker: "Machine Dossier",
		actions: [],
		ledger: [
			"Failed runs surface validation detail so editors can retry with corrected configuration.",
		],
	},
	{
		id: "review",
		label: "Review",
		kicker: "Approval Desk",
		actions: [],
		ledger: ["Preserve an auditable rationale before publication."],
	},
	{
		id: "policy-versions",
		label: "Policy Versions",
		kicker: "Release Ledger",
		actions: [
			{
				label: "Publish Policy Version",
				allowedRoles: ["admin", "approver"],
				unavailableBehavior: "disable",
			},
		],
		ledger: ["Change summaries explain why a release exists."],
	},
	{
		id: "manual-rules",
		label: "Manual Rules",
		kicker: "Manual Override",
		actions: [
			{
				label: "Create Manual Rule",
				allowedRoles: ["admin", "approver"],
				unavailableBehavior: "disable",
			},
		],
		ledger: ["Rationale matters because Citation may be absent for this path."],
	},
	{
		id: "audit",
		label: "Audit",
		kicker: "Trace Archive",
		actions: [],
		ledger: ["The audit trail explains both what changed and who recorded it."],
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
	const [activeSection, setActiveSection] = useState<SectionId>("documents");
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
			setActiveSection("documents");
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
					<p className="eyebrow">Policy Nexus</p>
					<h1>Establishing secure link.</h1>
					<p>
						Resolving bearer credentials and loading the role-aware operations
						console.
					</p>
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
					<span className="folio">SYS·01 · Local Dev</span>
					<ThemeToggle />
				</header>

				<section className="signin-surface reveal">
					<h1>
						Policy <span className="title-accent">Nexus</span>
					</h1>
					<p className="signin-lede">
						Select clearance to enter the console.
					</p>

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
				<button
					type="button"
					className="sidebar-toggle dismiss"
					aria-label="Collapse navigation"
					aria-expanded={sidebarOpen}
					onClick={() => setSidebarOpen(false)}
				>
					<span className="sidebar-toggle-glyph" aria-hidden="true">
						◂
					</span>
					<span className="sidebar-toggle-text">Min</span>
				</button>

				<div className="sidebar-header">
					<p className="eyebrow">Policy Nexus</p>
					<h1>Console</h1>
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
									onClick={() => setActiveSection(section.id)}
									tabIndex={sidebarOpen ? undefined : -1}
								>
									<span>{section.label}</span>
									<small>{section.kicker}</small>
								</button>
							</li>
						))}
					</ul>
				</nav>

				<footer className="sidebar-footer">
					<span className="sidebar-footer-label">Display mode</span>
					<ThemeToggle />
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
							▸
						</span>
						<span className="sidebar-toggle-text">Nav</span>
					</button>
				) : null}

				<header className="shell-header">
					<h2>{currentSection.label}</h2>
					<div className="header-command-rail">
						{!sidebarOpen ? <ThemeToggle /> : null}
						<div className="session-strip" aria-label="Active session">
							<span className="session-beacon" aria-hidden="true" />
							<div className="session-identity">
								<span className="session-subject">{principal.subject}</span>
								<span className="session-role">
									{roleLabel} · {principal.auth_backend}
								</span>
							</div>
							<span className="session-divider" aria-hidden="true" />
							<button
								type="button"
								className="session-eject"
								onClick={handleSignOut}
							>
								Sign out
							</button>
						</div>
					</div>
				</header>

				<section key={activeSection} className="section-card content-enter">
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
									>
										{action.label}
									</button>
								);
							})}
						</div>
					) : null}
					{activeSection === "documents" ? (
						<DocumentCatalog principal={principal} />
					) : activeSection === "extraction-runs" ? (
						<ExtractionRunCatalog />
					) : activeSection === "review" ? (
						<CandidateRuleCatalog principal={principal} />
					) : activeSection === "policy-versions" ? (
						<PolicyVersionCatalog principal={principal} />
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
