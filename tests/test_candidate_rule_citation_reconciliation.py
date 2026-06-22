from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from policy_pipeline.extraction.registry import create_extraction_run
from policy_pipeline.extraction.registry import save_model_configuration, save_prompt_template
from policy_pipeline.policy_documents.parsing import PDF_CONTENT_TYPE
from policy_pipeline.policy_documents.service import create_document_version
from policy_pipeline.rules.models import (
    Applicability,
    CandidateRule,
    EnforceabilityClass,
    LifecycleState,
    QAFlag,
    QAFlagCode,
    RuleCondition,
    RuleOrigin,
    RuleOriginType,
    Scope,
)
from policy_pipeline.rules.store import create_rule, update_candidate_rule_review
from policy_pipeline.shared.database import Base
from tests.test_document_sections import _make_pdf_bytes


def _seed_document_and_extraction_run(session: Session) -> str:
    document_version = create_document_version(
        session,
        document_id="expense-policy",
        filename="expense-policy.pdf",
        content_type=PDF_CONTENT_TYPE,
        document_bytes=_make_pdf_bytes(
            [
                ("Meals", 18),
                ("Meals are capped at $75 per day.", 12),
            ]
        ),
    )
    save_prompt_template(
        session,
        prompt_template_id="rule-extraction",
        version="v1",
        template="Extract candidate Rules.",
        description="Test prompt.",
    )
    save_model_configuration(
        session,
        model_configuration_id="openai-primary",
        version="v1",
        model="gpt-5-mini",
        endpoint="https://llm.internal/v1/chat/completions",
        settings={"temperature": 0},
    )
    create_extraction_run(
        session,
        extraction_run_id="extract-expense-policy-v1",
        document_version_id=document_version.document_version_id,
        prompt_template_id="rule-extraction",
        prompt_template_version="v1",
        model_configuration_id="openai-primary",
        model_configuration_version="v1",
    )
    return document_version.document_version_id


def test_save_reanchors_citation_and_clears_unresolvable_flag(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "policy-pipeline.db"
    object_storage_root = tmp_path / "object-storage"
    database_url = f"sqlite+pysqlite:///{database_path}"
    monkeypatch.setenv("POLICY_PIPELINE_DATABASE_URL", database_url)
    monkeypatch.setenv("POLICY_PIPELINE_OBJECT_STORAGE_ROOT", str(object_storage_root))

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        _seed_document_and_extraction_run(session)
        create_rule(
            session,
            rule=CandidateRule(
                rule_id="rule-meals-cap",
                statement="Meals are capped at $75 per day.",
                enforceability_class=EnforceabilityClass.ENFORCEABLE,
                lifecycle_state=LifecycleState.EXTRACTED,
                origin=RuleOrigin(
                    source_type=RuleOriginType.EXTRACTED,
                    extraction_run_id="extract-expense-policy-v1",
                ),
                scope=Scope(expense_category="meals"),
                citation=None,
                condition=RuleCondition(
                    field="meal.amount",
                    operator="<=",
                    value="75",
                ),
                applicability=Applicability(
                    aggregation_period="per_day",
                    unit="money",
                    currency="USD",
                    limit_basis="per employee",
                ),
                qa_flags=[
                    QAFlag(
                        code=QAFlagCode.UNRESOLVABLE_CITATION,
                        detail=(
                            "Candidate Rule Citation quote could not be resolved: "
                            "'Meals are capped at $75 per day.'."
                        ),
                    )
                ],
            ),
        )

        review = update_candidate_rule_review(
            session,
            candidate_rule_id="rule-meals-cap",
            updates={"statement": "Meals are capped at $75 per day."},
        )

    engine.dispose()

    assert review.current_rule.citation is not None
    assert review.current_rule.citation.quote == "Meals are capped at $75 per day."
    assert review.qa_flags == []
