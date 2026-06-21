"""Add parsed Document Sections table."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0007_add_document_sections_table"
down_revision = "0006_add_document_retention_and_deletion_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "document_sections",
        sa.Column("document_version_id", sa.String(length=200), nullable=False),
        sa.Column("section_id", sa.String(length=255), nullable=False),
        sa.Column("document_id", sa.String(length=200), nullable=False),
        sa.Column("heading_path", sa.JSON(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("start_char", sa.Integer(), nullable=False),
        sa.Column("end_char", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("document_version_id", "section_id"),
    )
    op.create_index("ix_document_sections_document_id", "document_sections", ["document_id"])


def downgrade() -> None:
    op.drop_index("ix_document_sections_document_id", table_name="document_sections")
    op.drop_table("document_sections")
