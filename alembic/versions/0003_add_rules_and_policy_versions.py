"""Add persisted Rules and immutable Policy Versions."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0003_add_rules_and_policy_versions"
down_revision = "0002_add_local_auth_and_audit_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rules",
        sa.Column("rule_id", sa.String(length=200), primary_key=True),
        sa.Column("origin_source_type", sa.String(length=40), nullable=False),
        sa.Column("lifecycle_state", sa.String(length=40), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index("ix_rules_lifecycle_state", "rules", ["lifecycle_state"])

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


def downgrade() -> None:
    op.drop_table("policy_versions")
    op.drop_index("ix_rules_lifecycle_state", table_name="rules")
    op.drop_table("rules")
