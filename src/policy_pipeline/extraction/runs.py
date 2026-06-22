from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from policy_pipeline.extraction.llm_clients import (
    CandidateRuleExtractionLLMClient,
    build_llm_client,
)
from policy_pipeline.extraction.qa_retrieval import (
    SectionEmbeddingClient,
    attach_retrieval_assisted_qa_flags,
    retrieve_candidate_rule_context,
    store_section_embeddings,
)
from policy_pipeline.extraction.registry import (
    ExtractionRun,
    ModelConfiguration,
    PromptTemplate,
    UnknownDocumentVersionError,
    UnknownModelConfigurationVersionError,
    UnknownPromptTemplateVersionError,
    create_extraction_run,
    get_model_configuration,
    get_prompt_template,
)
from policy_pipeline.extraction.structured_output import (
    StructuredCandidateRule,
    StructuredCandidateRulesPayload,
)
from policy_pipeline.policy_documents.citations import (
    CitationMatchKind,
    resolve_citation_anchor_with_fallback,
)
from policy_pipeline.policy_documents.service import (
    DocumentSection,
    get_document_version,
    list_document_sections,
)
from policy_pipeline.rules.models import (
    Applicability,
    CandidateRule,
    Citation,
    EnforceabilityClass,
    LifecycleState,
    QAFlag,
    QAFlagCode,
    RuleCondition,
    RuleOrigin,
    RuleOriginType,
)
from policy_pipeline.rules.store import create_rule
from policy_pipeline.shared.config import Settings, get_settings

_LOW_EXTRACTION_CONFIDENCE_THRESHOLD = 0.75
_QUANTITATIVE_STATEMENT_PATTERN = re.compile(r"[$€£]|\b\d+(?:\.\d+)?\b")
_QUANTITATIVE_OPERATORS = {"<", "<=", ">", ">=", "=", "=="}


class StructuredOutputRejectedError(Exception):
    def __init__(self, *, attempts: int, detail: str) -> None:
        super().__init__(detail)
        self.attempts = attempts
        self.detail = detail


class DeletedDocumentVersionError(Exception):
    def __init__(self, document_version_id: str) -> None:
        super().__init__(document_version_id)
        self.document_version_id = document_version_id


class ExtractionExecutionResult(BaseModel):
    extraction_run_id: str
    document_version_id: str
    prompt_template_id: str
    prompt_template_version: str
    model_configuration_id: str
    model_configuration_version: str
    attempt_count: int
    candidate_rules: list[CandidateRule] = Field(default_factory=list)


@dataclass(frozen=True)
class ExtractionContext:
    extraction_run: ExtractionRun
    document_id: str
    document_version_id: str
    prompt_template: PromptTemplate
    model_configuration: ModelConfiguration
    sections: list[DocumentSection]
    document_text: str
    llm_client: CandidateRuleExtractionLLMClient
    embedding_client: SectionEmbeddingClient | None
    max_attempts: int


def execute_extraction_run(
    session: Session,
    *,
    extraction_run_id: str,
    document_id: str,
    document_version_id: str,
    prompt_template_id: str,
    prompt_template_version: str,
    model_configuration_id: str,
    model_configuration_version: str,
    llm_client: CandidateRuleExtractionLLMClient | None = None,
    embedding_client: SectionEmbeddingClient | None = None,
    settings: Settings | None = None,
) -> ExtractionExecutionResult:
    context = _load_extraction_context(
        session,
        extraction_run_id=extraction_run_id,
        document_id=document_id,
        document_version_id=document_version_id,
        prompt_template_id=prompt_template_id,
        prompt_template_version=prompt_template_version,
        model_configuration_id=model_configuration_id,
        model_configuration_version=model_configuration_version,
        llm_client=llm_client,
        embedding_client=embedding_client,
        settings=settings,
    )
    attempt_count, candidate_rules = _run_llm_extraction(
        session,
        context=context,
    )
    _attach_qa_flags(
        session,
        candidate_rules=candidate_rules,
        document_id=context.document_id,
        document_version_id=context.document_version_id,
        embedding_client=context.embedding_client,
    )
    return _persist_extraction_run(
        session,
        context=context,
        attempt_count=attempt_count,
        candidate_rules=candidate_rules,
    )


