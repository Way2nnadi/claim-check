#!/usr/bin/env python3
"""One-shot frontend restructure: create domain folders and rewrite imports."""

from __future__ import annotations

import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "client" / "src"

FILE_MOVES: list[tuple[str, str]] = [
    ("App.tsx", "app/App.tsx"),
    ("main.tsx", "app/main.tsx"),
    ("styles.css", "app/styles.css"),
    ("theme.ts", "shared/theme.ts"),
    ("permissions.ts", "shared/permissions.ts"),
    ("SearchablePicker.tsx", "shared/ui/SearchablePicker.tsx"),
    ("MissionDrawerHead.tsx", "shared/ui/MissionDrawerHead.tsx"),
    ("ThemeToggle.tsx", "shared/ui/ThemeToggle.tsx"),
    ("useAsyncResource.ts", "shared/ui/useAsyncResource.ts"),
    ("useAsyncResource.test.ts", "shared/ui/useAsyncResource.test.ts"),
    ("test/setup.ts", "shared/test/setup.ts"),
    ("DocumentCatalog.tsx", "policy-documents/DocumentCatalog.tsx"),
    ("DocumentCatalog.test.tsx", "policy-documents/DocumentCatalog.test.tsx"),
    ("DocumentDetail.tsx", "policy-documents/DocumentDetail.tsx"),
    ("DocumentDetail.test.tsx", "policy-documents/DocumentDetail.test.tsx"),
    ("DocumentDetail.extraction.test.tsx", "policy-documents/DocumentDetail.extraction.test.tsx"),
    ("DocumentDetail.reingestion.test.tsx", "policy-documents/DocumentDetail.reingestion.test.tsx"),
    ("DocumentDetail.trigger.test.tsx", "policy-documents/DocumentDetail.trigger.test.tsx"),
    ("RegisterDocumentDrawer.tsx", "policy-documents/RegisterDocumentDrawer.tsx"),
    ("NewDocumentVersionDrawer.tsx", "policy-documents/NewDocumentVersionDrawer.tsx"),
    ("DocumentFilterPicker.tsx", "policy-documents/DocumentFilterPicker.tsx"),
    ("documentFormat.ts", "policy-documents/format.ts"),
    ("documentUpload.ts", "policy-documents/upload.ts"),
    ("documentUpload.test.ts", "policy-documents/upload.test.ts"),
    ("VersionExtractionRuns.tsx", "policy-documents/VersionExtractionRuns.tsx"),
    ("ExtractionRunCatalog.tsx", "extraction-runs/ExtractionRunCatalog.tsx"),
    ("ExtractionRunCatalog.test.tsx", "extraction-runs/ExtractionRunCatalog.test.tsx"),
    ("ExtractionRunLedger.tsx", "extraction-runs/ExtractionRunLedger.tsx"),
    ("TriggerExtractionRun.tsx", "extraction-runs/TriggerExtractionRun.tsx"),
    ("TriggerExtractionRun.test.tsx", "extraction-runs/TriggerExtractionRun.test.tsx"),
    ("RegistryPicker.tsx", "extraction-runs/RegistryPicker.tsx"),
    ("extractionRunFormat.ts", "extraction-runs/format.ts"),
    ("ruleDraft.ts", "rules/ruleDraft.ts"),
    ("ruleDraft.test.ts", "rules/ruleDraft.test.ts"),
    ("RuleFormFields.tsx", "rules/RuleFormFields.tsx"),
    ("CandidateRuleCatalog.tsx", "candidate-rules/CandidateRuleCatalog.tsx"),
    ("CandidateRuleCatalog.test.tsx", "candidate-rules/CandidateRuleCatalog.test.tsx"),
    ("CandidateRuleDetail.tsx", "candidate-rules/CandidateRuleDetail.tsx"),
    ("CandidateRuleDetail.test.tsx", "candidate-rules/CandidateRuleDetail.test.tsx"),
    ("CandidateRuleLedger.tsx", "candidate-rules/CandidateRuleLedger.tsx"),
    ("CandidateRuleLedger.test.tsx", "candidate-rules/CandidateRuleLedger.test.tsx"),
    ("CandidateRuleDecisionModal.tsx", "candidate-rules/CandidateRuleDecisionModal.tsx"),
    ("candidateRuleFormat.ts", "candidate-rules/format.ts"),
    ("candidateRuleDecisions.ts", "candidate-rules/decisions.ts"),
    ("reviewQueueFilters.ts", "candidate-rules/reviewQueueFilters.ts"),
    ("SectionBrowserDrawer.tsx", "candidate-rules/SectionBrowserDrawer.tsx"),
    ("PolicyVersionCatalog.tsx", "policy-versions/PolicyVersionCatalog.tsx"),
    ("PolicyVersionCatalog.test.tsx", "policy-versions/PolicyVersionCatalog.test.tsx"),
    ("PublishPolicyVersionDrawer.tsx", "policy-versions/PublishPolicyVersionDrawer.tsx"),
    ("policyVersionFormat.ts", "policy-versions/format.ts"),
    ("ManualRulesPage.tsx", "manual-rules/ManualRulesPage.tsx"),
    ("ManualRulesPage.test.tsx", "manual-rules/ManualRulesPage.test.tsx"),
    ("ReingestionDrawer.tsx", "reingestion/ReingestionDrawer.tsx"),
    ("ReingestionWizard.tsx", "reingestion/ReingestionWizard.tsx"),
    ("ReingestionWizard.test.tsx", "reingestion/ReingestionWizard.test.tsx"),
    ("reingestionFormat.ts", "reingestion/format.ts"),
    ("AuditLogPage.tsx", "audit/AuditLogPage.tsx"),
    ("auditFormat.ts", "audit/format.ts"),
    ("DashboardPage.tsx", "dashboard/DashboardPage.tsx"),
    ("App.test.tsx", "app/App.test.tsx"),
    ("api.test.ts", "shared/api/client.test.ts"),
]

