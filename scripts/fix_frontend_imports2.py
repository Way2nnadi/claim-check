#!/usr/bin/env python3
"""Fix wrong shared/auth/types and shared/api/client imports."""

from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "client" / "src"

SYMBOL_MODULE: dict[str, str] = {
    "ApiError": "shared/api/client",
    "apiRequest": "shared/api/client",
    "getStoredToken": "shared/api/client",
    "setStoredToken": "shared/api/client",
    "clearStoredToken": "shared/api/client",
    "downloadAttachment": "shared/api/client",
    "fetchMe": "shared/auth/api",
    "Role": "shared/auth/types",
    "AuthenticatedPrincipal": "shared/auth/types",
    "fetchPolicyDocuments": "policy-documents/api",
    "fetchDocumentVersions": "policy-documents/api",
    "uploadDocumentVersion": "policy-documents/api",
    "deleteDocumentVersion": "policy-documents/api",
    "downloadDocumentVersion": "policy-documents/api",
    "fetchDocumentSections": "policy-documents/api",
    "PolicyDocumentSummary": "policy-documents/types",
    "PolicyDocumentListResponse": "policy-documents/types",
    "DocumentVersion": "policy-documents/types",
    "DocumentVersionListResponse": "policy-documents/types",
    "DocumentSection": "policy-documents/types",
    "DocumentSectionListResponse": "policy-documents/types",
    "fetchExtractionRuns": "extraction-runs/api",
    "fetchDocumentVersionExtractionRuns": "extraction-runs/api",
    "fetchPromptTemplates": "extraction-runs/api",
    "fetchModelConfigurations": "extraction-runs/api",
    "createExtractionRun": "extraction-runs/api",
    "ExtractionRun": "extraction-runs/types",
    "ExtractionRunListResponse": "extraction-runs/types",
    "ExtractionRunFilters": "extraction-runs/types",
    "ExtractionRunStatus": "extraction-runs/types",
    "ExtractionRunCreateRequest": "extraction-runs/types",
    "ExtractionExecutionResult": "extraction-runs/types",
    "PromptTemplateSummary": "extraction-runs/types",
    "PromptTemplateListResponse": "extraction-runs/types",
    "ModelConfigurationSummary": "extraction-runs/types",
    "ModelConfigurationListResponse": "extraction-runs/types",
    "fetchCandidateRules": "candidate-rules/api",
    "fetchCandidateRule": "candidate-rules/api",
    "updateCandidateRule": "candidate-rules/api",
    "approveCandidateRule": "candidate-rules/api",
    "approveCandidateRulesBulk": "candidate-rules/api",
    "rejectCandidateRule": "candidate-rules/api",
    "CandidateRuleReview": "candidate-rules/types",
    "CandidateRuleReviewListResponse": "candidate-rules/types",
    "CandidateRuleFilters": "candidate-rules/types",
    "CandidateRuleReviewUpdateRequest": "candidate-rules/types",
    "CandidateRuleApprovalRequest": "candidate-rules/types",
    "CandidateRuleApprovalResponse": "candidate-rules/types",
    "BulkCandidateRuleApprovalRequest": "candidate-rules/types",
    "BulkCandidateRuleApprovalResponse": "candidate-rules/types",
    "CandidateRuleRejectionRequest": "candidate-rules/types",
    "CandidateRuleRejectionResponse": "candidate-rules/types",
    "fetchPolicyVersions": "policy-versions/api",
    "fetchPolicyVersion": "policy-versions/api",
    "publishPolicyVersion": "policy-versions/api",
    "downloadPolicyVersionSnapshot": "policy-versions/api",
    "PolicyVersionSummary": "policy-versions/types",
    "PolicyVersionListResponse": "policy-versions/types",
    "PolicyVersionPublishRequest": "policy-versions/types",
    "PolicyVersionPublishResponse": "policy-versions/types",
    "PolicyVersionSnapshot": "policy-versions/types",
    "createManualRule": "manual-rules/api",
    "reingestDocument": "reingestion/api",
    "ReingestionRequest": "reingestion/types",
    "ReingestionResult": "reingestion/types",
    "PolicyVersionDiff": "reingestion/types",
    "fetchAuditEvents": "audit/api",
    "AuditEvent": "audit/types",
    "AuditEventListResponse": "audit/types",
    "AuditEventFilters": "audit/types",
    "Rule": "rules/types",
    "CandidateRuleValue": "rules/types",
    "LifecycleState": "rules/types",
    "EnforceabilityClass": "rules/types",
    "QAFlagCode": "rules/types",
    "ReingestionDiffCategory": "rules/types",
    "AggregationPeriod": "rules/types",
    "RuleOriginType": "rules/types",
    "RuleOrigin": "rules/types",
    "Citation": "rules/types",
    "Scope": "rules/types",
    "Applicability": "rules/types",
    "RuleException": "rules/types",
    "RuleCondition": "rules/types",
    "QAFlag": "rules/types",
    "ManualRuleCreateRequest": "rules/types",
}

