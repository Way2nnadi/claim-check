import { FormEvent, useEffect, useState } from "react";
import {
  ApiError,
  clearStoredToken,
  fetchMe,
  getStoredToken,
  setStoredToken,
} from "./api";
import { hasAnyRole } from "./permissions";
import type { AuthenticatedPrincipal, Role } from "./types";

type AuthStatus = "booting" | "signed_out" | "authenticating" | "authenticated";
type SectionId = "documents" | "review" | "policy-versions" | "manual-rules" | "audit";

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
  summary: string;
  detail: string;
  actions: readonly SectionAction[];
  ledger: readonly string[];
}

const personaOptions: readonly PersonaOption[] = [
  {
    label: "Admin",
    role: "admin",
    token: "local-admin-token",
    blurb: "Owns Document Versions, re-ingestion, and editorial system setup.",
  },
  {
    label: "Approver",
    role: "approver",
    token: "local-approver-token",
    blurb: "Approves Candidate Rules, publishes Policy Versions, and curates Manual Rules.",
  },
  {
    label: "Viewer",
    role: "viewer",
    token: "local-viewer-token",
    blurb: "Reads the current Policy Version, review context, and the audit trail.",
  },
];

const shellSections: readonly ShellSection[] = [
  {
    id: "documents",
    label: "Documents",
    kicker: "Source Intake",
    summary: "Track immutable Policy Document uploads and fresh Document Versions.",
    detail:
      "Every upload lands as a new Document Version so Citations keep a stable anchor.",
    actions: [
      {
        label: "Upload Document Version",
        allowedRoles: ["admin"],
        unavailableBehavior: "hide",
      },
      {
        label: "Schedule Re-ingestion",
        allowedRoles: ["admin"],
        unavailableBehavior: "hide",
      },
    ],
    ledger: [
      "Capture source documents without mutating prior Document Versions.",
      "Preserve Citation fidelity before any Candidate Rule enters review.",
    ],
  },
  {
    id: "review",
    label: "Review",
    kicker: "Approval Desk",
    summary: "Triage Candidate Rules, QA Flags, and approver decisions.",
    detail:
      "Approvers move extracted Candidate Rules toward the Structured Policy Store.",
    actions: [
      {
        label: "Approve Candidate Rules",
        allowedRoles: ["admin", "approver"],
        unavailableBehavior: "disable",
      },
      {
        label: "Reject Candidate Rules",
        allowedRoles: ["admin", "approver"],
        unavailableBehavior: "disable",
      },
    ],
    ledger: [
      "Keep machine-checkable Rules separate from guidance and subjective statements.",
      "Preserve an auditable rationale before publication.",
    ],
  },
  {
    id: "policy-versions",
    label: "Policy Versions",
    kicker: "Release Ledger",
    summary: "Publish immutable Policy Version snapshots for downstream consumers.",
    detail:
      "Policy Versions freeze the approved Rules at a point in time for reproducible runs.",
    actions: [
      {
        label: "Publish Policy Version",
        allowedRoles: ["admin", "approver"],
        unavailableBehavior: "disable",
      },
    ],
    ledger: [
      "Downstream systems pin to a Policy Version, never to mutable in-flight edits.",
      "Change summaries explain why a release exists.",
    ],
  },
  {
    id: "manual-rules",
    label: "Manual Rules",
    kicker: "Editorial Addenda",
    summary: "Create approved Rules when policy knowledge is known but uncited.",
    detail:
      "Manual Rules still enter the Structured Policy Store, with rationale in place of a Citation.",
    actions: [
      {
        label: "Create Manual Rule",
        allowedRoles: ["admin", "approver"],
        unavailableBehavior: "disable",
      },
    ],
    ledger: [
      "Manual Rules are explicit interventions, not silent mutations.",
      "Rationale matters because Citation may be absent for this path.",
    ],
  },
  {
    id: "audit",
    label: "Audit",
    kicker: "Trace Archive",
    summary: "Read the tamper-evident trail across Rule approvals and publications.",
    detail:
      "Every role can inspect how a Candidate Rule or Policy Version reached its current state.",
    actions: [],
    ledger: [
      "Actor, entity, and rationale stay legible for regulated buyers.",
      "The audit trail explains both what changed and who recorded it.",
    ],
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
  const [principal, setPrincipal] = useState<AuthenticatedPrincipal | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("documents");
  const [customToken, setCustomToken] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  if (status === "booting" || (status === "authenticating" && principal === null)) {
    return (
      <main className="loading-stage">
        <section className="loading-card">
          <p className="eyebrow">Policy Pipeline</p>
          <h1>Authorizing the editorial desk.</h1>
          <p>
            Resolving the current bearer token and loading the role-aware publication shell.
          </p>
        </section>
      </main>
    );
  }

  if (status === "signed_out" || principal === null) {
    return (
      <main className="signin-page">
        <section className="signin-hero">
          <p className="eyebrow">Editorial Shell</p>
          <h1>Policy Pipeline Gazette</h1>
          <p className="hero-copy">
            Local development auth is token-based. Pick a persona or paste any bearer token
            wired into the FastAPI local identity registry.
          </p>
          <div className="masthead-rule" />
          <ul className="persona-grid">
            {personaOptions.map((persona) => (
              <li key={persona.role} className="persona-card">
                <div>
                  <p className="persona-role">{formatRole(persona.role)}</p>
                  <h2>{persona.label}</h2>
                  <p>{persona.blurb}</p>
                </div>
                <div className="persona-footer">
                  <code>{persona.token}</code>
                  <button
                    type="button"
                    onClick={() => void authenticate(persona.token)}
                    disabled={status === "authenticating"}
                  >
                    Sign in as {persona.label}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <aside className="signin-panel">
          <p className="eyebrow">Custom Token</p>
          <h2>Bring your own principal</h2>
          <p className="panel-copy">
            The client stores the bearer token in session storage and sends it on every API
            request.
          </p>
          <form className="token-form" onSubmit={handleCustomTokenSubmit}>
            <label htmlFor="custom-token">Bearer token</label>
            <textarea
              id="custom-token"
              name="custom-token"
              value={customToken}
              onChange={(event) => setCustomToken(event.target.value)}
              placeholder="Paste a custom token"
              rows={4}
            />
            <button type="submit" disabled={status === "authenticating"}>
              Sign in with custom token
            </button>
          </form>
          {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
        </aside>
      </main>
    );
  }

  const currentSection =
    shellSections.find((section) => section.id === activeSection) ?? shellSections[0];
  const roleLabel = principal.roles.map(formatRole).join(" + ");
  const visibleActions = currentSection.actions.filter((action) => {
    const allowed = hasAnyRole(principal, action.allowedRoles);
    return allowed || action.unavailableBehavior !== "hide";
  });

  return (
    <main className="shell-page">
      <aside className="shell-sidebar">
        <div className="sidebar-header">
          <p className="eyebrow">Policy Pipeline</p>
          <h1>Editorial Desk</h1>
          <p className="sidebar-copy">
            Role-aware navigation over Document Versions, Candidate Rules, and Policy Versions.
          </p>
        </div>

        <nav aria-label="Primary">
          <ul className="nav-list">
            {shellSections.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  className={section.id === activeSection ? "nav-link active" : "nav-link"}
                  onClick={() => setActiveSection(section.id)}
                >
                  <span>{section.label}</span>
                  <small>{section.kicker}</small>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <section className="shell-main">
        <header className="shell-header">
          <div>
            <p className="eyebrow">{currentSection.kicker}</p>
            <h2>{currentSection.label}</h2>
            <p className="section-summary">{currentSection.summary}</p>
          </div>
          <div className="principal-panel">
            <div>
              <p className="principal-subject">{principal.subject}</p>
              <p className="principal-meta">
                {roleLabel} via {principal.auth_backend}
              </p>
            </div>
            <button type="button" className="signout-button" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </header>

        <section className="section-card">
          <div className="lede-block">
            <p>{currentSection.detail}</p>
          </div>
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
            {visibleActions.length === 0 ? (
              <p className="read-only-note">Read-only surface for every authenticated role.</p>
            ) : null}
          </div>
          <div className="ledger-grid">
            {currentSection.ledger.map((item) => (
              <article key={item} className="ledger-card">
                <p>{item}</p>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