IMPORT_REPLACEMENTS: list[tuple[str, str]] = [
    (r'from "\./api"', 'from "../shared/api/client"'),
    (r'from "\./types"', 'from "../shared/auth/types"'),
    (r'from "\./theme"', 'from "../shared/theme"'),
    (r'from "\./permissions"', 'from "../shared/permissions"'),
    (r'from "\./useAsyncResource"', 'from "../shared/ui/useAsyncResource"'),
    (r'from "\./SearchablePicker"', 'from "../shared/ui/SearchablePicker"'),
    (r'from "\./MissionDrawerHead"', 'from "../shared/ui/MissionDrawerHead"'),
    (r'from "\./ThemeToggle"', 'from "../shared/ui/ThemeToggle"'),
    (r'from "\./DocumentCatalog"', 'from "../policy-documents/DocumentCatalog"'),
    (r'from "\./DocumentDetail"', 'from "../policy-documents/DocumentDetail"'),
    (r'from "\./RegisterDocumentDrawer"', 'from "../policy-documents/RegisterDocumentDrawer"'),
    (r'from "\./NewDocumentVersionDrawer"', 'from "../policy-documents/NewDocumentVersionDrawer"'),
    (r'from "\./DocumentFilterPicker"', 'from "../policy-documents/DocumentFilterPicker"'),
    (r'from "\./documentFormat"', 'from "../policy-documents/format"'),
    (r'from "\./documentUpload"', 'from "../policy-documents/upload"'),
    (r'from "\./VersionExtractionRuns"', 'from "../policy-documents/VersionExtractionRuns"'),
    (r'from "\./ExtractionRunCatalog"', 'from "../extraction-runs/ExtractionRunCatalog"'),
    (r'from "\./ExtractionRunLedger"', 'from "../extraction-runs/ExtractionRunLedger"'),
    (r'from "\./TriggerExtractionRun"', 'from "../extraction-runs/TriggerExtractionRun"'),
    (r'from "\./RegistryPicker"', 'from "../extraction-runs/RegistryPicker"'),
    (r'from "\./extractionRunFormat"', 'from "../extraction-runs/format"'),
    (r'from "\./ruleDraft"', 'from "../rules/ruleDraft"'),
    (r'from "\./RuleFormFields"', 'from "../rules/RuleFormFields"'),
    (r'from "\./CandidateRuleCatalog"', 'from "../candidate-rules/CandidateRuleCatalog"'),
    (r'from "\./CandidateRuleDetail"', 'from "../candidate-rules/CandidateRuleDetail"'),
    (r'from "\./CandidateRuleLedger"', 'from "../candidate-rules/CandidateRuleLedger"'),
    (r'from "\./CandidateRuleDecisionModal"', 'from "../candidate-rules/CandidateRuleDecisionModal"'),
    (r'from "\./candidateRuleFormat"', 'from "../candidate-rules/format"'),
    (r'from "\./candidateRuleDecisions"', 'from "../candidate-rules/decisions"'),
    (r'from "\./reviewQueueFilters"', 'from "../candidate-rules/reviewQueueFilters"'),
    (r'from "\./SectionBrowserDrawer"', 'from "../candidate-rules/SectionBrowserDrawer"'),
    (r'from "\./PolicyVersionCatalog"', 'from "../policy-versions/PolicyVersionCatalog"'),
    (r'from "\./PublishPolicyVersionDrawer"', 'from "../policy-versions/PublishPolicyVersionDrawer"'),
    (r'from "\./policyVersionFormat"', 'from "../policy-versions/format"'),
    (r'from "\./ManualRulesPage"', 'from "../manual-rules/ManualRulesPage"'),
    (r'from "\./ReingestionDrawer"', 'from "../reingestion/ReingestionDrawer"'),
    (r'from "\./ReingestionWizard"', 'from "../reingestion/ReingestionWizard"'),
    (r'from "\./reingestionFormat"', 'from "../reingestion/format"'),
    (r'from "\./AuditLogPage"', 'from "../audit/AuditLogPage"'),
    (r'from "\./auditFormat"', 'from "../audit/format"'),
    (r'from "\./DashboardPage"', 'from "../dashboard/DashboardPage"'),
    (r'from "\./App"', 'from "./App"'),
    (r'from "\./styles\.css"', 'from "./styles.css"'),
    (r'import "\./styles\.css"', 'import "./styles.css"'),
    (r'import "\./App"', 'import App from "./App"'),
]

