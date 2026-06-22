from __future__ import annotations

from collections.abc import Sequence

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from policy_pipeline.extraction.qa_retrieval import (
    SECTION_EMBEDDING_DIMENSION,
    store_section_embeddings,
)
from policy_pipeline.extraction.registry import ExtractionRun
from policy_pipeline.extraction.runs import (
    _attach_qa_flags,
    _materialize_candidate_rules,
)
from policy_pipeline.policy_documents.parsing import PDF_CONTENT_TYPE
from policy_pipeline.policy_documents.service import create_document_version
from policy_pipeline.rules.models import (
    LifecycleState,
    RuleOriginType,
)
from policy_pipeline.shared.database import Base
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


def test_materialize_rejects_invalid_enforceability_condition_pairing(
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

    extraction_run = ExtractionRun(
        extraction_run_id="extract-stage-invalid-pairing",
        document_version_id="docv-stage",
        prompt_template_id="rule-extraction",
        prompt_template_version="v1",
        model_configuration_id="fake-openai",
        model_configuration_version="v1",
    )
    structured_output = {
        "candidate_rules": [
            {
                "statement": "Meals should be reasonable.",
                "enforceability_class": "guidance",
                "scope": {"expense_category": "meals"},
                "citation_quote": "Meals should be reasonable.",
                "condition": {
                    "field": "meal.amount",
                    "operator": "<=",
                    "value": "75",
                },
            }
        ]
    }

    with Session(engine) as session:
        document_version = create_document_version(
            session,
            document_id="expense-policy",
            filename="expense-policy.pdf",
            content_type=PDF_CONTENT_TYPE,
            document_bytes=_make_pdf_bytes(
                [
                    ("Meals", 18),
                    ("Meals should be reasonable.", 12),
                ]
            ),
        )

        with pytest.raises(ValidationError, match="must not include a machine-checkable condition"):
            _materialize_candidate_rules(
                structured_output=structured_output,
                extraction_run=extraction_run,
                document_id="expense-policy",
                document_version_id=document_version.document_version_id,
                session=session,
            )

    engine.dispose()


def test_materialize_surfaces_unresolvable_citation_qa_flag(
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

    extraction_run = ExtractionRun(
        extraction_run_id="extract-stage-citation-failure",
        document_version_id="docv-stage",
        prompt_template_id="rule-extraction",
        prompt_template_version="v1",
        model_configuration_id="fake-openai",
        model_configuration_version="v1",
    )
    missing_quote = "This quote does not appear anywhere in the document."
    structured_output = {
        "candidate_rules": [
            {
                "statement": "Lodging arrangements should reflect company values.",
                "enforceability_class": "subjective",
                "scope": {"expense_category": "lodging"},
                "citation_quote": missing_quote,
            }
        ]
    }

    with Session(engine) as session:
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

        candidate_rules = _materialize_candidate_rules(
            structured_output=structured_output,
            extraction_run=extraction_run,
            document_id="expense-policy",
            document_version_id=document_version.document_version_id,
            session=session,
        )

    engine.dispose()

    assert len(candidate_rules) == 1
    rule = candidate_rules[0]
    assert rule.citation is None
    assert [flag.model_dump(mode="json") for flag in rule.qa_flags] == [
        {
            "code": "unresolvable_citation",
            "detail": (
                "Candidate Rule Citation quote could not be resolved: "
                f"{missing_quote!r}."
            ),
        }
    ]


def test_attach_qa_flags_with_fake_embedding_client(
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

    extraction_run = ExtractionRun(
        extraction_run_id="extract-stage-qa-flags",
        document_version_id="docv-stage",
        prompt_template_id="rule-extraction",
        prompt_template_version="v1",
        model_configuration_id="fake-openai",
        model_configuration_version="v1",
    )
    structured_output = {
        "candidate_rules": [
            {
                "statement": "Meals are capped at $75 per day.",
                "enforceability_class": "enforceable",
                "scope": {"expense_category": "meals"},
                "citation_quote": "Domestic meals are capped at $75 per day.",
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
            },
            {
                "statement": "Domestic meals are capped at $75 per day.",
                "enforceability_class": "enforceable",
                "scope": {
                    "expense_category": "meals",
                    "country": "domestic",
                },
                "citation_quote": "Domestic meals are capped at $75 per day.",
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
            },
            {
                "statement": "International meals are capped at $100 per day.",
                "enforceability_class": "enforceable",
                "scope": {
                    "expense_category": "meals",
                    "country": "international",
                },
                "citation_quote": "International meals are capped at $100 per day.",
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
            },
            {
                "statement": "Domestic meals are capped at $90 per day.",
                "enforceability_class": "enforceable",
                "scope": {
                    "expense_category": "meals",
                    "country": "domestic",
                },
                "citation_quote": "Domestic meals are capped at $90 per day.",
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
            },
            {
                "statement": "VIP dinners require CFO approval.",
                "enforceability_class": "guidance",
                "scope": {"expense_category": "meals"},
                "citation_quote": "VIP dinners require CFO approval.",
            },
        ]
    }

    embedding_client = FakeEmbeddingClient(
        embeddings_by_text={
            "Meals\nDomestic meals are capped at $75 per day.": _embedding(1.0, 0.0),
            "International Meals\nInternational meals are capped at $100 per day.": (
                _embedding(0.96, 0.04)
            ),
            "Domestic Override\nDomestic meals are capped at $90 per day.": _embedding(
                0.98, 0.02
            ),
            "Approvals\nVIP dinners require CFO approval.": _embedding(0.0, 1.0),
            "Meals are capped at $75 per day.": _embedding(1.0, 0.0),
            "Domestic meals are capped at $75 per day.": _embedding(1.0, 0.0),
            "International meals are capped at $100 per day.": _embedding(0.96, 0.04),
            "Domestic meals are capped at $90 per day.": _embedding(0.98, 0.02),
            "VIP dinners require CFO approval.": _embedding(0.0, 1.0),
        }
    )

    with Session(engine) as session:
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
        store_section_embeddings(
            session,
            document_id="expense-policy",
            document_version_id=document_version.document_version_id,
            embedding_client=embedding_client,
        )

        candidate_rules = _materialize_candidate_rules(
            structured_output=structured_output,
            extraction_run=extraction_run,
            document_id="expense-policy",
            document_version_id=document_version.document_version_id,
            session=session,
        )
        _attach_qa_flags(
            session,
            candidate_rules=candidate_rules,
            document_id="expense-policy",
            document_version_id=document_version.document_version_id,
            embedding_client=embedding_client,
        )

    engine.dispose()

    assert all(rule.lifecycle_state is LifecycleState.EXTRACTED for rule in candidate_rules)
    assert all(rule.origin.source_type is RuleOriginType.EXTRACTED for rule in candidate_rules)
    assert [flag.model_dump(mode="json") for flag in candidate_rules[0].qa_flags] == [
        {
            "code": "ambiguous_scope",
            "detail": (
                "Candidate Rule scope is ambiguous for country; related Rules span "
                "domestic, international."
            ),
        }
    ]
    assert [flag.model_dump(mode="json") for flag in candidate_rules[3].qa_flags] == [
        {
            "code": "possible_contradiction",
            "detail": (
                "Candidate Rule may contradict related Rule "
                "'extract-stage-qa-flags:2' on meal.amount."
            ),
        }
    ]
    assert [flag.model_dump(mode="json") for flag in candidate_rules[4].qa_flags] == [
        {
            "code": "undefined_term",
            "detail": "Candidate Rule uses undefined term 'VIP' in retrieved sections.",
        }
    ]
