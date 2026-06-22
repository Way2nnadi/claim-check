from __future__ import annotations

from pydantic import BaseModel
from sqlalchemy.orm import Session

from policy_pipeline.extraction.runs import ExtractionExecutionResult, execute_extraction_run
from policy_pipeline.policy_documents.service import (
    DocumentVersion,
    create_document_version,
    get_document_version,
)
from policy_pipeline.policy_versions.diff import (
    PolicyVersionDiff,
    diff_candidate_rules_against_current_policy_version,
)
from policy_pipeline.policy_versions.store import get_latest_policy_version_snapshot
from policy_pipeline.rules.models import ReingestionDiffCategory
from policy_pipeline.rules.store import (
    clear_reingestion_diff_categories,
    set_reingestion_diff_category,
)
from policy_pipeline.shared.object_storage import get_object_storage


class ReingestionResult(BaseModel):
    document_version: DocumentVersion
    extraction_run: ExtractionExecutionResult
    diff: PolicyVersionDiff


def reingest_document(
    session: Session,
    *,
    document_id: str,
    filename: str,
    content_type: str,
    document_bytes: bytes,
    extraction_run_id: str,
    prompt_template_id: str,
    prompt_template_version: str,
    model_configuration_id: str,
    model_configuration_version: str,
) -> ReingestionResult:
    document_version = create_document_version(
        session,
        document_id=document_id,
        filename=filename,
        content_type=content_type,
        document_bytes=document_bytes,
        commit=False,
    )
    document_version_record = get_document_version(
        session,
        document_id=document_id,
        document_version_id=document_version.document_version_id,
    )
    storage_key = (
        document_version_record.storage_key if document_version_record is not None else None
    )
    try:
        extraction_run = execute_extraction_run(
            session,
            extraction_run_id=extraction_run_id,
            document_id=document_id,
            document_version_id=document_version.document_version_id,
            prompt_template_id=prompt_template_id,
            prompt_template_version=prompt_template_version,
            model_configuration_id=model_configuration_id,
            model_configuration_version=model_configuration_version,
        )
        current_policy_version = get_latest_policy_version_snapshot(session)
        diff = diff_candidate_rules_against_current_policy_version(
            document_id=document_id,
            candidate_rules=extraction_run.candidate_rules,
            current_policy_version=current_policy_version,
        )
        _apply_reingestion_diff_categories(
            session,
            document_id=document_id,
            diff=diff,
        )
    except Exception:
        session.rollback()
        if storage_key is not None:
            get_object_storage().delete_bytes(key=storage_key)
        raise
    return ReingestionResult(
        document_version=document_version,
        extraction_run=extraction_run,
        diff=diff,
    )


def _apply_reingestion_diff_categories(
    session: Session,
    *,
    document_id: str,
    diff: PolicyVersionDiff,
) -> None:
    clear_reingestion_diff_categories(session, document_id=document_id)

    for candidate_rule in diff.added:
        set_reingestion_diff_category(
            session,
            candidate_rule_id=candidate_rule.rule_id,
            category=ReingestionDiffCategory.ADDED,
        )
    for changed_rule in diff.changed:
        set_reingestion_diff_category(
            session,
            candidate_rule_id=changed_rule.candidate_rule.rule_id,
            category=ReingestionDiffCategory.CHANGED,
        )
    for removed_rule in diff.removed:
        set_reingestion_diff_category(
            session,
            candidate_rule_id=removed_rule.current_rule.rule_id,
            category=ReingestionDiffCategory.REMOVED,
        )
    for unchanged_rule in diff.unchanged:
        set_reingestion_diff_category(
            session,
            candidate_rule_id=unchanged_rule.candidate_rule.rule_id,
            category=ReingestionDiffCategory.UNCHANGED,
        )
