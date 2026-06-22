#!/usr/bin/env python3
"""Repair broken imports after aggressive rewrite."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "client" / "src"

DOMAIN_DIRS = [
    "policy-documents",
    "extraction-runs",
    "candidate-rules",
    "policy-versions",
    "manual-rules",
    "reingestion",
    "audit",
    "rules",
    "shared",
    "app",
    "dashboard",
]


def fix_double_import(text: str) -> str:
    return re.sub(r"import \{ import \{", "import {", text)


def fix_domain_short_imports(path: Path, text: str) -> str:
    rel = path.parent.relative_to(SRC)
    domain = rel.parts[0] if rel.parts else ""

    if domain in {
        "policy-documents",
        "extraction-runs",
        "candidate-rules",
        "policy-versions",
        "manual-rules",
        "reingestion",
        "audit",
        "rules",
    }:
        text = re.sub(r'from "types"', 'from "./types"', text)
        text = re.sub(r'from "api"', 'from "./api"', text)
        text = re.sub(r'from "format"', 'from "./format"', text)

    if domain == "shared":
        text = re.sub(r'from "auth/types"', 'from "./auth/types"', text)
        text = re.sub(r'from "types"', 'from "./auth/types"', text)
        text = re.sub(r'from "client"', 'from "./client"', text)
        if path.parent.name == "ui" and 'from "useAsyncResource"' in text:
            text = re.sub(r'from "useAsyncResource"', 'from "./useAsyncResource"', text)

    return text


def main() -> None:
    for path in SRC.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        text = path.read_text(encoding="utf-8")
        original = text
        text = fix_double_import(text)
        text = fix_domain_short_imports(path, text)
        if text != original:
            path.write_text(text, encoding="utf-8")
            print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
