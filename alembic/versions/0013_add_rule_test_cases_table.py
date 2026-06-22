"""Add immutable Rule Test Cases table."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0013_add_rule_test_cases_table"
down_revision = "0012_add_compiled_rule_sets_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rule_test_cases",
        sa.Column("rule_test_case_id", sa.String(length=200), nullable=False),
        sa.Column("compiled_rule_set_id", sa.String(length=200), nullable=False),
        sa.Column("rule_id", sa.String(length=200), nullable=False),
        sa.Column("generated_by", sa.String(length=120), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("rule_test_case_id"),
    )
    op.create_index(
        "ix_rule_test_cases_compiled_rule_set_id",
        "rule_test_cases",
        ["compiled_rule_set_id"],
    )
    op.create_index(
        "ix_rule_test_cases_generated_at",
        "rule_test_cases",
        ["generated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_rule_test_cases_generated_at", table_name="rule_test_cases")
    op.drop_index(
        "ix_rule_test_cases_compiled_rule_set_id",
        table_name="rule_test_cases",
    )
    op.drop_table("rule_test_cases")
