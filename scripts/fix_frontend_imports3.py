#!/usr/bin/env python3
"""Rewrite all frontend imports to correct domain modules."""

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
    "SESSION_STORAGE_TOKEN_KEY": "shared/api/client",
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
    "describeFetchError": "policy-documents/format",
    "formatDocumentTitle": "policy-documents/format",
    "formatUploadDate": "policy-documents/format",
    "formatBytes": "policy-documents/format",
    "formatContentTypeLabel": "policy-documents/format",
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
    "formatExtractionRunStatus": "extraction-runs/format",
    "formatPinningLabel": "extraction-runs/format",
    "parseRegistryPin": "extraction-runs/format",
    "describeTriggerExtractionRunError": "extraction-runs/format",
    "shortenId": "shared/format/common",
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
    "describePolicyVersionPublishError": "policy-versions/format",
    "formatPolicyVersionDate": "policy-versions/format",
    "createManualRule": "manual-rules/api",
    "reingestDocument": "reingestion/api",
    "ReingestionRequest": "reingestion/types",
    "ReingestionResult": "reingestion/types",
    "PolicyVersionDiff": "reingestion/types",
    "describeReingestionError": "reingestion/format",
    "summarizeDiffCounts": "reingestion/format",
    "defaultReingestionRunId": "reingestion/format",
    "fetchAuditEvents": "audit/api",
    "AuditEvent": "audit/types",
    "AuditEventListResponse": "audit/types",
    "AuditEventFilters": "audit/types",
    "formatAuditTimestamp": "audit/format",
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
    "formatEnforceabilityClass": "rules/format",
    "formatLifecycleState": "rules/format",
    "hasAnyRole": "shared/permissions",
    "initTheme": "shared/theme",
    "useAsyncResource": "shared/ui/useAsyncResource",
}

IMPORT_RE = re.compile(
    r"import\s+(type\s+)?\{([^}]+)\}\s+from\s+['\"]([^'\"]+)['\"];?",
    re.DOTALL,
)


def rel_import(from_dir: Path, module: str) -> str:
    target = SRC / module
    for ext in (".ts", ".tsx"):
        if Path(str(target) + ext).exists():
            target = Path(str(target) + ext)
            break
    rel = os.path.relpath(target.with_suffix(""), from_dir)
    return rel.replace("\\", "/")


def fix_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    grouped: dict[str, dict[str, list[str]]] = {}
    other_imports: list[str] = []

    def add(module: str, is_type: bool, symbol: str) -> None:
        bucket = grouped.setdefault(module, {"type": [], "value": []})
        key = "type" if is_type else "value"
        if symbol not in bucket[key]:
            bucket[key].append(symbol)

    last_end = 0
    body_parts = []
    for m in IMPORT_RE.finditer(text):
        body_parts.append(text[last_end : m.start()])
        is_type = bool(m.group(1))
        symbols = [s.strip() for s in m.group(2).replace("\n", " ").split(",") if s.strip()]
        source = m.group(3)
        kept = []
        for sym in symbols:
            name = sym.split(" as ")[0].strip()
            target = SYMBOL_MODULE.get(name)
            if target is None:
                kept.append(sym)
                continue
            expected = rel_import(path.parent, target)
            if source == expected:
                kept.append(sym)
            else:
                add(target, is_type, sym)
        if kept:
            type_kw = "type " if is_type else ""
            other_imports.append(
                f'import {type_kw}{{ {", ".join(kept)} }} from "{source}";'
            )
        last_end = m.end()
    body_parts.append(text[last_end:])
    body = "".join(body_parts)

    if not grouped:
        return False

    new_imports = []
    for module in sorted(grouped):
        rel = rel_import(path.parent, module)
        if grouped[module]["type"]:
            new_imports.append(
                f'import type {{ {", ".join(grouped[module]["type"])} }} from "{rel}";'
            )
        if grouped[module]["value"]:
            new_imports.append(
                f'import {{ {", ".join(grouped[module]["value"])} }} from "{rel}";'
            )

    new_text = "\n".join(new_imports + other_imports) + body
    # normalize duplicate blank lines at top
    new_text = re.sub(r"\n{3,}", "\n\n", new_text.lstrip("\n"))
    if new_text != text:
        path.write_text(new_text, encoding="utf-8")
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
