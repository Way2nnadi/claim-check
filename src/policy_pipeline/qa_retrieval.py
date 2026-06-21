from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from hashlib import sha256

import sqlalchemy as sa
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from policy_pipeline.database import (
    DocumentSectionEmbeddingRecord,
    DocumentSectionRecord,
    VectorType,
)
from policy_pipeline.documents import (
    DocumentSection,
    document_section_from_record,
    list_document_sections,
)
from policy_pipeline.rules import CandidateRule, QAFlag, QAFlagCode, Rule

SECTION_EMBEDDING_DIMENSION = 16
_EMPTY_VECTOR = [0.0] * SECTION_EMBEDDING_DIMENSION
_TOKEN_RE = re.compile(r"[a-z0-9]+")
_UPPERCASE_TERM_RE = re.compile(r"\b[A-Z][A-Z0-9]{1,}\b")
_QUOTED_TERM_RE = re.compile(r'"([^"]{2,80})"')
_IGNORED_UNDEFINED_TERMS = {"USD", "EUR", "GBP"}
_SCOPE_FIELDS = (
    "expense_category",
    "country",
    "travel_type",
    "employee_group",
)
_MAX_RELATED_SECTION_DISTANCE = 0.35


class SectionEmbeddingClient:
    def embed_texts(self, *, texts: Sequence[str]) -> list[list[float]]:
        raise NotImplementedError


class DeterministicHashEmbeddingClient(SectionEmbeddingClient):
    def embed_texts(self, *, texts: Sequence[str]) -> list[list[float]]:
        return [_hash_text_to_embedding(text) for text in texts]


@dataclass(frozen=True)
class SectionMatch:
    section: DocumentSection
    distance: float


@dataclass(frozen=True)
class RuleMatch:
    rule: CandidateRule | Rule
    distance: float


@dataclass(frozen=True)
class CandidateRuleQARetrievalContext:
    related_sections: list[SectionMatch]
    related_rules: list[RuleMatch]


def _validate_embedding_dimensions(embedding: Sequence[float]) -> list[float]:
    normalized = [float(component) for component in embedding]
    if len(normalized) != SECTION_EMBEDDING_DIMENSION:
        raise ValueError(
            "Expected "
            f"{SECTION_EMBEDDING_DIMENSION}-dimensional vector, got {len(normalized)}."
        )
    return normalized


def store_section_embeddings(
    session: Session,
    *,
    document_id: str,
    document_version_id: str,
    sections: Sequence[DocumentSection] | None = None,
    embedding_client: SectionEmbeddingClient | None = None,
    commit: bool = False,
) -> list[DocumentSectionEmbeddingRecord]:
    section_list = list(
        sections
        or list_document_sections(
            session,
            document_id=document_id,
            document_version_id=document_version_id,
        )
    )
    if not section_list:
        return []

    statement: Select[tuple[DocumentSectionEmbeddingRecord]] = select(
        DocumentSectionEmbeddingRecord
    ).where(
        DocumentSectionEmbeddingRecord.document_id == document_id,
        DocumentSectionEmbeddingRecord.document_version_id == document_version_id,
    )
    existing_records = {
        (record.document_version_id, record.section_id): record
        for record in session.scalars(statement)
    }
    missing_sections = [
        section
        for section in section_list
        if (section.document_version_id, section.section_id) not in existing_records
    ]
    if missing_sections:
        client = embedding_client or DeterministicHashEmbeddingClient()
        embeddings = client.embed_texts(
            texts=[_section_embedding_text(section) for section in missing_sections]
        )
        for section, embedding in zip(missing_sections, embeddings, strict=True):
            record = DocumentSectionEmbeddingRecord(
                document_version_id=section.document_version_id,
                section_id=section.section_id,
                document_id=section.document_id,
                embedding=_validate_embedding_dimensions(embedding),
            )
            session.add(record)
            existing_records[(record.document_version_id, record.section_id)] = record
        session.flush()
        if commit:
            session.commit()

    return [
        existing_records[(section.document_version_id, section.section_id)]
        for section in section_list
    ]


