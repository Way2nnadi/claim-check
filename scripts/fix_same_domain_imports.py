#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "client" / "src"
DOMAINS = [
    "policy-documents",
    "extraction-runs",
    "candidate-rules",
    "policy-versions",
    "manual-rules",
    "reingestion",
    "audit",
    "rules",
    "app",
    "dashboard",
    "shared",
]

for path in ROOT.rglob("*"):
    if path.suffix not in {".ts", ".tsx"}:
        continue
    rel = path.parent.relative_to(ROOT)
    if not rel.parts:
        continue
    domain = rel.parts[0]
    if domain not in DOMAINS:
        continue
    text = path.read_text(encoding="utf-8")
    needle = f'"../{domain}/'
    if needle not in text:
        continue
    text = text.replace(needle, '"./')
    path.write_text(text, encoding="utf-8")
    print(path.relative_to(ROOT.parent))
