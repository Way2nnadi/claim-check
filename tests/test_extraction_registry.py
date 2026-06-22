from __future__ import annotations

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from policy_pipeline.extraction.registry import (
    RegistryRecordInUseError,
    create_extraction_run,
    get_model_configuration,
    get_prompt_template,
    save_model_configuration,
    save_prompt_template,
)
from policy_pipeline.shared.database import (
    Base,
    DocumentVersionRecord,
    ExtractionRunRecord,
    ModelConfigurationRecord,
    PromptTemplateRecord,
)


def _seed_document_version(session: Session) -> None:
    session.add(
        DocumentVersionRecord(
            document_version_id="docv-expense-policy-v1",
            document_id="expense-policy",
            filename="expense-policy.pdf",
            content_type="application/pdf",
            storage_key="policy-documents/expense-policy/docv-expense-policy-v1/expense-policy.pdf",
            size_bytes=128,
            sha256="a" * 64,
        )
    )
    session.flush()


def test_registry_returns_requested_explicit_versions() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        save_prompt_template(
            session,
            prompt_template_id="rule-extraction",
            version="v1",
            template="Extract candidate Rules from the Policy Document.",
            description="Initial extraction prompt.",
        )
        save_prompt_template(
            session,
            prompt_template_id="rule-extraction",
            version="v2",
            template="Extract atomic candidate Rules with Citation anchors.",
            description="Adds stricter citation wording.",
        )
        save_model_configuration(
            session,
            model_configuration_id="openai-primary",
            version="v1",
            model="gpt-5-mini",
            endpoint="https://llm.internal/v1/chat/completions",
            settings={"temperature": 0, "max_output_tokens": 2000},
        )
        save_model_configuration(
            session,
            model_configuration_id="openai-primary",
            version="v2",
            model="gpt-5",
            endpoint="https://llm.internal/v2/responses",
            settings={"temperature": 0, "reasoning": {"effort": "medium"}},
        )

        prompt_template = get_prompt_template(
            session,
            prompt_template_id="rule-extraction",
            version="v2",
        )
        model_configuration = get_model_configuration(
            session,
            model_configuration_id="openai-primary",
            version="v1",
        )

    assert prompt_template is not None
    assert prompt_template.template == "Extract atomic candidate Rules with Citation anchors."
    assert prompt_template.description == "Adds stricter citation wording."

    assert model_configuration is not None
    assert model_configuration.model == "gpt-5-mini"
    assert model_configuration.endpoint == "https://llm.internal/v1/chat/completions"
    assert model_configuration.settings == {"temperature": 0, "max_output_tokens": 2000}


def test_prompt_template_version_becomes_immutable_after_extraction_run_pin() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        _seed_document_version(session)
        save_prompt_template(
            session,
            prompt_template_id="rule-extraction",
            version="v1",
            template="Extract candidate Rules from the Policy Document.",
            description="Initial extraction prompt.",
        )
        save_model_configuration(
            session,
            model_configuration_id="openai-primary",
            version="v1",
            model="gpt-5-mini",
            endpoint="https://llm.internal/v1/chat/completions",
            settings={"temperature": 0},
        )

        save_prompt_template(
            session,
            prompt_template_id="rule-extraction",
            version="v1",
            template="Extract candidate Rules with enforceability classes.",
            description="Unused versions may be reseeded in place.",
        )
        create_extraction_run(
            session,
            extraction_run_id="extract-expense-policy-v1",
            document_version_id="docv-expense-policy-v1",
            prompt_template_id="rule-extraction",
            prompt_template_version="v1",
            model_configuration_id="openai-primary",
            model_configuration_version="v1",
        )

        prompt_template = get_prompt_template(
            session,
            prompt_template_id="rule-extraction",
            version="v1",
        )

        with pytest.raises(RegistryRecordInUseError):
            save_prompt_template(
                session,
                prompt_template_id="rule-extraction",
                version="v1",
                template="Attempted overwrite after Extraction Run pin.",
                description="Should be rejected once pinned.",
            )

    assert prompt_template is not None
    assert prompt_template.template == "Extract candidate Rules with enforceability classes."


def test_model_configuration_version_becomes_immutable_after_extraction_run_pin() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        _seed_document_version(session)
        save_prompt_template(
            session,
            prompt_template_id="rule-extraction",
            version="v1",
            template="Extract candidate Rules from the Policy Document.",
            description="Initial extraction prompt.",
        )
        save_model_configuration(
            session,
            model_configuration_id="openai-primary",
            version="v1",
            model="gpt-5-mini",
            endpoint="https://llm.internal/v1/chat/completions",
            settings={"temperature": 0},
        )

        save_model_configuration(
            session,
            model_configuration_id="openai-primary",
            version="v1",
            model="gpt-5-mini",
            endpoint="https://llm.internal/v1/responses",
            settings={"temperature": 0, "max_output_tokens": 2000},
        )
        create_extraction_run(
            session,
            extraction_run_id="extract-expense-policy-v1",
            document_version_id="docv-expense-policy-v1",
            prompt_template_id="rule-extraction",
            prompt_template_version="v1",
            model_configuration_id="openai-primary",
            model_configuration_version="v1",
        )

        model_configuration = get_model_configuration(
            session,
            model_configuration_id="openai-primary",
            version="v1",
        )

        with pytest.raises(RegistryRecordInUseError):
            save_model_configuration(
                session,
                model_configuration_id="openai-primary",
                version="v1",
                model="gpt-5",
                endpoint="https://llm.internal/v2/responses",
                settings={"temperature": 0, "reasoning": {"effort": "high"}},
            )

    assert model_configuration is not None
    assert model_configuration.endpoint == "https://llm.internal/v1/responses"
    assert model_configuration.settings == {
        "temperature": 0,
        "max_output_tokens": 2000,
    }


def test_invalid_prompt_template_is_rejected_before_persistence() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        with pytest.raises(ValidationError, match="String should have at least 1 character"):
            save_prompt_template(
                session,
                prompt_template_id="rule-extraction",
                version="v1",
                template="",
            )

        prompt_templates = session.scalars(select(PromptTemplateRecord)).all()

    assert prompt_templates == []


def test_invalid_model_configuration_is_rejected_before_persistence() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        with pytest.raises(ValidationError, match="String should have at least 1 character"):
            save_model_configuration(
                session,
                model_configuration_id="openai-primary",
                version="v1",
                model="",
                endpoint="https://llm.internal/v1/chat/completions",
                settings={"temperature": 0},
            )

        model_configurations = session.scalars(select(ModelConfigurationRecord)).all()

    assert model_configurations == []


def test_invalid_extraction_run_is_rejected_before_persistence() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        _seed_document_version(session)
        save_prompt_template(
            session,
            prompt_template_id="rule-extraction",
            version="v1",
            template="Extract candidate Rules from the Policy Document.",
            description="Initial extraction prompt.",
        )
        save_model_configuration(
            session,
            model_configuration_id="openai-primary",
            version="v1",
            model="gpt-5-mini",
            endpoint="https://llm.internal/v1/chat/completions",
            settings={"temperature": 0},
        )

        with pytest.raises(ValidationError, match="String should have at least 1 character"):
            create_extraction_run(
                session,
                extraction_run_id="",
                document_version_id="docv-expense-policy-v1",
                prompt_template_id="rule-extraction",
                prompt_template_version="v1",
                model_configuration_id="openai-primary",
                model_configuration_version="v1",
            )

        extraction_runs = session.scalars(select(ExtractionRunRecord)).all()

    assert extraction_runs == []
