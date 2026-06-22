"""Add immutable Expense Reports table."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0011_add_expense_reports_table"
down_revision = "0010_add_document_section_embeddings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "expense_reports",
        sa.Column("expense_report_id", sa.String(length=200), nullable=False),
        sa.Column("imported_by", sa.String(length=120), nullable=False),
        sa.Column("source_filename", sa.String(length=255), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("rows", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("expense_report_id"),
    )
    op.create_index(
        "ix_expense_reports_created_at",
        "expense_reports",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_expense_reports_created_at", table_name="expense_reports")
    op.drop_table("expense_reports")