def _load_extraction_context(
    session: Session,
    *,
    extraction_run_id: str,
    document_id: str,
    document_version_id: str,
    prompt_template_id: str,
    prompt_template_version: str,
    model_configuration_id: str,
    model_configuration_version: str,
    llm_client: CandidateRuleExtractionLLMClient | None = None,
    embedding_client: SectionEmbeddingClient | None = None,
    settings: Settings | None = None,
) -> ExtractionContext:
    document_version = get_document_version(
        session,
        document_id=document_id,
        document_version_id=document_version_id,
    )
    if document_version is None:
        raise UnknownDocumentVersionError(document_version_id)
    if document_version.deleted_at is not None:
        raise DeletedDocumentVersionError(document_version_id)

    prompt_template = get_prompt_template(
        session,
        prompt_template_id=prompt_template_id,
        version=prompt_template_version,
    )
    if prompt_template is None:
        raise UnknownPromptTemplateVersionError(f"{prompt_template_id}@{prompt_template_version}")

    model_configuration = get_model_configuration(
        session,
        model_configuration_id=model_configuration_id,
        version=model_configuration_version,
    )
    if model_configuration is None:
        raise UnknownModelConfigurationVersionError(
            f"{model_configuration_id}@{model_configuration_version}"
        )

    runtime_settings = settings or get_settings()
    client = llm_client or build_llm_client(
        settings=runtime_settings,
        model_configuration=model_configuration,
    )
    extraction_run = create_extraction_run(
        session,
        extraction_run_id=extraction_run_id,
        document_version_id=document_version_id,
        prompt_template_id=prompt_template_id,
        prompt_template_version=prompt_template_version,
        model_configuration_id=model_configuration_id,
        model_configuration_version=model_configuration_version,
        commit=False,
    )
    sections = list_document_sections(
        session,
        document_id=document_id,
        document_version_id=document_version_id,
    )
    store_section_embeddings(
        session,
        document_id=document_id,
        document_version_id=document_version_id,
        sections=sections,
        embedding_client=embedding_client,
    )
    document_text = "\n\n".join(section.content for section in sections)
    return ExtractionContext(
        extraction_run=extraction_run,
        document_id=document_id,
        document_version_id=document_version_id,
        prompt_template=prompt_template,
        model_configuration=model_configuration,
        sections=sections,
        document_text=document_text,
        llm_client=client,
        embedding_client=embedding_client,
        max_attempts=_max_validation_attempts(model_configuration=model_configuration),
    )


def _run_llm_extraction(
    session: Session,
    *,
    context: ExtractionContext,
) -> tuple[int, list[CandidateRule]]:
    last_error = "Structured extraction output did not pass validation."

    for attempt in range(1, context.max_attempts + 1):
        raw_output = context.llm_client.extract_candidate_rules(
            prompt_template=context.prompt_template,
            model_configuration=context.model_configuration,
            document_text=context.document_text,
            attempt=attempt,
        )
        try:
            candidate_rules = _materialize_candidate_rules(
                structured_output=raw_output,
                extraction_run=context.extraction_run,
                document_id=context.document_id,
                document_version_id=context.document_version_id,
                session=session,
            )
        except (ValidationError, ValueError) as exc:
            last_error = str(exc)
            continue

        return attempt, candidate_rules

    raise StructuredOutputRejectedError(attempts=context.max_attempts, detail=last_error)


