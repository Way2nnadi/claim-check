from __future__ import annotations

from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from policy_pipeline.shared.database.base import Base


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
