from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from difflib import SequenceMatcher
from enum import StrEnum

from pydantic import BaseModel
from sqlalchemy.orm import Session

from policy_pipeline.policy_documents.service import DocumentSection, list_document_sections

_FUZZY_CITATION_MIN_RATIO = 0.82
_MONEY_AMOUNT_RE = re.compile(r"\$\s*(\d+(?:\.\d+)?)")


class CitationAnchor(BaseModel):
    document_id: str
    document_version_id: str
    section_id: str
    quote: str
    start_char: int
    end_char: int


class CitationMatchKind(StrEnum):
    EXACT = "exact"
    CASE_INSENSITIVE = "case_insensitive"
    FLEXIBLE_WHITESPACE = "flexible_whitespace"
    FUZZY = "fuzzy"


@dataclass(frozen=True)
class CitationResolution:
    anchor: CitationAnchor
    match_kind: CitationMatchKind
    requested_quote: str


def resolve_citation_anchor(
    session: Session,
    *,
    document_id: str,
    document_version_id: str,
    quote: str,
) -> CitationAnchor | None:
    resolution = resolve_citation_anchor_with_fallback(
        session,
        document_id=document_id,
        document_version_id=document_version_id,
        quote=quote,
    )
    return resolution.anchor if resolution is not None else None


def resolve_citation_anchor_with_fallback(
    session: Session,
    *,
    document_id: str,
    document_version_id: str,
    quote: str,
    fallback_quotes: Sequence[str] = (),
) -> CitationResolution | None:
    sections = list_document_sections(
        session,
        document_id=document_id,
        document_version_id=document_version_id,
    )
    for candidate_quote in (quote, *fallback_quotes):
        if not candidate_quote:
            continue
        resolution = _resolve_citation_in_sections(
            sections=sections,
            document_id=document_id,
            document_version_id=document_version_id,
            requested_quote=candidate_quote,
        )
        if resolution is not None:
            return resolution
    return None


def _resolve_citation_in_sections(
    *,
    sections: Sequence[DocumentSection],
    document_id: str,
    document_version_id: str,
    requested_quote: str,
) -> CitationResolution | None:
    for section in sections:
        exact_resolution = _resolve_exact_citation_in_section(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            requested_quote=requested_quote,
        )
        if exact_resolution is not None:
            return exact_resolution

        fuzzy_resolution = _resolve_fuzzy_citation_in_section(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            requested_quote=requested_quote,
        )
        if fuzzy_resolution is not None:
            return fuzzy_resolution

        for line_resolution in _resolve_line_based_citations_in_section(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            requested_quote=requested_quote,
        ):
            return line_resolution
    return None


def _resolve_line_based_citations_in_section(
    *,
    section: DocumentSection,
    document_id: str,
    document_version_id: str,
    requested_quote: str,
) -> list[CitationResolution]:
    resolutions: list[CitationResolution] = []
    for line in section.content.splitlines():
        stripped_line = line.strip()
        if not stripped_line:
            continue
        start_in_section = section.content.find(stripped_line)
        if start_in_section < 0:
            continue

        case_insensitive_resolution = _resolve_case_insensitive_citation_in_line(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            requested_quote=requested_quote,
            line=stripped_line,
            start_in_section=start_in_section,
        )
        if case_insensitive_resolution is not None:
            resolutions.append(case_insensitive_resolution)
            continue

        flexible_whitespace_resolution = _resolve_flexible_whitespace_citation_in_line(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            requested_quote=requested_quote,
            line=stripped_line,
            start_in_section=start_in_section,
        )
        if flexible_whitespace_resolution is not None:
            resolutions.append(flexible_whitespace_resolution)

    return resolutions


def _resolve_exact_citation_in_section(
    *,
    section: DocumentSection,
    document_id: str,
    document_version_id: str,
    requested_quote: str,
) -> CitationResolution | None:
    start_in_section = section.content.find(requested_quote)
    if start_in_section < 0:
        return None
    return CitationResolution(
        anchor=_citation_anchor_from_span(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            start_in_section=start_in_section,
            end_in_section=start_in_section + len(requested_quote),
            quote=requested_quote,
        ),
        match_kind=CitationMatchKind.EXACT,
        requested_quote=requested_quote,
    )