def _attach_qa_flags(
    session: Session,
    *,
    candidate_rules: list[CandidateRule],
    document_id: str,
    document_version_id: str,
    embedding_client: SectionEmbeddingClient | None,
) -> None:
    for candidate_rule in candidate_rules:
        context = retrieve_candidate_rule_context(
            session,
            candidate_rule=candidate_rule,
            document_id=document_id,
            document_version_id=document_version_id,
            embedding_client=embedding_client,
            related_rule_pool=[
                related_rule
                for related_rule in candidate_rules
                if related_rule.rule_id != candidate_rule.rule_id
            ],
        )
        attach_retrieval_assisted_qa_flags(
            candidate_rule=candidate_rule,
            context=context,
        )


def _persist_extraction_run(
    session: Session,
    *,
    context: ExtractionContext,
    attempt_count: int,
    candidate_rules: list[CandidateRule],
) -> ExtractionExecutionResult:
    for rule in candidate_rules:
        create_rule(session, rule=rule, commit=False)
    extraction_run = context.extraction_run
    return ExtractionExecutionResult(
        extraction_run_id=extraction_run.extraction_run_id,
        document_version_id=extraction_run.document_version_id,
        prompt_template_id=extraction_run.prompt_template_id,
        prompt_template_version=extraction_run.prompt_template_version,
        model_configuration_id=extraction_run.model_configuration_id,
        model_configuration_version=extraction_run.model_configuration_version,
        attempt_count=attempt_count,
        candidate_rules=candidate_rules,
    )


def _max_validation_attempts(*, model_configuration: ModelConfiguration) -> int:
    raw_value = model_configuration.settings.get("max_validation_attempts", 2)
    if not isinstance(raw_value, int) or raw_value < 1:
        return 2
    return raw_value


def _materialize_candidate_rules(
    *,
    structured_output: Any,
    extraction_run: ExtractionRun,
    document_id: str,
    document_version_id: str,
    session: Session,
) -> list[CandidateRule]:
    payload = StructuredCandidateRulesPayload.model_validate(structured_output)
    candidate_rules: list[CandidateRule] = []
    for index, draft in enumerate(payload.candidate_rules, start=1):
        qa_flags: list[QAFlag] = []
        citation = _resolve_citation(
            session=session,
            document_id=document_id,
            document_version_id=document_version_id,
            citation_quote=draft.citation_quote,
            fallback_quotes=[draft.statement],
            qa_flags=qa_flags,
        )
        condition = _normalize_condition(draft=draft)
        applicability, invalid_enum_flagged = _normalize_applicability(
            draft=draft,
            qa_flags=qa_flags,
        )
        if _is_quantitative_candidate_rule(draft=draft):
            if condition is None:
                qa_flags.append(
                    QAFlag(
                        code=QAFlagCode.MISSING_THRESHOLD,
                        detail="Quantitative Candidate Rule is missing a threshold value.",
                    )
                )
            if draft.applicability is None or (
                applicability is None and not invalid_enum_flagged
            ):
                qa_flags.append(
                    QAFlag(
                        code=QAFlagCode.MISSING_APPLICABILITY,
                        detail="Quantitative Candidate Rule is missing Applicability.",
                    )
                )
        if (
            draft.extraction_confidence is not None
            and draft.extraction_confidence < _LOW_EXTRACTION_CONFIDENCE_THRESHOLD
        ):
            qa_flags.append(
                QAFlag(
                    code=QAFlagCode.LOW_EXTRACTION_CONFIDENCE,
                    detail=(
                        "Candidate Rule extraction confidence "
                        f"{draft.extraction_confidence:.2f} is below "
                        f"{_LOW_EXTRACTION_CONFIDENCE_THRESHOLD:.2f}."
                    ),
                )
            )
        candidate_rules.append(
            CandidateRule(
                rule_id=f"{extraction_run.extraction_run_id}:{index}",
                statement=draft.statement,
                enforceability_class=draft.enforceability_class,
                lifecycle_state=LifecycleState.EXTRACTED,
                origin=RuleOrigin(
                    source_type=RuleOriginType.EXTRACTED,
                    extraction_run_id=extraction_run.extraction_run_id,
                ),
                scope=draft.scope,
                citation=citation,
                condition=condition,
                applicability=applicability,
                exceptions=draft.exceptions,
                qa_flags=qa_flags,
            )
        )
    return candidate_rules


