"""Add immutable Rule Test Runs table."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0014_add_rule_test_runs_table"
down_revision = "0013_add_rule_test_cases_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rule_test_runs",
        sa.Column("rule_test_run_id", sa.String(length=200), nullable=False),
        sa.Column("compiled_rule_set_id", sa.String(length=200), nullable=False),
        sa.Column("executed_by", sa.String(length=120), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column(
            "executed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("rule_test_run_id"),
    )
    op.create_index(
        "ix_rule_test_runs_compiled_rule_set_id",
        "rule_test_runs",
        ["compiled_rule_set_id"],
    )
    op.create_index(
        "ix_rule_test_runs_executed_at",
        "rule_test_runs",
        ["executed_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_rule_test_runs_executed_at", table_name="rule_test_runs")
    op.drop_index(
        "ix_rule_test_runs_compiled_rule_set_id",
        table_name="rule_test_runs",
    )
    op.drop_table("rule_test_runs")