def retrieve_candidate_rule_context(
    session: Session,
    *,
    candidate_rule: CandidateRule,
    document_id: str,
    document_version_id: str,
    query_text: str | None = None,
    embedding_client: SectionEmbeddingClient | None = None,
    related_rule_pool: Sequence[CandidateRule | Rule] = (),
    limit: int = 5,
) -> CandidateRuleQARetrievalContext:
    sections = list_document_sections(
        session,
        document_id=document_id,
        document_version_id=document_version_id,
    )
    if not sections:
        return CandidateRuleQARetrievalContext(related_sections=[], related_rules=[])

    store_section_embeddings(
        session,
        document_id=document_id,
        document_version_id=document_version_id,
        sections=sections,
        embedding_client=embedding_client,
    )
    client = embedding_client or DeterministicHashEmbeddingClient()
    query_embedding = _validate_embedding_dimensions(
        client.embed_texts(
        texts=[query_text or _candidate_rule_query_text(candidate_rule)]
        )[0]
    )
    related_sections = _retrieve_related_sections(
        session,
        document_id=document_id,
        document_version_id=document_version_id,
        query_embedding=query_embedding,
        limit=limit,
    )

    section_distance_by_id = {
        match.section.section_id: match.distance for match in related_sections
    }
    related_rules: list[RuleMatch] = []
    for related_rule in related_rule_pool:
        if related_rule.rule_id == candidate_rule.rule_id or related_rule.citation is None:
            continue
        if related_rule.citation.document_version_id != document_version_id:
            continue
        distance = section_distance_by_id.get(related_rule.citation.section_id)
        if distance is None:
            continue
        related_rules.append(RuleMatch(rule=related_rule, distance=distance))

    related_rules.sort(key=lambda match: (match.distance, match.rule.rule_id))
    return CandidateRuleQARetrievalContext(
        related_sections=related_sections,
        related_rules=related_rules,
    )


def attach_retrieval_assisted_qa_flags(
    *,
    candidate_rule: CandidateRule,
    context: CandidateRuleQARetrievalContext,
) -> None:
    existing_codes = {flag.code for flag in candidate_rule.qa_flags}

    ambiguous_scope_flag = _ambiguous_scope_flag(candidate_rule=candidate_rule, context=context)
    if ambiguous_scope_flag is not None and ambiguous_scope_flag.code not in existing_codes:
        candidate_rule.qa_flags.append(ambiguous_scope_flag)
        existing_codes.add(ambiguous_scope_flag.code)

    contradiction_flag = _possible_contradiction_flag(
        candidate_rule=candidate_rule,
        context=context,
    )
    if contradiction_flag is not None and contradiction_flag.code not in existing_codes:
        candidate_rule.qa_flags.append(contradiction_flag)
        existing_codes.add(contradiction_flag.code)

    undefined_term_flag = _undefined_term_flag(candidate_rule=candidate_rule, context=context)
    if undefined_term_flag is not None and undefined_term_flag.code not in existing_codes:
        candidate_rule.qa_flags.append(undefined_term_flag)


def _retrieve_related_sections(
    session: Session,
    *,
    document_id: str,
    document_version_id: str,
    query_embedding: Sequence[float],
    limit: int,
) -> list[SectionMatch]:
    engine = session.get_bind()
    if engine is not None and engine.dialect.name == "postgresql":
        query_literal = sa.literal(
            list(query_embedding),
            type_=VectorType(SECTION_EMBEDDING_DIMENSION),
        )
        distance = sa.cast(
            DocumentSectionEmbeddingRecord.embedding.op("<=>")(query_literal),
            sa.Float,
        ).label("distance")
        statement = (
            select(DocumentSectionRecord, distance)
            .join(
                DocumentSectionEmbeddingRecord,
                sa.and_(
                    DocumentSectionEmbeddingRecord.document_version_id
                    == DocumentSectionRecord.document_version_id,
                    DocumentSectionEmbeddingRecord.section_id == DocumentSectionRecord.section_id,
                ),
            )
            .where(
                DocumentSectionRecord.document_id == document_id,
                DocumentSectionRecord.document_version_id == document_version_id,
            )
            .order_by(distance, DocumentSectionRecord.start_char, DocumentSectionRecord.section_id)
            .limit(limit)
        )
        results = session.execute(statement).all()
        return [
            SectionMatch(
                section=document_section_from_record(record),
                distance=float(raw_distance),
            )
            for record, raw_distance in results
            if float(raw_distance) <= _MAX_RELATED_SECTION_DISTANCE
        ]

    sections = {
        (section.document_version_id, section.section_id): section
        for section in list_document_sections(
            session,
            document_id=document_id,
            document_version_id=document_version_id,
        )
    }
    statement = select(DocumentSectionEmbeddingRecord).where(
        DocumentSectionEmbeddingRecord.document_id == document_id,
        DocumentSectionEmbeddingRecord.document_version_id == document_version_id,
    )
    matches: list[SectionMatch] = []
    for record in session.scalars(statement):
        section = sections[(record.document_version_id, record.section_id)]
        matches.append(
            SectionMatch(
                section=section,
                distance=_cosine_distance(query_embedding, record.embedding),
            )
        )

    matches.sort(
        key=lambda match: (
            match.distance,
            match.section.start_char,
            match.section.section_id,
        )
    )
    return [
        match
        for match in matches
        if match.distance <= _MAX_RELATED_SECTION_DISTANCE
    ][:limit]


