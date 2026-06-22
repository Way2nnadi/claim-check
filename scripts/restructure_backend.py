#!/usr/bin/env python3
"""One-shot backend restructure: move modules and rewrite imports."""

from __future__ import annotations

import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "src" / "policy_pipeline"

MOVES: list[tuple[str, str]] = [
    ("config.py", "shared/config.py"),
    ("object_storage.py", "shared/object_storage.py"),
    ("identity.py", "auth/identity.py"),
    ("auth.py", "auth/auth.py"),
    ("document_parsing.py", "policy_documents/parsing.py"),
    ("document_citations.py", "policy_documents/citations.py"),
    ("upload_validation.py", "policy_documents/upload_validation.py"),
    ("document_versions.py", "policy_documents/service.py"),
    ("extraction_registry.py", "extraction/registry.py"),
    ("extraction_runs.py", "extraction/runs.py"),
    ("structured_extraction.py", "extraction/structured_output.py"),
    ("extraction_errors.py", "extraction/errors.py"),
    ("qa_retrieval.py", "extraction/qa_retrieval.py"),
    ("llm_clients.py", "extraction/llm_clients.py"),
    ("extraction_evaluation.py", "extraction/evaluation.py"),
    ("rules.py", "rules/models.py"),
    ("rule_store.py", "rules/store.py"),
    ("structured_policy_store.py", "policy_versions/store.py"),
    ("policy_version_diff.py", "policy_versions/diff.py"),
    ("reingestion.py", "reingestion/workflow.py"),
    ("audit.py", "audit/events.py"),
    ("routers/health.py", "shared/health/router.py"),
    ("routers/policy_documents.py", "policy_documents/router.py"),
    ("routers/extraction_runs.py", "extraction/router_runs.py"),
    ("routers/extraction_registry.py", "extraction/router_registry.py"),
    ("routers/candidate_rules.py", "rules/router_candidate.py"),
    ("routers/manual_rules.py", "rules/router_manual.py"),
    ("routers/policy_versions.py", "policy_versions/router.py"),
    ("routers/audit.py", "audit/router.py"),
]

IMPORT_REPLACEMENTS: list[tuple[str, str]] = [
    (r"from policy_pipeline\.config import", "from policy_pipeline.shared.config import"),
    (r"import policy_pipeline\.config", "import policy_pipeline.shared.config"),
    (r"from policy_pipeline\.database import", "from policy_pipeline.shared.database import"),
    (r"from policy_pipeline\.object_storage import", "from policy_pipeline.shared.object_storage import"),
    (r"from policy_pipeline\.identity import", "from policy_pipeline.auth.identity import"),
    (r"from policy_pipeline\.auth import", "from policy_pipeline.auth.auth import"),
    (r"from policy_pipeline\.document_parsing import", "from policy_pipeline.policy_documents.parsing import"),
    (r"from policy_pipeline\.document_citations import", "from policy_pipeline.policy_documents.citations import"),
    (r"from policy_pipeline\.upload_validation import", "from policy_pipeline.policy_documents.upload_validation import"),
    (r"from policy_pipeline\.document_versions import", "from policy_pipeline.policy_documents.service import"),
    (r"from policy_pipeline\.extraction_registry import", "from policy_pipeline.extraction.registry import"),
    (r"from policy_pipeline\.extraction_runs import", "from policy_pipeline.extraction.runs import"),
    (r"from policy_pipeline\.structured_extraction import", "from policy_pipeline.extraction.structured_output import"),
    (r"from policy_pipeline\.extraction_errors import", "from policy_pipeline.extraction.errors import"),
    (r"from policy_pipeline\.qa_retrieval import", "from policy_pipeline.extraction.qa_retrieval import"),
    (r"from policy_pipeline\.llm_clients import", "from policy_pipeline.extraction.llm_clients import"),
    (r"from policy_pipeline\.extraction_evaluation import", "from policy_pipeline.extraction.evaluation import"),
    (r"from policy_pipeline\.rule_store import", "from policy_pipeline.rules.store import"),
    (r"from policy_pipeline\.structured_policy_store import", "from policy_pipeline.policy_versions.store import"),
    (r"from policy_pipeline\.policy_version_diff import", "from policy_pipeline.policy_versions.diff import"),
    (r"from policy_pipeline\.reingestion import", "from policy_pipeline.reingestion.workflow import"),
    (r"from policy_pipeline\.audit import", "from policy_pipeline.audit.events import"),
    (r"from policy_pipeline\.routers import", "from policy_pipeline import"),
    (r"from policy_pipeline\.routers\.health import", "from policy_pipeline.shared.health.router import"),
    (r"from policy_pipeline\.routers\.policy_documents import", "from policy_pipeline.policy_documents.router import"),
    (r"from policy_pipeline\.routers\.extraction_runs import", "from policy_pipeline.extraction.router_runs import"),
    (r"from policy_pipeline\.routers\.extraction_registry import", "from policy_pipeline.extraction.router_registry import"),
    (r"from policy_pipeline\.routers\.candidate_rules import", "from policy_pipeline.rules.router_candidate import"),
    (r"from policy_pipeline\.routers\.manual_rules import", "from policy_pipeline.rules.router_manual import"),
    (r"from policy_pipeline\.routers\.policy_versions import", "from policy_pipeline.policy_versions.router import"),
    (r"from policy_pipeline\.routers\.audit import", "from policy_pipeline.audit.router import"),
    (r"from policy_pipeline\.rules import", "from policy_pipeline.rules.models import"),
]

PACKAGE_INITS = [
    "auth",
    "policy_documents",
    "extraction",
    "rules",
    "policy_versions",
    "reingestion",
    "audit",
    "shared/health",
]


def move_files() -> None:
    for src_rel, dst_rel in MOVES:
        src = PKG / src_rel
        dst = PKG / dst_rel
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


def write_inits() -> None:
    for rel in PACKAGE_INITS:
        init = PKG / rel / "__init__.py"
        if not init.exists():
            init.write_text('"""Policy Pipeline domain module."""\n', encoding="utf-8")


def rewrite_imports() -> None:
    targets = [
        ROOT / "src" / "policy_pipeline",
        ROOT / "tests",
        ROOT / "alembic",
    ]
    for base in targets:
        for path in base.rglob("*.py"):
            if path.name == "restructure_backend.py":
                continue
            text = path.read_text(encoding="utf-8")
            original = text
            for pattern, replacement in IMPORT_REPLACEMENTS:
                text = re.sub(pattern, replacement, text)
            if text != original:
                path.write_text(text, encoding="utf-8")
                print(f"updated imports: {path.relative_to(ROOT)}")


def remove_old_database() -> None:
    db = PKG / "database.py"
    if db.exists():
        db.unlink()
        print("removed database.py")


def remove_routers_dir() -> None:
    routers = PKG / "routers"
    if not routers.exists():
        return
    init = routers / "__init__.py"
    if init.exists():
        init.unlink()
    if not any(routers.iterdir()):
        routers.rmdir()
        print("removed routers/")


def main() -> None:
    move_files()
    write_inits()
    rewrite_imports()
    remove_old_database()
    remove_routers_dir()


if __name__ == "__main__":
    main()