DOMAIN_IMPORT_REPLACEMENTS: list[tuple[str, str]] = [
    (r'from "\.\./\.\./api"', 'from "../../shared/api/client"'),
    (r'from "\.\./api"', 'from "../shared/api/client"'),
    (r'from "\.\./\.\./types"', 'from "../../shared/auth/types"'),
    (r'from "\.\./types"', 'from "../shared/auth/types"'),
]


def move_files() -> None:
    for src_rel, dst_rel in FILE_MOVES:
        src = SRC / src_rel
        dst = SRC / dst_rel
        if not src.exists():
            if dst.exists():
                continue
            print(f"skip missing: {src_rel}")
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists():
            print(f"skip exists: {dst_rel}")
            continue
        shutil.move(str(src), str(dst))
        print(f"moved {src_rel} -> {dst_rel}")


def rewrite_file_imports(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    original = text
    depth = len(path.relative_to(SRC).parts) - 1
    prefix = "../" * depth if depth else "./"

    replacements = list(IMPORT_REPLACEMENTS)
    if depth > 0:
        replacements.extend(DOMAIN_IMPORT_REPLACEMENTS)

    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text)

    if text != original:
        path.write_text(text, encoding="utf-8")
        print(f"updated: {path.relative_to(ROOT)}")


def rewrite_all_imports() -> None:
    for path in SRC.rglob("*"):
        if path.suffix in {".ts", ".tsx"} and path.name != "restructure_frontend.py":
            rewrite_file_imports(path)


def update_index_html() -> None:
    index = ROOT / "client" / "index.html"
    if index.exists():
        text = index.read_text(encoding="utf-8")
        if 'src="/src/main.tsx"' in text:
            index.write_text(text.replace('src="/src/main.tsx"', 'src="/src/app/main.tsx"'), encoding="utf-8")


def update_vite_config() -> None:
    vite = ROOT / "client" / "vite.config.ts"
    text = vite.read_text(encoding="utf-8")
    text = text.replace('setupFiles: "./src/test/setup.ts"', 'setupFiles: "./src/shared/test/setup.ts"')
    vite.write_text(text, encoding="utf-8")


def main() -> None:
    move_files()
    rewrite_all_imports()
    update_index_html()
    update_vite_config()


if __name__ == "__main__":
    main()