def _resolve_case_insensitive_citation_in_line(
    *,
    section: DocumentSection,
    document_id: str,
    document_version_id: str,
    requested_quote: str,
    line: str,
    start_in_section: int,
) -> CitationResolution | None:
    if line.lower().find(requested_quote.lower()) < 0:
        return None
    matched_quote = line
    return CitationResolution(
        anchor=_citation_anchor_from_span(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            start_in_section=start_in_section,
            end_in_section=start_in_section + len(matched_quote),
            quote=matched_quote,
        ),
        match_kind=CitationMatchKind.CASE_INSENSITIVE,
        requested_quote=requested_quote,
    )


def _resolve_flexible_whitespace_citation_in_line(
    *,
    section: DocumentSection,
    document_id: str,
    document_version_id: str,
    requested_quote: str,
    line: str,
    start_in_section: int,
) -> CitationResolution | None:
    parts = requested_quote.split()
    if not parts:
        return None
    pattern = re.compile(
        r"\s+".join(re.escape(part) for part in parts),
        re.IGNORECASE,
    )
    match = pattern.search(line)
    if match is None:
        return None
    matched_quote = line[match.start() : match.end()]
    return CitationResolution(
        anchor=_citation_anchor_from_span(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            start_in_section=start_in_section + match.start(),
            end_in_section=start_in_section + match.end(),
            quote=matched_quote,
        ),
        match_kind=CitationMatchKind.FLEXIBLE_WHITESPACE,
        requested_quote=requested_quote,
    )


def _resolve_fuzzy_citation_in_section(
    *,
    section: DocumentSection,
    document_id: str,
    document_version_id: str,
    requested_quote: str,
) -> CitationResolution | None:
    normalized_requested_quote = _normalize_citation_text(requested_quote)
    if not normalized_requested_quote:
        return None

    best_line: str | None = None
    best_ratio = 0.0
    for line in section.content.splitlines():
        stripped_line = line.strip()
        if not stripped_line:
            continue
        normalized_line = _normalize_citation_text(stripped_line)
        ratio = SequenceMatcher(
            None,
            normalized_requested_quote,
            normalized_line,
        ).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_line = stripped_line

    if best_line is None or best_ratio < _FUZZY_CITATION_MIN_RATIO:
        return None
    if not _money_amounts_compatible(requested_quote, best_line):
        return None

    start_in_section = section.content.find(best_line)
    if start_in_section < 0:
        return None
    return CitationResolution(
        anchor=_citation_anchor_from_span(
            section=section,
            document_id=document_id,
            document_version_id=document_version_id,
            start_in_section=start_in_section,
            end_in_section=start_in_section + len(best_line),
            quote=best_line,
        ),
        match_kind=CitationMatchKind.FUZZY,
        requested_quote=requested_quote,
    )


def _citation_anchor_from_span(
    *,
    section: DocumentSection,
    document_id: str,
    document_version_id: str,
    start_in_section: int,
    end_in_section: int,
    quote: str,
) -> CitationAnchor:
    start_char = section.start_char + start_in_section
    end_char = section.start_char + end_in_section
    return CitationAnchor(
        document_id=document_id,
        document_version_id=document_version_id,
        section_id=section.section_id,
        quote=quote,
        start_char=start_char,
        end_char=end_char,
    )


def _normalize_citation_text(value: str) -> str:
    normalized = value.lower().replace("\u2019", "'").replace("\u2018", "'")
    normalized = normalized.replace("\u201c", '"').replace("\u201d", '"')
    return " ".join(normalized.split())


def _money_amounts(value: str) -> set[str]:
    return {match.group(1) for match in _MONEY_AMOUNT_RE.finditer(value)}


def _money_amounts_compatible(requested_quote: str, matched_quote: str) -> bool:
    requested_amounts = _money_amounts(requested_quote)
    matched_amounts = _money_amounts(matched_quote)
    if not requested_amounts or not matched_amounts:
        return True
    return not requested_amounts.isdisjoint(matched_amounts)
