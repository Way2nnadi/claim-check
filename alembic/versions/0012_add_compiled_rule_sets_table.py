"""Add immutable Compiled Rule Sets table."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0012_add_compiled_rule_sets_table"
down_revision = "0011_add_expense_reports_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "compiled_rule_sets",
        sa.Column("compiled_rule_set_id", sa.String(length=200), nullable=False),
        sa.Column("policy_version_id", sa.String(length=200), nullable=False),
        sa.Column("compiled_by", sa.String(length=120), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column(
            "compiled_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("compiled_rule_set_id"),
        sa.UniqueConstraint("policy_version_id"),
    )
    op.create_index(
        "ix_compiled_rule_sets_compiled_at",
        "compiled_rule_sets",
        ["compiled_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_compiled_rule_sets_compiled_at", table_name="compiled_rule_sets")
    op.drop_table("compiled_rule_sets")
