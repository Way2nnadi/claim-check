from __future__ import annotations

from datetime import datetime
from functools import lru_cache
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from policy_pipeline.config import get_settings


class Base(DeclarativeBase):
    pass


class AuditEventRecord(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    action: Mapped[str] = mapped_column(sa.String(length=120), nullable=False)
    actor_subject: Mapped[str] = mapped_column(sa.String(length=120), nullable=False)
    actor_roles: Mapped[list[str]] = mapped_column(sa.JSON(), nullable=False)
    entity_type: Mapped[str] = mapped_column(sa.String(length=120), nullable=False)
    entity_id: Mapped[str] = mapped_column(sa.String(length=200), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(sa.JSON(), nullable=False, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )


class RuleRecord(Base):
    __tablename__ = "rules"

    rule_id: Mapped[str] = mapped_column(sa.String(length=200), primary_key=True)
    origin_source_type: Mapped[str] = mapped_column(sa.String(length=50), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(sa.JSON(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )


class DocumentVersionRecord(Base):
    __tablename__ = "document_versions"

    document_version_id: Mapped[str] = mapped_column(sa.String(length=200), primary_key=True)
    document_id: Mapped[str] = mapped_column(sa.String(length=200), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(sa.String(length=255), nullable=False)
    content_type: Mapped[str] = mapped_column(sa.String(length=150), nullable=False)
    storage_key: Mapped[str] = mapped_column(sa.String(length=500), nullable=False, unique=True)
    size_bytes: Mapped[int] = mapped_column(sa.Integer(), nullable=False)
    sha256: Mapped[str] = mapped_column(sa.String(length=64), nullable=False)
    retention_until: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    retention_reason: Mapped[str | None] = mapped_column(sa.String(length=500))
    deleted_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    deleted_by: Mapped[str | None] = mapped_column(sa.String(length=120))
    deletion_reason: Mapped[str | None] = mapped_column(sa.String(length=500))
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )


class DocumentSectionRecord(Base):
    __tablename__ = "document_sections"

    document_version_id: Mapped[str] = mapped_column(sa.String(length=200), primary_key=True)
    section_id: Mapped[str] = mapped_column(sa.String(length=255), primary_key=True)
    document_id: Mapped[str] = mapped_column(sa.String(length=200), nullable=False, index=True)
    heading_path: Mapped[list[str]] = mapped_column(sa.JSON(), nullable=False)
    content: Mapped[str] = mapped_column(sa.Text(), nullable=False)
    start_char: Mapped[int] = mapped_column(sa.Integer(), nullable=False)
    end_char: Mapped[int] = mapped_column(sa.Integer(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )


class PolicyVersionRecord(Base):
    __tablename__ = "policy_versions"

    policy_version_id: Mapped[str] = mapped_column(sa.String(length=200), primary_key=True)
    published_by: Mapped[str] = mapped_column(sa.String(length=120), nullable=False)
    change_summary: Mapped[str] = mapped_column(sa.String(length=500), nullable=False)
    snapshot: Mapped[dict[str, Any]] = mapped_column(sa.JSON(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )


class PromptTemplateRecord(Base):
    __tablename__ = "prompt_templates"

    prompt_template_id: Mapped[str] = mapped_column(
        sa.String(length=200),
        primary_key=True,
    )
    version: Mapped[str] = mapped_column(sa.String(length=50), primary_key=True)
    template: Mapped[str] = mapped_column(sa.Text(), nullable=False)
    description: Mapped[str | None] = mapped_column(sa.String(length=500))
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )


class ModelConfigurationRecord(Base):
    __tablename__ = "model_configurations"

    model_configuration_id: Mapped[str] = mapped_column(
        sa.String(length=200),
        primary_key=True,
    )
    version: Mapped[str] = mapped_column(sa.String(length=50), primary_key=True)
    model: Mapped[str] = mapped_column(sa.String(length=200), nullable=False)
    endpoint: Mapped[str] = mapped_column(sa.String(length=500), nullable=False)
    settings: Mapped[dict[str, Any]] = mapped_column(sa.JSON(), nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )


class ExtractionRunRecord(Base):
    __tablename__ = "extraction_runs"
    __table_args__ = (
        sa.ForeignKeyConstraint(
            ["prompt_template_id", "prompt_template_version"],
            ["prompt_templates.prompt_template_id", "prompt_templates.version"],
        ),
        sa.ForeignKeyConstraint(
            ["model_configuration_id", "model_configuration_version"],
            ["model_configurations.model_configuration_id", "model_configurations.version"],
        ),
        sa.Index("ix_extraction_runs_document_version_id", "document_version_id"),
    )

    extraction_run_id: Mapped[str] = mapped_column(sa.String(length=200), primary_key=True)
    document_version_id: Mapped[str] = mapped_column(
        sa.String(length=200),
        sa.ForeignKey("document_versions.document_version_id"),
        nullable=False,
    )
    prompt_template_id: Mapped[str] = mapped_column(sa.String(length=200), nullable=False)
    prompt_template_version: Mapped[str] = mapped_column(sa.String(length=50), nullable=False)
    model_configuration_id: Mapped[str] = mapped_column(sa.String(length=200), nullable=False)
    model_configuration_version: Mapped[str] = mapped_column(sa.String(length=50), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )


@lru_cache
def _engine_for_url(database_url: str) -> Engine:
    return sa.create_engine(database_url)


def clear_database_cache() -> None:
    _engine_for_url.cache_clear()


def get_session() -> Session:
    settings = get_settings()
    session_factory = sessionmaker(
        bind=_engine_for_url(settings.database_url),
        autoflush=False,
        expire_on_commit=False,
    )
    with session_factory() as session:
        yield session
