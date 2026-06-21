"""Add immutable Policy Versions table."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0005_add_policy_versions_table"
down_revision = "0004_add_document_versions_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "policy_versions",
        sa.Column("policy_version_id", sa.String(length=200), primary_key=True),
        sa.Column("published_by", sa.String(length=120), nullable=False),
        sa.Column("change_summary", sa.String(length=500), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index("ix_policy_versions_created_at", "policy_versions", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_policy_versions_created_at", table_name="policy_versions")
    op.drop_table("policy_versions")
