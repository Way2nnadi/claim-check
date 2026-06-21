from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, ValidationError, model_validator
from sqlalchemy.orm import Session

from policy_pipeline.documents import (
    get_document_version,
    list_document_sections,
    resolve_citation_anchor,
)
from policy_pipeline.extraction_registry import (
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
from policy_pipeline.rule_store import create_rule
from policy_pipeline.rules import (
    Applicability,
    Citation,
    EnforceabilityClass,
    LifecycleState,
    Rule,
    RuleCondition,
    RuleException,
    RuleOrigin,
    RuleOriginType,
    Scope,
)


class StructuredOutputRejectedError(Exception):
    def __init__(self, *, attempts: int, detail: str) -> None:
        super().__init__(detail)
        self.attempts = attempts
        self.detail = detail


class ExtractionExecutionResult(BaseModel):
    extraction_run_id: str
    document_version_id: str
    prompt_template_id: str
    prompt_template_version: str
    model_configuration_id: str
    model_configuration_version: str
    attempt_count: int
    candidate_rules: list[Rule] = Field(default_factory=list)


class _CandidateRuleDraft(BaseModel):
    statement: str = Field(min_length=1)
    enforceability_class: EnforceabilityClass
    scope: Scope
    citation_quote: str = Field(min_length=1)
    condition: RuleCondition | None = None
    applicability: Applicability | None = None
    exceptions: list[RuleException] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_candidate_rule(self) -> _CandidateRuleDraft:
        if self.enforceability_class is EnforceabilityClass.ENFORCEABLE and self.condition is None:
            raise ValueError("Enforceable Candidate Rule requires a machine-checkable condition.")
        if (
            self.enforceability_class is not EnforceabilityClass.ENFORCEABLE
            and self.condition is not None
        ):
            raise ValueError(
                "Guidance and subjective Candidate Rules must not include "
                "a machine-checkable condition."
            )
        return self


class _StructuredCandidateRules(BaseModel):
    candidate_rules: list[_CandidateRuleDraft] = Field(default_factory=list)


class FakeOpenAICompatibleAdapter:
    def __init__(self, *, responses: list[Any]) -> None:
        self._responses = list(responses)

    def extract_candidate_rules(
        self,
        *,
        prompt_template: PromptTemplate,
        model_configuration: ModelConfiguration,
        document_text: str,
        attempt: int,
    ) -> Any:
        del prompt_template
        del model_configuration
        del document_text

        if not self._responses:
            return {"candidate_rules": []}
        index = min(attempt - 1, len(self._responses) - 1)
        return self._responses[index]


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
) -> ExtractionExecutionResult:
    document_version = get_document_version(
        session,
        document_id=document_id,
        document_version_id=document_version_id,
    )
    if document_version is None:
        raise UnknownDocumentVersionError(document_version_id)

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
    document_text = "\n\n".join(section.content for section in sections)
    adapter = FakeOpenAICompatibleAdapter(
        responses=_fake_structured_outputs(model_configuration=model_configuration)
    )
    max_attempts = _max_validation_attempts(model_configuration=model_configuration)
    last_error = "Structured extraction output did not pass validation."

    for attempt in range(1, max_attempts + 1):
        raw_output = adapter.extract_candidate_rules(
            prompt_template=prompt_template,
            model_configuration=model_configuration,
            document_text=document_text,
            attempt=attempt,
        )
        try:
            candidate_rules = _materialize_candidate_rules(
                structured_output=raw_output,
                extraction_run=extraction_run,
                document_id=document_id,
                document_version_id=document_version_id,
                session=session,
            )
        except (ValidationError, ValueError) as exc:
            last_error = str(exc)
            continue

        for rule in candidate_rules:
            create_rule(session, rule=rule, commit=False)
        session.commit()
        return ExtractionExecutionResult(
            extraction_run_id=extraction_run.extraction_run_id,
            document_version_id=extraction_run.document_version_id,
            prompt_template_id=extraction_run.prompt_template_id,
            prompt_template_version=extraction_run.prompt_template_version,
            model_configuration_id=extraction_run.model_configuration_id,
            model_configuration_version=extraction_run.model_configuration_version,
            attempt_count=attempt,
            candidate_rules=candidate_rules,
        )

    session.commit()
    raise StructuredOutputRejectedError(attempts=max_attempts, detail=last_error)


def _fake_structured_outputs(*, model_configuration: ModelConfiguration) -> list[Any]:
    responses = model_configuration.settings.get("fake_structured_outputs", [])
    if isinstance(responses, list):
        return responses
    return [responses]


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
) -> list[Rule]:
    payload = _StructuredCandidateRules.model_validate(structured_output)
    candidate_rules: list[Rule] = []
    for index, draft in enumerate(payload.candidate_rules, start=1):
        anchor = resolve_citation_anchor(
            session,
            document_id=document_id,
            document_version_id=document_version_id,
            quote=draft.citation_quote,
        )
        if anchor is None:
            raise ValueError(
                "Extracted Candidate Rule requires a resolvable Citation quote: "
                f"{draft.citation_quote!r}."
            )
        candidate_rules.append(
            Rule(
                rule_id=f"{extraction_run.extraction_run_id}:{index}",
                statement=draft.statement,
                enforceability_class=draft.enforceability_class,
                lifecycle_state=LifecycleState.EXTRACTED,
                origin=RuleOrigin(
                    source_type=RuleOriginType.EXTRACTED,
                    extraction_run_id=extraction_run.extraction_run_id,
                ),
                scope=draft.scope,
                citation=Citation(
                    document_id=anchor.document_id,
                    document_version_id=anchor.document_version_id,
                    section_id=anchor.section_id,
                    quote=anchor.quote,
                    start_char=anchor.start_char,
                    end_char=anchor.end_char,
                ),
                condition=draft.condition,
                applicability=draft.applicability,
                exceptions=draft.exceptions,
            )
        )
    return candidate_rules