def _normalize_condition(*, draft: StructuredCandidateRule) -> RuleCondition | None:
    if draft.condition is None:
        return None
    if not draft.condition.field or not draft.condition.operator or not draft.condition.value:
        return None
    return RuleCondition.model_validate(draft.condition.model_dump())


def _normalize_applicability(
    *,
    draft: StructuredCandidateRule,
    qa_flags: list[QAFlag],
) -> tuple[Applicability | None, bool]:
    if draft.applicability is None:
        return None, False

    applicability_payload = draft.applicability.model_dump()
    currency = applicability_payload.get("currency")
    if currency is not None:
        normalized_currency = str(currency).strip().upper()
        if not re.fullmatch(r"[A-Z]{3}", normalized_currency):
            qa_flags.append(
                QAFlag(
                    code=QAFlagCode.INVALID_ENUM,
                    detail=(
                        "Candidate Rule contains an invalid currency code: "
                        f"{currency!r}. Expected a 3-letter ISO code."
                    ),
                )
            )
            applicability_payload["currency"] = None
        else:
            applicability_payload["currency"] = normalized_currency

    try:
        return Applicability.model_validate(applicability_payload), False
    except ValidationError as exc:
        invalid_enum_error = next(
            (
                error
                for error in exc.errors()
                if tuple(error["loc"]) == ("aggregation_period",) and error["type"] == "enum"
            ),
            None,
        )
        if invalid_enum_error is None:
            if not draft.applicability.aggregation_period or not draft.applicability.unit:
                return None, False
            raise

        qa_flags.append(
            QAFlag(
                code=QAFlagCode.INVALID_ENUM,
                detail=(
                    "Candidate Rule contains an invalid enum value for "
                    "applicability.aggregation_period: "
                    f"{draft.applicability.aggregation_period!r}."
                ),
            )
        )
        return None, True


def _resolve_citation(
    *,
    session: Session,
    document_id: str,
    document_version_id: str,
    citation_quote: str,
    fallback_quotes: list[str] = [],
    qa_flags: list[QAFlag],
) -> Citation | None:
    resolution = resolve_citation_anchor_with_fallback(
        session,
        document_id=document_id,
        document_version_id=document_version_id,
        quote=citation_quote,
        fallback_quotes=fallback_quotes,
    )
    if resolution is None:
        qa_flags.append(
            QAFlag(
                code=QAFlagCode.UNRESOLVABLE_CITATION,
                detail=(
                    "Candidate Rule Citation quote could not be resolved: "
                    f"{citation_quote!r}."
                ),
            )
        )
        return None

    if resolution.match_kind is not CitationMatchKind.EXACT:
        qa_flags.append(
            QAFlag(
                code=QAFlagCode.APPROXIMATE_CITATION,
                detail=(
                    "Candidate Rule citation was resolved via "
                    f"{resolution.match_kind.value} matching. LLM quote "
                    f"{resolution.requested_quote!r} anchored to document text "
                    f"{resolution.anchor.quote!r}."
                ),
            )
        )

    anchor = resolution.anchor
    return Citation(
        document_id=anchor.document_id,
        document_version_id=anchor.document_version_id,
        section_id=anchor.section_id,
        quote=anchor.quote,
        start_char=anchor.start_char,
        end_char=anchor.end_char,
    )


def _is_quantitative_candidate_rule(*, draft: StructuredCandidateRule) -> bool:
    if draft.enforceability_class is not EnforceabilityClass.ENFORCEABLE:
        return False
    if _QUANTITATIVE_STATEMENT_PATTERN.search(draft.statement) is not None:
        return True
    if draft.condition is None:
        return False
    return draft.condition.operator in _QUANTITATIVE_OPERATORS
