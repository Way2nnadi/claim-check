"""Add retention and deletion governance fields to document versions."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0006_add_document_retention_and_deletion_fields"
down_revision = "0005_add_policy_versions_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("document_versions", sa.Column("retention_until", sa.DateTime(timezone=True)))
    op.add_column("document_versions", sa.Column("retention_reason", sa.String(length=500)))
    op.add_column("document_versions", sa.Column("deleted_at", sa.DateTime(timezone=True)))
    op.add_column("document_versions", sa.Column("deleted_by", sa.String(length=120)))
    op.add_column("document_versions", sa.Column("deletion_reason", sa.String(length=500)))


def downgrade() -> None:
    op.drop_column("document_versions", "deletion_reason")
    op.drop_column("document_versions", "deleted_by")
    op.drop_column("document_versions", "deleted_at")
    op.drop_column("document_versions", "retention_reason")
    op.drop_column("document_versions", "retention_until")
