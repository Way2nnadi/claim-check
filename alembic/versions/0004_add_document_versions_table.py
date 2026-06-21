"""Add immutable Document Versions table."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0004_add_document_versions_table"
down_revision = "0003_add_rules_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "document_versions",
        sa.Column("document_version_id", sa.String(length=200), primary_key=True),
        sa.Column("document_id", sa.String(length=200), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=150), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index("ix_document_versions_document_id", "document_versions", ["document_id"])
    op.create_index(
        "ix_document_versions_storage_key",
        "document_versions",
        ["storage_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_document_versions_storage_key", table_name="document_versions")
    op.drop_index("ix_document_versions_document_id", table_name="document_versions")
    op.drop_table("document_versions")