def _ambiguous_scope_flag(
    *,
    candidate_rule: CandidateRule,
    context: CandidateRuleQARetrievalContext,
) -> QAFlag | None:
    for field_name in _SCOPE_FIELDS:
        if getattr(candidate_rule.scope, field_name) is not None:
            continue
        values = {
            getattr(match.rule.scope, field_name)
            for match in context.related_rules
            if getattr(match.rule.scope, field_name) is not None
        }
        if len(values) < 2:
            continue
        sorted_values = ", ".join(sorted(str(value) for value in values))
        return QAFlag(
            code=QAFlagCode.AMBIGUOUS_SCOPE,
            detail=(
                f"Candidate Rule scope is ambiguous for {field_name}; related Rules span "
                f"{sorted_values}."
            ),
        )
    return None


def _possible_contradiction_flag(
    *,
    candidate_rule: CandidateRule,
    context: CandidateRuleQARetrievalContext,
) -> QAFlag | None:
    if candidate_rule.condition is None:
        return None

    for match in context.related_rules:
        related_rule = match.rule
        if related_rule.condition is None:
            continue
        if not _same_scope(candidate_rule, related_rule):
            continue
        if related_rule.condition.field != candidate_rule.condition.field:
            continue
        if related_rule.applicability != candidate_rule.applicability:
            continue
        if (
            related_rule.condition.operator == candidate_rule.condition.operator
            and related_rule.condition.value == candidate_rule.condition.value
        ):
            continue
        return QAFlag(
            code=QAFlagCode.POSSIBLE_CONTRADICTION,
            detail=(
                "Candidate Rule may contradict related Rule "
                f"'{related_rule.rule_id}' on {candidate_rule.condition.field}."
            ),
        )
    return None


def _undefined_term_flag(
    *,
    candidate_rule: CandidateRule,
    context: CandidateRuleQARetrievalContext,
) -> QAFlag | None:
    candidate_terms = _undefined_term_candidates(candidate_rule.statement)
    if not candidate_terms:
        return None

    supporting_text = "\n".join(
        _supporting_section_text(section_match.section, candidate_rule)
        for section_match in context.related_sections
    )
    for term in candidate_terms:
        if term in _IGNORED_UNDEFINED_TERMS:
            continue
        if term.lower() in supporting_text.lower():
            continue
        return QAFlag(
            code=QAFlagCode.UNDEFINED_TERM,
            detail=f"Candidate Rule uses undefined term '{term}' in retrieved sections.",
        )
    return None


def _same_scope(candidate_rule: CandidateRule, related_rule: CandidateRule | Rule) -> bool:
    return all(
        getattr(candidate_rule.scope, field_name) == getattr(related_rule.scope, field_name)
        for field_name in _SCOPE_FIELDS
    )


def _candidate_rule_query_text(candidate_rule: CandidateRule) -> str:
    return candidate_rule.statement


def _section_embedding_text(section: DocumentSection) -> str:
    return section.content


def _hash_text_to_embedding(text: str) -> list[float]:
    vector = list(_EMPTY_VECTOR)
    tokens = _TOKEN_RE.findall(text.lower())
    if not tokens:
        vector[0] = 1.0
        return vector

    for token in tokens:
        digest = sha256(token.encode("utf-8")).digest()
        index = digest[0] % SECTION_EMBEDDING_DIMENSION
        sign = 1.0 if digest[1] % 2 == 0 else -1.0
        weight = 1.0 + digest[2] / 255.0
        vector[index] += sign * weight

    magnitude = math.sqrt(sum(component * component for component in vector))
    if magnitude == 0:
        vector[0] = 1.0
        magnitude = 1.0
    return [component / magnitude for component in vector]


def _cosine_distance(left: Sequence[float], right: Sequence[float]) -> float:
    left_values = _validate_embedding_dimensions(left)
    right_values = _validate_embedding_dimensions(right)
    left_magnitude = math.sqrt(sum(component * component for component in left_values))
    right_magnitude = math.sqrt(sum(component * component for component in right_values))
    if left_magnitude == 0 or right_magnitude == 0:
        return 1.0
    similarity = sum(
        left_component * right_component
        for left_component, right_component in zip(left_values, right_values, strict=False)
    ) / (left_magnitude * right_magnitude)
    return 1.0 - similarity


def _undefined_term_candidates(statement: str) -> list[str]:
    candidates = [match.group(1).strip() for match in _QUOTED_TERM_RE.finditer(statement)]
    candidates.extend(match.group(0) for match in _UPPERCASE_TERM_RE.finditer(statement))
    seen: set[str] = set()
    ordered_candidates: list[str] = []
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        ordered_candidates.append(candidate)
    return ordered_candidates


def _supporting_section_text(section: DocumentSection, candidate_rule: CandidateRule) -> str:
    if candidate_rule.citation is None or section.section_id != candidate_rule.citation.section_id:
        return section.content
    return section.content.replace(candidate_rule.citation.quote, " ")
