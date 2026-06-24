"""Add append-only Compliance Review Decisions table."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0016_add_compliance_review_decisions_table"
down_revision = "0015_add_compliance_evaluation_runs_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "compliance_review_decisions",
        sa.Column("compliance_review_decision_id", sa.String(length=200), nullable=False),
        sa.Column("evaluation_outcome_id", sa.String(length=420), nullable=False),
        sa.Column("compliance_evaluation_run_id", sa.String(length=200), nullable=False),
        sa.Column("row_index", sa.Integer(), nullable=False),
        sa.Column("resolution_type", sa.String(length=40), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("recorded_by", sa.String(length=120), nullable=False),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("compliance_review_decision_id"),
        sa.UniqueConstraint("evaluation_outcome_id"),
    )
    op.create_index(
        "ix_compliance_review_decisions_compliance_evaluation_run_id",
        "compliance_review_decisions",
        ["compliance_evaluation_run_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_compliance_review_decisions_compliance_evaluation_run_id",
        table_name="compliance_review_decisions",
    )
    op.drop_table("compliance_review_decisions")