IMPORT_LINE = re.compile(
    r"^(import\s+(type\s+)?\{)([^}]+)(\}\s+from\s+['\"])([^'\"]+)(['\"];?\s*)$",
    re.MULTILINE,
)


def rel_import(from_dir: Path, module: str) -> str:
    target = SRC / module
    for ext in (".ts", ".tsx"):
        candidate = Path(str(target) + ext)
        if candidate.exists():
            target = candidate
            break
    rel = os.path.relpath(target.with_suffix(""), from_dir)
    return rel.replace("\\", "/")


def parse_symbols(raw: str) -> list[tuple[str, str, bool]]:
    is_type_prefix = False
    items = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        alias = None
        if " as " in part:
            name, alias = part.split(" as ", 1)
            name = name.strip()
            alias = alias.strip()
        else:
            name = part
        items.append((name, alias or name, is_type_prefix))
    return items


def fix_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    grouped: dict[str, dict[str, list[str]]] = {}

    def add(module: str, is_type: bool, symbol: str) -> None:
        bucket = grouped.setdefault(module, {"type": [], "value": []})
        key = "type" if is_type else "value"
        if symbol not in bucket[key]:
            bucket[key].append(symbol)

    remaining_lines = []
    for line in text.splitlines():
        m = IMPORT_LINE.match(line)
        if not m:
            remaining_lines.append(line)
            continue
        is_type = bool(m.group(2))
        symbols_raw = m.group(3)
        source = m.group(5)
        symbols = [s.strip() for s in symbols_raw.split(",") if s.strip()]
        kept = []
        for sym in symbols:
            name = sym.split(" as ")[0].strip()
            target = SYMBOL_MODULE.get(name)
            if target is None:
                kept.append(sym)
                continue
            expected = rel_import(path.parent, target)
            if source.replace("/index", "") == expected or source.endswith(expected.split("/")[-1]):
                kept.append(sym)
                continue
            add(target, is_type, sym)
        if kept:
            prefix, _, _, suffix_start, _, suffix_end = m.groups()
            remaining_lines.append(f"{prefix}{', '.join(kept)}{suffix_start}{source}{suffix_end}")
        # else drop the line

    if not grouped:
        return False

    import_block = []
    for module in sorted(grouped):
        rel = rel_import(path.parent, module)
        if grouped[module]["type"]:
            import_block.append(
                f'import type {{ {", ".join(grouped[module]["type"])} }} from "{rel}";'
            )
        if grouped[module]["value"]:
            import_block.append(
                f'import {{ {", ".join(grouped[module]["value"])} }} from "{rel}";'
            )

    # merge duplicate import lines in import_block
    out_lines = []
    inserted = False
    for line in remaining_lines:
        if not inserted and not line.startswith("import ") and import_block:
            out_lines.extend(import_block)
            inserted = True
        out_lines.append(line)
    if not inserted:
        out_lines = import_block + out_lines

    new_text = "\n".join(out_lines)
    if new_text != text:
        path.write_text(new_text + "\n", encoding="utf-8")
        return True
    return False


def main() -> None:
    n = 0
    for path in sorted(SRC.rglob("*")):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        if fix_file(path):
            n += 1
            print(path.relative_to(ROOT))
    print(f"fixed {n} files")


if __name__ == "__main__":
    main()
