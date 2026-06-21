from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from policy_pipeline.database import Base
from policy_pipeline.documents import (
    PDF_CONTENT_TYPE,
    create_document_version,
    list_document_sections,
)
from policy_pipeline.qa_retrieval import retrieve_candidate_rule_context, store_section_embeddings
from policy_pipeline.rules import (
    CandidateRule,
    Citation,
    EnforceabilityClass,
    LifecycleState,
    RuleCondition,
    RuleOrigin,
    RuleOriginType,
    Scope,
)
from tests.test_document_sections import _make_pdf_bytes


class FakeEmbeddingClient:
    def __init__(self, *, embeddings_by_text: dict[str, list[float]]) -> None:
        self._embeddings_by_text = embeddings_by_text

    def embed_texts(self, *, texts: Sequence[str]) -> list[list[float]]:
        return [self._embeddings_by_text[text] for text in texts]


def _make_candidate_rule(
    *,
    rule_id: str,
    document_version_id: str,
    statement: str,
    section_id: str,
    quote: str,
    start_char: int,
    end_char: int,
    country: str | None = None,
    value: str = "75",
) -> CandidateRule:
    return CandidateRule(
        rule_id=rule_id,
        statement=statement,
        enforceability_class=EnforceabilityClass.ENFORCEABLE,
        lifecycle_state=LifecycleState.EXTRACTED,
        origin=RuleOrigin(
            source_type=RuleOriginType.EXTRACTED,
            extraction_run_id="extract-expense-policy-v1",
        ),
        scope=Scope(
            expense_category="meals",
            country=country,
        ),
        citation=Citation(
            document_id="expense-policy",
            document_version_id=document_version_id,
            section_id=section_id,
            quote=quote,
            start_char=start_char,
            end_char=end_char,
        ),
        condition=RuleCondition(
            field="meal.amount",
            operator="<=",
            value=value,
        ),
    )


def test_retrieve_candidate_rule_context_returns_related_sections_and_rules(
    monkeypatch,
    tmp_path,
) -> None:
    object_storage_root = tmp_path / "object-storage"
    monkeypatch.setenv("POLICY_PIPELINE_OBJECT_STORAGE_ROOT", str(object_storage_root))

    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    document_bytes = _make_pdf_bytes(
        [
            ("Meals", 18),
            ("Domestic meals are capped at $75 per day.", 12),
            ("International Meals", 18),
            ("International meals are capped at $100 per day.", 12),
            ("Glossary", 18),
            ("VIP means vice president approved attendees only.", 12),
        ]
    )

    with Session(engine) as session:
        document_version = create_document_version(
            session,
            document_id="expense-policy",
            filename="expense-policy.pdf",
            content_type=PDF_CONTENT_TYPE,
            document_bytes=document_bytes,
        )
        sections = list_document_sections(
            session,
            document_id="expense-policy",
            document_version_id=document_version.document_version_id,
        )
        section_by_heading = {section.heading_path[-1]: section for section in sections}
        domestic_section = section_by_heading["Meals"]
        international_section = section_by_heading["International Meals"]
        glossary_section = section_by_heading["Glossary"]

        embedding_client = FakeEmbeddingClient(
            embeddings_by_text={
                "Meals\nDomestic meals are capped at $75 per day.": [1.0, 0.0, 0.0],
                "International Meals\nInternational meals are capped at $100 per day.": [
                    0.96,
                    0.04,
                    0.0,
                ],
                "Glossary\nVIP means vice president approved attendees only.": [
                    0.0,
                    1.0,
                    0.0,
                ],
                "Meals are capped at $75 per day.": [1.0, 0.0, 0.0],
            }
        )

        store_section_embeddings(
            session,
            document_id="expense-policy",
            document_version_id=document_version.document_version_id,
            embedding_client=embedding_client,
        )

        related_rules = [
            _make_candidate_rule(
                rule_id="extract-expense-policy-v1:1",
                document_version_id=document_version.document_version_id,
                statement="Domestic meals are capped at $75 per day.",
                section_id=domestic_section.section_id,
                quote="Domestic meals are capped at $75 per day.",
                start_char=domestic_section.start_char + len("Meals\n"),
                end_char=domestic_section.end_char,
                country="domestic",
                value="75",
            ),
            _make_candidate_rule(
                rule_id="extract-expense-policy-v1:2",
                document_version_id=document_version.document_version_id,
                statement="International meals are capped at $100 per day.",
                section_id=international_section.section_id,
                quote="International meals are capped at $100 per day.",
                start_char=international_section.start_char + len("International Meals\n"),
                end_char=international_section.end_char,
                country="international",
                value="100",
            ),
        ]
        candidate_rule = _make_candidate_rule(
            rule_id="extract-expense-policy-v1:3",
            document_version_id=document_version.document_version_id,
            statement="Meals are capped at $75 per day.",
            section_id=domestic_section.section_id,
            quote="Domestic meals are capped at $75 per day.",
            start_char=domestic_section.start_char + len("Meals\n"),
            end_char=domestic_section.end_char,
        )

        context = retrieve_candidate_rule_context(
            session,
            candidate_rule=candidate_rule,
            document_id="expense-policy",
            document_version_id=document_version.document_version_id,
            query_text="Meals are capped at $75 per day.",
            embedding_client=embedding_client,
            related_rule_pool=related_rules,
            limit=2,
        )

    engine.dispose()

    assert [match.section.section_id for match in context.related_sections] == [
        domestic_section.section_id,
        international_section.section_id,
    ]
    assert [match.rule.rule_id for match in context.related_rules] == [
        "extract-expense-policy-v1:1",
        "extract-expense-policy-v1:2",
    ]
    assert all(
        match.section.section_id != glossary_section.section_id
        for match in context.related_sections
    )
