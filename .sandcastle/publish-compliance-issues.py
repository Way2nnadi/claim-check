#!/usr/bin/env python3
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ISSUES_DIR = ROOT / ".sandcastle" / "issues"

# `client` label routes Sandcastle to implement-prompt-client.md (frontend-design skill).
ISSUES = [
    {
        "key": "01",
        "title": "ADR-0005: Custom in-process Compliance Evaluator",
        "labels": ["human-in-the-loop"],
        "file": "01-adr.md",
        "blockers": [],
    },
    {
        "key": "02",
        "title": "Compliance: compile Policy Version into Compiled Rule Set",
        "labels": ["ready-for-agent"],
        "file": "02-compile.md",
        "blockers": ["01"],
    },
    {
        "key": "07A",
        "title": "Compliance: Expense Report CSV import",
        "labels": ["ready-for-agent", "client"],
        "file": "07a-expense-import.md",
        "blockers": ["01"],
    },
    {
        "key": "07B",
        "title": "Compliance: Expense Report browse",
        "labels": ["ready-for-agent", "client"],
        "file": "07b-expense-browse.md",
        "blockers": ["07A"],
    },
    {
        "key": "03",
        "title": "Compliance: generate Rule Test Cases (positive and negative)",
        "labels": ["ready-for-agent"],
        "file": "03-test-pos-neg.md",
        "blockers": ["02"],
    },
    {
        "key": "04",
        "title": "Compliance: generate Rule Test Cases (boundary and exception)",
        "labels": ["ready-for-agent"],
        "file": "04-test-boundary-exception.md",
        "blockers": ["03"],
    },
    {
        "key": "05",
        "title": "Compliance: execute Rule Test Case run",
        "labels": ["ready-for-agent", "client"],
        "file": "05-test-run.md",
        "blockers": ["04"],
    },
    {
        "key": "06",
        "title": "Compliance: disable Rule Test Case with rationale",
        "labels": ["ready-for-agent", "client"],
        "file": "06-test-disable.md",
        "blockers": ["05"],
    },
    {
        "key": "15",
        "title": "Compliance: golden Rule Test Case corpus (CI)",
        "labels": ["ready-for-agent"],
        "file": "15-golden-test-corpus.md",
        "blockers": ["05"],
    },
    {
        "key": "08A",
        "title": "Compliance: Compliance Evaluation Run API (pass and violation)",
        "labels": ["ready-for-agent"],
        "file": "08a-eval-run-api.md",
        "blockers": ["02", "07A"],
    },
    {
        "key": "08B",
        "title": "Compliance: Compliance Evaluation Run client",
        "labels": ["ready-for-agent", "client"],
        "file": "08b-eval-run-client.md",
        "blockers": ["08A"],
    },
    {
        "key": "09",
        "title": "Compliance: violation outcomes with Citation evidence",
        "labels": ["ready-for-agent", "client"],
        "file": "09-violation-citation.md",
        "blockers": ["08B"],
    },
    {
        "key": "10",
        "title": "Compliance: needs_review for guidance and subjective Rules",
        "labels": ["ready-for-agent", "client"],
        "file": "10-needs-review.md",
        "blockers": ["09"],
    },
    {
        "key": "11",
        "title": "Compliance: missing_evidence and Exception evidence gating",
        "labels": ["ready-for-agent", "client"],
        "file": "11-missing-evidence.md",
        "blockers": ["10"],
    },
    {
        "key": "12",
        "title": "Compliance: multi-Rule outcome precedence",
        "labels": ["ready-for-agent"],
        "file": "12-precedence.md",
        "blockers": ["11"],
    },
    {
        "key": "16",
        "title": "Compliance: golden expense corpus and evaluation quality report",
        "labels": ["ready-for-agent"],
        "file": "16-golden-expense-report.md",
        "blockers": ["12"],
    },
    {
        "key": "13",
        "title": "Compliance: Compliance Review queue and review screen",
        "labels": ["ready-for-agent", "client"],
        "file": "13-review-queue.md",
        "blockers": ["12"],
    },
    {
        "key": "14A",
        "title": "Compliance: Compliance Review decisions",
        "labels": ["ready-for-agent", "client"],
        "file": "14a-review-decisions.md",
        "blockers": ["13"],
    },
    {
        "key": "14B",
        "title": "Compliance: Compliance Review audit trail",
        "labels": ["ready-for-agent", "client"],
        "file": "14b-review-audit.md",
        "blockers": ["14A"],
    },
]


def main() -> None:
    numbers: dict[str, str] = {}
    created: list[tuple[str, str]] = []

    for issue in ISSUES:
        body = (ISSUES_DIR / issue["file"]).read_text()
        for blocker_key in issue["blockers"]:
            placeholder = f"BLOCKER_{blocker_key}"
            if placeholder not in body:
                raise SystemExit(f"Missing {placeholder} in {issue['file']}")
            body = body.replace(placeholder, f"#{numbers[blocker_key]}")

        if "BLOCKER_" in body:
            raise SystemExit(f"Unresolved blockers in {issue['file']}")

        cmd = [
            "gh",
            "issue",
            "create",
            "--title",
            issue["title"],
            "--body",
            body,
        ]
        for label in issue["labels"]:
            cmd.extend(["--label", label])

        result = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            cwd=ROOT,
        )
        url = result.stdout.strip()
        number = url.rsplit("/", 1)[-1]
        numbers[issue["key"]] = number
        created.append((number, issue["title"]))
        print(f"Created #{number} — {issue['title']}")

    print(f"\nPublished {len(created)} issues. Parent: #69")
    for number, title in created:
        print(f"  https://github.com/Way2nnadi/claim-check/issues/{number} — {title}")


if __name__ == "__main__":
    main()
