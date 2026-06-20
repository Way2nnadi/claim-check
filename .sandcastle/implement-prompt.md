# Context

This is a **Python / FastAPI** repo implementing the Policy Pipeline MVP.
Read `CONTEXT.md` for domain terms (Rule, Policy Version, Citation, etc.) and `docs/adr/` for architectural decisions.

## Open issues (ready for agent)

!`gh issue list --state open --label ready-for-agent --limit 100 --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`

The list above is the sole source of truth for available work. Do not run your own unfiltered query to find more issues — if the list is empty, there is nothing to do.

## Recent agent commits (last 10)

!`git log --oneline --grep="agent:" -10`

# Task

You are the **implementer** — pick one GitHub issue and implement it on this branch. A separate reviewer agent will review your work before anything is published.

## Priority order

1. Issues with no open blockers listed in their **Blocked by** section
2. Lowest issue number first (respect the dependency chain)
3. Skip issues labeled or described as **HITL** — leave a comment and move on

Before starting an issue, read its full body including **Blocked by**. If any blocker issue is still open, skip it.

## Workflow

0. **Claim** — as soon as you choose an issue, mark it in progress so other runs skip it:

   ```bash
   gh issue edit <N> --remove-label ready-for-agent --add-label agent-in-progress
   gh issue comment <N> --body "Agent claimed this issue and is implementing on branch \`$(git branch --show-current)\`."
   ```

   Do this **before** reading source or writing code. If you later skip the issue (blocker, HITL, or cannot finish), revert the labels:

   ```bash
   gh issue edit <N> --remove-label agent-in-progress --add-label ready-for-agent
   ```

1. **Explore** — read the issue, parent PRD (#1) if referenced, `CONTEXT.md`, and relevant ADRs. Read existing source and tests before writing code.
2. **Plan** — keep the change scoped to this issue's acceptance criteria only.
3. **Execute** — use red-green-refactor where tests apply: failing test first, then implementation.
4. **Verify** — run `uv run pytest` and `uv run ruff check .` before committing. Fix failures before proceeding.
5. **Commit** — one git commit for this issue. Message format:
   - Start with `agent:`
   - Include `#<issue-number>` and the issue title
   - Summarize key decisions and files changed

## Rules

- Work on **one issue only** in this session.
- Use domain language from `CONTEXT.md` (Rule, not test; Policy Version, not ruleset).
- Do not expand scope beyond the current issue.
- Do **not** push, open PRs, or close issues — the publisher runs after review.
- If blocked, revert labels to `ready-for-agent`, comment on the issue explaining why, and output `<promise>COMPLETE</promise>` without committing.

# Done

When the issue is implemented and committed (or there is no actionable issue), output:

<promise>COMPLETE</promise>
