from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import Select, exists, select
from sqlalchemy.orm import Session

from policy_pipeline.database import (
    DocumentVersionRecord,
    ExtractionRunRecord,
    ModelConfigurationRecord,
    PromptTemplateRecord,
)


class RegistryRecordInUseError(Exception):
    pass


class ExtractionRunConflictError(Exception):
    pass


class UnknownDocumentVersionError(Exception):
    pass


class UnknownPromptTemplateVersionError(Exception):
    pass


class UnknownModelConfigurationVersionError(Exception):
    pass


class PromptTemplate(BaseModel):
    prompt_template_id: str = Field(min_length=1)
    version: str = Field(min_length=1)
    template: str = Field(min_length=1)
    description: str | None = None


class ModelConfiguration(BaseModel):
    model_configuration_id: str = Field(min_length=1)
    version: str = Field(min_length=1)
    model: str = Field(min_length=1)
    endpoint: str = Field(min_length=1)
    settings: dict[str, Any] = Field(default_factory=dict)


class ExtractionRun(BaseModel):
    extraction_run_id: str = Field(min_length=1)
    document_version_id: str = Field(min_length=1)
    prompt_template_id: str = Field(min_length=1)
    prompt_template_version: str = Field(min_length=1)
    model_configuration_id: str = Field(min_length=1)
    model_configuration_version: str = Field(min_length=1)


def _build_prompt_template(
    *,
    prompt_template_id: str,
    version: str,
    template: str,
    description: str | None,
) -> PromptTemplate:
    return PromptTemplate(
        prompt_template_id=prompt_template_id,
        version=version,
        template=template,
        description=description,
    )


def _build_model_configuration(
    *,
    model_configuration_id: str,
    version: str,
    model: str,
    endpoint: str,
    settings: dict[str, Any],
) -> ModelConfiguration:
    return ModelConfiguration(
        model_configuration_id=model_configuration_id,
        version=version,
        model=model,
        endpoint=endpoint,
        settings=settings,
    )


def _build_extraction_run(
    *,
    extraction_run_id: str,
    document_version_id: str,
    prompt_template_id: str,
    prompt_template_version: str,
    model_configuration_id: str,
    model_configuration_version: str,
) -> ExtractionRun:
    return ExtractionRun(
        extraction_run_id=extraction_run_id,
        document_version_id=document_version_id,
        prompt_template_id=prompt_template_id,
        prompt_template_version=prompt_template_version,
        model_configuration_id=model_configuration_id,
        model_configuration_version=model_configuration_version,
    )


def _prompt_template_in_use(
    session: Session,
    *,
    prompt_template_id: str,
    version: str,
) -> bool:
    statement = select(
        exists().where(
            ExtractionRunRecord.prompt_template_id == prompt_template_id,
            ExtractionRunRecord.prompt_template_version == version,
        )
    )
    return bool(session.scalar(statement))


def _model_configuration_in_use(
    session: Session,
    *,
    model_configuration_id: str,
    version: str,
) -> bool:
    statement = select(
        exists().where(
            ExtractionRunRecord.model_configuration_id == model_configuration_id,
            ExtractionRunRecord.model_configuration_version == version,
        )
    )
    return bool(session.scalar(statement))


def save_prompt_template(
    session: Session,
    *,
    prompt_template_id: str,
    version: str,
    template: str,
    description: str | None = None,
    commit: bool = True,
) -> PromptTemplate:
    prompt_template = _build_prompt_template(
        prompt_template_id=prompt_template_id,
        version=version,
        template=template,
        description=description,
    )

    record = session.get(
        PromptTemplateRecord,
        (prompt_template.prompt_template_id, prompt_template.version),
    )
    if record is None:
        record = PromptTemplateRecord(
            prompt_template_id=prompt_template.prompt_template_id,
            version=prompt_template.version,
            template=prompt_template.template,
            description=prompt_template.description,
        )
        session.add(record)
    else:
        if _prompt_template_in_use(
            session,
            prompt_template_id=prompt_template.prompt_template_id,
            version=prompt_template.version,
        ):
            raise RegistryRecordInUseError(
                "Prompt Template "
                f"{prompt_template.prompt_template_id}@{prompt_template.version} "
                "is pinned by an Extraction Run."
            )
        record.template = prompt_template.template
        record.description = prompt_template.description

    session.flush()
    if commit:
        session.commit()
    return prompt_template


def get_prompt_template(
    session: Session,
    *,
    prompt_template_id: str,
    version: str,
) -> PromptTemplate | None:
    record = session.get(PromptTemplateRecord, (prompt_template_id, version))
    if record is None:
        return None
    return prompt_template_from_record(record)


def prompt_template_from_record(record: PromptTemplateRecord) -> PromptTemplate:
    return PromptTemplate(
        prompt_template_id=record.prompt_template_id,
        version=record.version,
        template=record.template,
        description=record.description,
    )


