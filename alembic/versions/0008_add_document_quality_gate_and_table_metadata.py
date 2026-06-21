"""Add Document Quality Gate and table metadata to document versions."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0008_add_document_quality_gate_and_table_metadata"
down_revision = "0007_add_document_sections_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("document_versions", sa.Column("quality_gate", sa.JSON()))
    op.add_column("document_versions", sa.Column("table_extraction", sa.JSON()))


def downgrade() -> None:
    op.drop_column("document_versions", "table_extraction")
    op.drop_column("document_versions", "quality_gate")
