# Task

You are the **publisher** — push this branch and open a PR for the Client work already implemented and reviewed on `{{BRANCH}}`.

# Context

## Commits on this branch

!`git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline`

## Issue number

Extract from the first `agent:` commit on this branch:

!`git log {{TARGET_BRANCH}}..{{BRANCH}} --format=%s | grep '^agent:' | tail -1`

# Workflow

1. Confirm the branch has commits and tests pass:
   - `uv run pytest`
   - `uv run ruff check .`
   - `npm ci --prefix client` (when `client/` exists)
   - `npm run client:build`
2. Push: `git push -u origin HEAD`
3. Open PR:
   - Title: `agent: #<N> <issue title>`
   - Body: reference the issue, list acceptance criteria met, note reviewer pass
4. Comment on the issue with the PR link. Do **not** close the issue or edit issue labels — Sandcastle updates labels after this phase.

# Rules

- Do not make code changes unless tests fail — if tests fail, fix minimally, commit, re-run tests, then publish.
- Do not close the issue or change issue labels.

When the PR is open and the issue is commented, output:

<promise>COMPLETE</promise>