def save_model_configuration(
    session: Session,
    *,
    model_configuration_id: str,
    version: str,
    model: str,
    endpoint: str,
    settings: dict[str, Any],
    commit: bool = True,
) -> ModelConfiguration:
    model_configuration = _build_model_configuration(
        model_configuration_id=model_configuration_id,
        version=version,
        model=model,
        endpoint=endpoint,
        settings=settings,
    )

    record = session.get(
        ModelConfigurationRecord,
        (
            model_configuration.model_configuration_id,
            model_configuration.version,
        ),
    )
    if record is None:
        record = ModelConfigurationRecord(
            model_configuration_id=model_configuration.model_configuration_id,
            version=model_configuration.version,
            model=model_configuration.model,
            endpoint=model_configuration.endpoint,
            settings=model_configuration.settings,
        )
        session.add(record)
    else:
        if _model_configuration_in_use(
            session,
            model_configuration_id=model_configuration.model_configuration_id,
            version=model_configuration.version,
        ):
            raise RegistryRecordInUseError(
                "Model Configuration "
                f"{model_configuration.model_configuration_id}@"
                f"{model_configuration.version} is pinned by an Extraction Run."
            )
        record.model = model_configuration.model
        record.endpoint = model_configuration.endpoint
        record.settings = model_configuration.settings

    session.flush()
    if commit:
        session.commit()
    return model_configuration


def get_model_configuration(
    session: Session,
    *,
    model_configuration_id: str,
    version: str,
) -> ModelConfiguration | None:
    record = session.get(ModelConfigurationRecord, (model_configuration_id, version))
    if record is None:
        return None
    return model_configuration_from_record(record)


def model_configuration_from_record(
    record: ModelConfigurationRecord,
) -> ModelConfiguration:
    return ModelConfiguration(
        model_configuration_id=record.model_configuration_id,
        version=record.version,
        model=record.model,
        endpoint=record.endpoint,
        settings=dict(record.settings),
    )


def create_extraction_run(
    session: Session,
    *,
    extraction_run_id: str,
    document_version_id: str,
    prompt_template_id: str,
    prompt_template_version: str,
    model_configuration_id: str,
    model_configuration_version: str,
    commit: bool = True,
) -> ExtractionRun:
    extraction_run = _build_extraction_run(
        extraction_run_id=extraction_run_id,
        document_version_id=document_version_id,
        prompt_template_id=prompt_template_id,
        prompt_template_version=prompt_template_version,
        model_configuration_id=model_configuration_id,
        model_configuration_version=model_configuration_version,
    )

    if session.get(ExtractionRunRecord, extraction_run.extraction_run_id) is not None:
        raise ExtractionRunConflictError(extraction_run.extraction_run_id)

    if session.get(DocumentVersionRecord, extraction_run.document_version_id) is None:
        raise UnknownDocumentVersionError(extraction_run.document_version_id)

    prompt_template = session.get(
        PromptTemplateRecord,
        (
            extraction_run.prompt_template_id,
            extraction_run.prompt_template_version,
        ),
    )
    if prompt_template is None:
        raise UnknownPromptTemplateVersionError(
            f"{extraction_run.prompt_template_id}@{extraction_run.prompt_template_version}"
        )

    model_configuration = session.get(
        ModelConfigurationRecord,
        (
            extraction_run.model_configuration_id,
            extraction_run.model_configuration_version,
        ),
    )
    if model_configuration is None:
        raise UnknownModelConfigurationVersionError(
            f"{extraction_run.model_configuration_id}@"
            f"{extraction_run.model_configuration_version}"
        )

    record = ExtractionRunRecord(
        extraction_run_id=extraction_run.extraction_run_id,
        document_version_id=extraction_run.document_version_id,
        prompt_template_id=prompt_template.prompt_template_id,
        prompt_template_version=prompt_template.version,
        model_configuration_id=model_configuration.model_configuration_id,
        model_configuration_version=model_configuration.version,
    )
    session.add(record)
    session.flush()
    if commit:
        session.commit()
    return extraction_run


def list_extraction_runs_for_prompt_template(
    session: Session,
    *,
    prompt_template_id: str,
    version: str,
) -> list[ExtractionRun]:
    statement: Select[tuple[ExtractionRunRecord]] = select(ExtractionRunRecord).where(
        ExtractionRunRecord.prompt_template_id == prompt_template_id,
        ExtractionRunRecord.prompt_template_version == version,
    )
    return [extraction_run_from_record(record) for record in session.scalars(statement)]


def extraction_run_from_record(record: ExtractionRunRecord) -> ExtractionRun:
    return ExtractionRun(
        extraction_run_id=record.extraction_run_id,
        document_version_id=record.document_version_id,
        prompt_template_id=record.prompt_template_id,
        prompt_template_version=record.prompt_template_version,
        model_configuration_id=record.model_configuration_id,
        model_configuration_version=record.model_configuration_version,
    )
