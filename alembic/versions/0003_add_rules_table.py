"""Add persisted Rules table."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0003_add_rules_table"
down_revision = "0002_add_local_auth_and_audit_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rules",
        sa.Column("rule_id", sa.String(length=200), primary_key=True),
        sa.Column("origin_source_type", sa.String(length=50), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index("ix_rules_origin_source_type", "rules", ["origin_source_type"])


def downgrade() -> None:
    op.drop_index("ix_rules_origin_source_type", table_name="rules")
    op.drop_table("rules")
