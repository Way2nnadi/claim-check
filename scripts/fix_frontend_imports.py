#!/usr/bin/env python3
"""Fix frontend imports after domain restructure."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "client" / "src"

# Map import paths to fix
PATH_FIXES: list[tuple[str, str]] = [
    ('from "../shared/api/client"', 'from "../shared/auth/api"'),  # only for fetchMe - handled separately
]

# Files that import symbols - we'll do symbol-based fixes per file content
IMPORTS_BY_MODULE: dict[str, dict[str, list[str]]] = {
    "../shared/api/client": {
        "ApiError": [],
        "clearStoredToken": [],
        "getStoredToken": [],
        "setStoredToken": [],
        "apiRequest": [],
        "downloadAttachment": [],
        "apiErrorFromResponse": [],
    },
    "../shared/auth/api": {
        "fetchMe": [],
    },
    "../shared/auth/types": {
        "Role": [],
        "AuthenticatedPrincipal": [],
    },
    "../policy-documents/api": {
        "fetchPolicyDocuments": [],
        "fetchDocumentVersions": [],
        "uploadDocumentVersion": [],
        "deleteDocumentVersion": [],
        "downloadDocumentVersion": [],
        "fetchDocumentSections": [],
    },
    "../policy-documents/types": {
        "PolicyDocumentSummary": [],
        "PolicyDocumentListResponse": [],
        "DocumentVersion": [],
        "DocumentVersionListResponse": [],
        "DocumentSection": [],
        "DocumentSectionListResponse": [],
    },
    "../extraction-runs/api": {
        "fetchExtractionRuns": [],
        "fetchDocumentVersionExtractionRuns": [],
        "fetchPromptTemplates": [],
        "fetchModelConfigurations": [],
        "createExtractionRun": [],
    },
    "../extraction-runs/types": {
        "ExtractionRun": [],
        "ExtractionRunListResponse": [],
        "ExtractionRunFilters": [],
        "ExtractionRunStatus": [],
        "ExtractionRunCreateRequest": [],
        "ExtractionExecutionResult": [],
        "PromptTemplateSummary": [],
        "PromptTemplateListResponse": [],
        "ModelConfigurationSummary": [],
        "ModelConfigurationListResponse": [],
    },
    "../candidate-rules/api": {
        "fetchCandidateRules": [],
        "fetchCandidateRule": [],
        "updateCandidateRule": [],
        "approveCandidateRule": [],
        "approveCandidateRulesBulk": [],
        "rejectCandidateRule": [],
    },
    "../candidate-rules/types": {
        "CandidateRuleReview": [],
        "CandidateRuleReviewListResponse": [],
        "CandidateRuleFilters": [],
        "CandidateRuleReviewUpdateRequest": [],
        "CandidateRuleApprovalRequest": [],
        "CandidateRuleApprovalResponse": [],
        "BulkCandidateRuleApprovalRequest": [],
        "BulkCandidateRuleApprovalResponse": [],
        "CandidateRuleRejectionRequest": [],
        "CandidateRuleRejectionResponse": [],
    },
    "../policy-versions/api": {
        "fetchPolicyVersions": [],
        "fetchPolicyVersion": [],
        "publishPolicyVersion": [],
        "downloadPolicyVersionSnapshot": [],
    },
    "../policy-versions/types": {
        "PolicyVersionSummary": [],
        "PolicyVersionListResponse": [],
        "PolicyVersionPublishRequest": [],
        "PolicyVersionPublishResponse": [],
        "PolicyVersionSnapshot": [],
    },
    "../manual-rules/api": {
        "createManualRule": [],
    },
    "../reingestion/api": {
        "reingestDocument": [],
    },
    "../reingestion/types": {
        "ReingestionRequest": [],
        "ReingestionResult": [],
        "PolicyVersionDiff": [],
    },
    "../audit/api": {
        "fetchAuditEvents": [],
    },
    "../audit/types": {
        "AuditEvent": [],
        "AuditEventListResponse": [],
        "AuditEventFilters": [],
    },
    "../rules/types": {
        "Rule": [],
        "CandidateRuleValue": [],
        "LifecycleState": [],
        "EnforceabilityClass": [],
        "QAFlagCode": [],
        "ReingestionDiffCategory": [],
        "AggregationPeriod": [],
        "RuleOriginType": [],
        "RuleOrigin": [],
        "Citation": [],
        "Scope": [],
        "Applicability": [],
        "RuleException": [],
        "RuleCondition": [],
        "QAFlag": [],
        "ManualRuleCreateRequest": [],
    },
    "../rules/format": {
        "formatEnforceabilityClass": [],
        "formatLifecycleState": [],
    },
    "../shared/format/common": {
        "formatDateTime": [],
        "shortenId": [],
    },
    "../shared/permissions": {
        "hasAnyRole": [],
    },
    "../shared/theme": {
        "initTheme": [],
    },
}


def find_symbol_module(symbol: str) -> str | None:
    for module, symbols in IMPORTS_BY_MODULE.items():
        if symbol in symbols or symbol in module:
            pass
    for module, symbols in IMPORTS_BY_MODULE.items():
        if symbol in symbols:
            return module
    # hardcoded lookups
    lookup = {
        "ApiError": "../shared/api/client",
        "clearStoredToken": "../shared/api/client",
        "getStoredToken": "../shared/api/client",
        "setStoredToken": "../shared/api/client",
        "apiRequest": "../shared/api/client",
        "fetchMe": "../shared/auth/api",
        "Role": "../shared/auth/types",
        "AuthenticatedPrincipal": "../shared/auth/types",
        "fetchPolicyDocuments": "../policy-documents/api",
        "fetchDocumentVersions": "../policy-documents/api",
        "uploadDocumentVersion": "../policy-documents/api",
        "deleteDocumentVersion": "../policy-documents/api",
        "downloadDocumentVersion": "../policy-documents/api",
        "fetchDocumentSections": "../policy-documents/api",
        "PolicyDocumentSummary": "../policy-documents/types",
        "PolicyDocumentListResponse": "../policy-documents/types",
        "DocumentVersion": "../policy-documents/types",
        "DocumentVersionListResponse": "../policy-documents/types",
        "DocumentSection": "../policy-documents/types",
        "DocumentSectionListResponse": "../policy-documents/types",
        "fetchExtractionRuns": "../extraction-runs/api",
        "fetchDocumentVersionExtractionRuns": "../extraction-runs/api",
        "fetchPromptTemplates": "../extraction-runs/api",
        "fetchModelConfigurations": "../extraction-runs/api",
        "createExtractionRun": "../extraction-runs/api",
        "ExtractionRun": "../extraction-runs/types",
        "ExtractionRunListResponse": "../extraction-runs/types",
        "ExtractionRunFilters": "../extraction-runs/types",
        "ExtractionRunStatus": "../extraction-runs/types",
        "ExtractionRunCreateRequest": "../extraction-runs/types",
        "ExtractionExecutionResult": "../extraction-runs/types",
        "fetchCandidateRules": "../candidate-rules/api",
        "fetchCandidateRule": "../candidate-rules/api",
        "updateCandidateRule": "../candidate-rules/api",
        "approveCandidateRule": "../candidate-rules/api",
        "approveCandidateRulesBulk": "../candidate-rules/api",
        "rejectCandidateRule": "../candidate-rules/api",
        "CandidateRuleReview": "../candidate-rules/types",
        "CandidateRuleFilters": "../candidate-rules/types",
        "fetchPolicyVersions": "../policy-versions/api",
        "fetchPolicyVersion": "../policy-versions/api",
        "publishPolicyVersion": "../policy-versions/api",
        "downloadPolicyVersionSnapshot": "../policy-versions/api",
        "PolicyVersionSnapshot": "../policy-versions/types",
        "PolicyVersionSummary": "../policy-versions/types",
        "createManualRule": "../manual-rules/api",
        "reingestDocument": "../reingestion/api",
        "ReingestionResult": "../reingestion/types",
        "fetchAuditEvents": "../audit/api",
        "AuditEvent": "../audit/types",
        "Rule": "../rules/types",
        "LifecycleState": "../rules/types",
        "EnforceabilityClass": "../rules/types",
        "ReingestionDiffCategory": "../rules/types",
        "QAFlag": "../rules/types",
        "Citation": "../rules/types",
        "Scope": "../rules/types",
        "ManualRuleCreateRequest": "../rules/types",
        "formatEnforceabilityClass": "../rules/format",
        "formatLifecycleState": "../rules/format",
        "shortenId": "../shared/format/common",
        "formatDateTime": "../shared/format/common",
        "hasAnyRole": "../shared/permissions",
        "initTheme": "../shared/theme",
        "describeFetchError": "../policy-documents/format",
    }
    return lookup.get(symbol)


def relative_import(from_dir: Path, to_module: str) -> str:
    """Convert ../path module to relative from from_dir."""
    target = (from_dir / to_module).resolve()
    try:
        rel = target.relative_to(from_dir.resolve())
    except ValueError:
        return to_module
    parts = list(rel.parts)
    if parts[-1].endswith(".ts") or parts[-1].endswith(".tsx"):
        parts[-1] = parts[-1].rsplit(".", 1)[0]
    up = len(from_dir.relative_to(SRC).parts)
    prefix = "../" * up if up else "./"
    return prefix + "/".join(parts)


def fix_app_tsx() -> None:
    app = SRC / "app" / "App.tsx"
    text = app.read_text(encoding="utf-8")
    text = text.replace(
        """import {
\tApiError,
\tclearStoredToken,
\tfetchMe,
\tgetStoredToken,
\tsetStoredToken,
} from "../shared/api/client";""",
        """import {
\tApiError,
\tclearStoredToken,
\tgetStoredToken,
\tsetStoredToken,
} from "../shared/api/client";
import { fetchMe } from "../shared/auth/api";""",
    )
    app.write_text(text, encoding="utf-8")


def fix_domain_api_files() -> None:
    fixes = {
        SRC / "policy-documents/api.ts": [
            ('from "../shared/auth/types"', 'from "./types"'),
            ("export { getStoredToken };\n", ""),
        ],
        SRC / "shared/auth/api.ts": [
            ('from "../shared/auth/types"', 'from "./types"'),
            ('from "../shared/api/client"', 'from "../api/client"'),
        ],
    }
    for path, replacements in fixes.items():
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        for old, new in replacements:
            text = text.replace(old, new)
        path.write_text(text, encoding="utf-8")


def remove_legacy_files() -> None:
    for name in ("api.ts", "types.ts"):
        path = SRC / name
        if path.exists():
            path.unlink()
            print(f"removed {name}")


def fix_format_imports() -> None:
    """Fix common broken format file imports."""
    replacements = [
        ('from "../shared/api/client"', 'from "../shared/api/client"'),
        ('from "./format"', 'from "./format"'),
        ('from "../candidate-rules/format"', 'from "../candidate-rules/format"'),
        ('from "../rules/format"', 'from "../rules/format"'),
        ('from "../shared/format/common"', 'from "../shared/format/common"'),
        ('from "../extraction-runs/format"', 'from "../extraction-runs/format"'),
        ('from "../policy-documents/format"', 'from "../policy-documents/format"'),
        ('from "../policy-versions/format"', 'from "../policy-versions/format"'),
        ('from "../reingestion/format"', 'from "../reingestion/format"'),
        ('from "../audit/format"', 'from "../audit/format"'),
    ]
    for path in SRC.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        text = path.read_text(encoding="utf-8")
        original = text
        # Fix imports from old types path
        text = re.sub(
            r'from "\.\./shared/auth/types"',
            lambda m: m.group(0),
            text,
        )
        # Replace type imports that should come from rules
        if "policy-versions/format.ts" in str(path):
            text = text.replace(
                'from "../candidate-rules/format"',
                'from "../rules/format"',
            )
        if path.name == "format.ts" and "extraction-runs" in str(path):
            text = text.replace(
                'from "../shared/auth/types"',
                'from "./types"',
            )
        if text != original:
            path.write_text(text, encoding="utf-8")


def main() -> None:
    fix_app_tsx()
    fix_domain_api_files()
    remove_legacy_files()
    fix_format_imports()
    print("import fixes applied")


if __name__ == "__main__":
    main()
