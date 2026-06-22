from __future__ import annotations

from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from policy_pipeline.shared.database.base import Base, VectorType


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
    quality_gate: Mapped[dict[str, Any] | None] = mapped_column(sa.JSON())
    table_extraction: Mapped[dict[str, Any] | None] = mapped_column(sa.JSON())
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


class DocumentSectionEmbeddingRecord(Base):
    __tablename__ = "document_section_embeddings"
    __table_args__ = (
        sa.ForeignKeyConstraint(
            ["document_version_id", "section_id"],
            ["document_sections.document_version_id", "document_sections.section_id"],
        ),
        sa.Index("ix_document_section_embeddings_document_id", "document_id"),
    )

    document_version_id: Mapped[str] = mapped_column(sa.String(length=200), primary_key=True)
    section_id: Mapped[str] = mapped_column(sa.String(length=255), primary_key=True)
    document_id: Mapped[str] = mapped_column(sa.String(length=200), nullable=False)
    embedding: Mapped[list[float]] = mapped_column(VectorType(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )
