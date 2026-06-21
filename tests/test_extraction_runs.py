from __future__ import annotations

from collections.abc import Sequence

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from policy_pipeline.config import Settings
from policy_pipeline.database import Base, ExtractionRunRecord
from policy_pipeline.documents import PDF_CONTENT_TYPE, create_document_version
from policy_pipeline.extraction_registry import save_model_configuration, save_prompt_template
from policy_pipeline.extraction_runs import execute_extraction_run
from policy_pipeline.llm_clients import HostedEndpointDisabledError
from policy_pipeline.qa_retrieval import SECTION_EMBEDDING_DIMENSION
from tests.test_document_sections import _make_pdf_bytes


class FakeEmbeddingClient:
    def __init__(self, *, embeddings_by_text: dict[str, list[float]]) -> None:
        self._embeddings_by_text = embeddings_by_text

    def embed_texts(self, *, texts: Sequence[str]) -> list[list[float]]:
        return [self._embeddings_by_text[text] for text in texts]


def _embedding(*components: float) -> list[float]:
    if len(components) > SECTION_EMBEDDING_DIMENSION:
        raise ValueError("Test embedding fixture exceeds section embedding dimensions.")
    return [*components, *([0.0] * (SECTION_EMBEDDING_DIMENSION - len(components)))]


