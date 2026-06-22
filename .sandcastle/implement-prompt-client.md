# Context

This issue builds the **Policy Pipeline Client** — a Vite + React + TypeScript app in the monorepo — per PRD #41. Backend changes are in scope only when this issue's acceptance criteria require them.

Read `CONTEXT.md` for domain terms (Rule, Policy Version, Citation, etc.) and `docs/adr/` for architectural decisions.

## Design skill (required for all UI)

Before writing or styling any client UI, read and follow **`$frontend-design`**.

The skill lives at `.agents/skills/frontend-design/SKILL.md`. Apply it **within** the established Notion-inspired visual language — do not replace or restyle global UI.

**Visual language (preserve, do not override):**
- `client/src/app/notion.css` — Notion-style database views, layout, drawers, empty states
- Existing shell: sidebar navigation, page headers, section cards, role-gated actions
- Reuse existing component patterns (tables, chips, modals, drawers) before inventing new ones

Extend pages and features to feel cohesive with what is already shipped. Avoid generic AI UI patterns and avoid reverting the Notion-like theme to an older editorial look.

## Assigned issue

**#{{ISSUE_NUMBER}} — {{ISSUE_TITLE}}**

Sandcastle has already claimed this issue and labeled it `agent-in-progress`. Do not pick a different issue or change issue labels.

!`gh issue view {{ISSUE_NUMBER}} --json number,title,body,labels,comments --jq '{number, title, body, labels: [.labels[].name], comments: [.comments[].body]}'`

## Recent agent commits (last 10)

!`git log --oneline --grep="agent:" -10`

# Task

You are the **implementer** — implement **issue #{{ISSUE_NUMBER}}** on this branch. A separate reviewer agent will review your work before anything is published.

## Workflow

1. **Explore** — read the issue, parent PRD (#41) if referenced, `CONTEXT.md`, and relevant ADRs. Read existing client and backend source before writing code.
2. **Plan** — keep the change scoped to this issue's acceptance criteria only. Read `client/src/app/notion.css` and neighboring pages first; apply **`$frontend-design`** within the existing Notion-inspired shell.
3. **Execute** — use red-green-refactor where tests apply: failing test first, then implementation.
4. **Verify** — run all of the following before committing; fix failures before proceeding:
   - `uv run pytest`
   - `uv run ruff check .`
   - `npm ci --prefix client` (when `client/` exists)
   - `npm run client:build`
5. **Commit** — one git commit for this issue. Message format:
   - Start with `agent:`
   - Include `#{{ISSUE_NUMBER}}` and the issue title
   - Summarize key decisions and files changed

## Rules

- Work on **issue #{{ISSUE_NUMBER}} only** in this session.
- Use domain language from `CONTEXT.md` (Rule, not test; Policy Version, not ruleset).
- Follow **`$frontend-design`** for every page, component, and layout change — extend the Notion-inspired theme; do not replace global styles or shell primitives.
- Do not expand scope beyond the current issue.
- Do **not** push, open PRs, close issues, or edit issue labels — Sandcastle handles those steps.
- If blocked, comment on the issue explaining why and output `<promise>COMPLETE</promise>` without committing. Sandcastle will return the issue to `ready-for-agent`.

# Done

When the issue is implemented and committed (or you are blocked and cannot finish), output:

<promise>COMPLETE</promise>
