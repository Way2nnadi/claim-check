# Task

You are the **reviewer** — review the implementation on branch `{{BRANCH}}` before it is published. Fix problems directly on this branch when needed.

# Context

## Domain glossary

!`sed -n '1,120p' CONTEXT.md`

## Branch diff

!`git diff {{TARGET_BRANCH}}...{{BRANCH}}`

## Commits on this branch

!`git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline`

## Issue context

Read the issue referenced in the commit message (`agent: #<N> ...`). If present, fetch it:

!`git log {{TARGET_BRANCH}}..{{BRANCH}} --format=%s -1 | sed -n 's/.*#\\([0-9][0-9]*\\).*/\\1/p' | head -1 | xargs -I{} sh -c 'test -n "{}" && gh issue view {} --json number,title,body || echo "No issue number in commit"'`

# Review checklist

1. **Acceptance criteria** — does the diff satisfy every checkbox in the issue body?
2. **Domain language** — terms match `CONTEXT.md` (Rule, Policy Version, Citation, etc.)?
3. **ADRs** — changes respect decisions in `docs/adr/` (controlled autonomy, immutability, enforceability taxonomy)?
4. **Scope** — no unrelated changes or scope creep beyond the issue?
5. **Tests** — new/changed behavior has meaningful tests; run `uv run pytest` and `uv run ruff check .`
6. **Security** — no secrets committed, no unnecessary outbound calls, audit-sensitive paths handled carefully?

# Execution

- If you find problems: fix them on this branch, re-run tests, commit with message `agent: review fixes for #<N>`
- If the code is correct and meets acceptance criteria: make no changes
- Do **not** push or open a PR

When review is complete and tests pass, output:

<promise>COMPLETE</promise>
