"""Add immutable Compliance Evaluation Runs table."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0015_add_compliance_evaluation_runs_table"
down_revision = "0014_add_rule_test_runs_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "compliance_evaluation_runs",
        sa.Column("compliance_evaluation_run_id", sa.String(length=200), nullable=False),
        sa.Column("expense_report_id", sa.String(length=200), nullable=False),
        sa.Column("compiled_rule_set_id", sa.String(length=200), nullable=False),
        sa.Column("policy_version_id", sa.String(length=200), nullable=False),
        sa.Column("executed_by", sa.String(length=120), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column(
            "executed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("compliance_evaluation_run_id"),
    )
    op.create_index(
        "ix_compliance_evaluation_runs_expense_report_id",
        "compliance_evaluation_runs",
        ["expense_report_id"],
    )
    op.create_index(
        "ix_compliance_evaluation_runs_compiled_rule_set_id",
        "compliance_evaluation_runs",
        ["compiled_rule_set_id"],
    )
    op.create_index(
        "ix_compliance_evaluation_runs_policy_version_id",
        "compliance_evaluation_runs",
        ["policy_version_id"],
    )
    op.create_index(
        "ix_compliance_evaluation_runs_executed_at",
        "compliance_evaluation_runs",
        ["executed_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_compliance_evaluation_runs_executed_at",
        table_name="compliance_evaluation_runs",
    )
    op.drop_index(
        "ix_compliance_evaluation_runs_policy_version_id",
        table_name="compliance_evaluation_runs",
    )
    op.drop_index(
        "ix_compliance_evaluation_runs_compiled_rule_set_id",
        table_name="compliance_evaluation_runs",
    )
    op.drop_index(
        "ix_compliance_evaluation_runs_expense_report_id",
        table_name="compliance_evaluation_runs",
    )
    op.drop_table("compliance_evaluation_runs")