def test_execute_extraction_run_does_not_persist_when_hosted_endpoint_is_disabled(
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
        save_prompt_template(
            session,
            prompt_template_id="rule-extraction",
            version="v1",
            template="Extract candidate Rules from the Policy Document.",
        )
        save_model_configuration(
            session,
            model_configuration_id="openai-primary",
            version="v1",
            model="gpt-5-mini",
            endpoint="https://api.openai.com/v1/chat/completions",
            settings={},
        )
        document_version = create_document_version(
            session,
            document_id="expense-policy",
            filename="expense-policy.pdf",
            content_type=PDF_CONTENT_TYPE,
            document_bytes=_make_pdf_bytes(
                [
                    ("Travel Policy", 18),
                    ("Meals are capped at $75 per day.", 12),
                ]
            ),
        )

        with pytest.raises(HostedEndpointDisabledError):
            execute_extraction_run(
                session,
                extraction_run_id="extract-expense-policy-v1",
                document_id="expense-policy",
                document_version_id=document_version.document_version_id,
                prompt_template_id="rule-extraction",
                prompt_template_version="v1",
                model_configuration_id="openai-primary",
                model_configuration_version="v1",
                settings=Settings(llm_hosted_endpoints_enabled=False),
            )

        session.commit()

    with Session(engine) as session:
        assert session.get(ExtractionRunRecord, "extract-expense-policy-v1") is None

    engine.dispose()


def test_execute_extraction_run_attaches_retrieval_assisted_qa_flags(
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
        save_prompt_template(
            session,
            prompt_template_id="rule-extraction",
            version="v1",
            template="Extract candidate Rules from the Policy Document.",
        )
        save_model_configuration(
            session,
            model_configuration_id="fake-openai",
            version="v1",
            model="gpt-5-mini",
            endpoint="https://fake-openai.local/v1/chat/completions",
            settings={
                "fake_structured_outputs": [
                    {
                        "candidate_rules": [
                            {
                                "statement": "Meals are capped at $75 per day.",
                                "enforceability_class": "enforceable",
                                "scope": {
                                    "expense_category": "meals",
                                },
                                "condition": {
                                    "field": "meal.amount",
                                    "operator": "<=",
                                    "value": "75",
                                },
                                "applicability": {
                                    "aggregation_period": "per_day",
                                    "unit": "money",
                                    "currency": "USD",
                                },
                                "citation_quote": "Domestic meals are capped at $75 per day.",
                            },
                            {
                                "statement": "Domestic meals are capped at $75 per day.",
                                "enforceability_class": "enforceable",
                                "scope": {
                                    "expense_category": "meals",
                                    "country": "domestic",
                                },
                                "condition": {
                                    "field": "meal.amount",
                                    "operator": "<=",
                                    "value": "75",
                                },
                                "applicability": {
                                    "aggregation_period": "per_day",
                                    "unit": "money",
                                    "currency": "USD",
                                },
                                "citation_quote": "Domestic meals are capped at $75 per day.",
                            },
                            {
                                "statement": "International meals are capped at $100 per day.",
                                "enforceability_class": "enforceable",
                                "scope": {
                                    "expense_category": "meals",
                                    "country": "international",
                                },
                                "condition": {
                                    "field": "meal.amount",
                                    "operator": "<=",
                                    "value": "100",
                                },
                                "applicability": {
                                    "aggregation_period": "per_day",
                                    "unit": "money",
                                    "currency": "USD",
                                },
                                "citation_quote": (
                                    "International meals are capped at $100 per day."
                                ),
                            },
                            {
                                "statement": "Domestic meals are capped at $90 per day.",
                                "enforceability_class": "enforceable",
                                "scope": {
                                    "expense_category": "meals",
                                    "country": "domestic",
                                },
                                "condition": {
                                    "field": "meal.amount",
                                    "operator": "<=",
                                    "value": "90",
                                },
                                "applicability": {
                                    "aggregation_period": "per_day",
                                    "unit": "money",
                                    "currency": "USD",
                                },
                                "citation_quote": "Domestic meals are capped at $90 per day.",
                            },
                            {
                                "statement": "VIP dinners require CFO approval.",
                                "enforceability_class": "guidance",
                                "scope": {
                                    "expense_category": "meals",
                                },
                                "citation_quote": "VIP dinners require CFO approval.",
                            },
                        ]
                    }
                ],
            },
        )
        document_version = create_document_version(
            session,
            document_id="expense-policy",
            filename="expense-policy.pdf",
            content_type=PDF_CONTENT_TYPE,
            document_bytes=_make_pdf_bytes(
                [
                    ("Meals", 18),
                    ("Domestic meals are capped at $75 per day.", 12),
                    ("International Meals", 18),
                    ("International meals are capped at $100 per day.", 12),
                    ("Domestic Override", 18),
                    ("Domestic meals are capped at $90 per day.", 12),
                    ("Approvals", 18),
                    ("VIP dinners require CFO approval.", 12),
                ]
            ),
        )

        result = execute_extraction_run(
            session,
            extraction_run_id="extract-expense-policy-v2",
            document_id="expense-policy",
            document_version_id=document_version.document_version_id,
            prompt_template_id="rule-extraction",
            prompt_template_version="v1",
            model_configuration_id="fake-openai",
            model_configuration_version="v1",
            embedding_client=FakeEmbeddingClient(
                embeddings_by_text={
                    "Meals\nDomestic meals are capped at $75 per day.": _embedding(1.0, 0.0),
                    "International Meals\nInternational meals are capped at $100 per day.": (
                        _embedding(0.96, 0.04)
                    ),
                    "Domestic Override\nDomestic meals are capped at $90 per day.": (
                        _embedding(0.98, 0.02)
                    ),
                    "Approvals\nVIP dinners require CFO approval.": _embedding(0.0, 1.0),
                    "Meals are capped at $75 per day.": _embedding(1.0, 0.0),
                    "Domestic meals are capped at $75 per day.": _embedding(1.0, 0.0),
                    "International meals are capped at $100 per day.": _embedding(0.96, 0.04),
                    "Domestic meals are capped at $90 per day.": _embedding(0.98, 0.02),
                    "VIP dinners require CFO approval.": _embedding(0.0, 1.0),
                }
            ),
        )

    engine.dispose()

    assert [flag.model_dump(mode="json") for flag in result.candidate_rules[0].qa_flags] == [
        {
            "code": "ambiguous_scope",
            "detail": (
                "Candidate Rule scope is ambiguous for country; related Rules span "
                "domestic, international."
            ),
        }
    ]
    assert [flag.model_dump(mode="json") for flag in result.candidate_rules[3].qa_flags] == [
        {
            "code": "possible_contradiction",
            "detail": (
                "Candidate Rule may contradict related Rule "
                "'extract-expense-policy-v2:2' on meal.amount."
            ),
        }
    ]
    assert [flag.model_dump(mode="json") for flag in result.candidate_rules[4].qa_flags] == [
        {
            "code": "undefined_term",
            "detail": "Candidate Rule uses undefined term 'VIP' in retrieved sections.",
        }
    ]
