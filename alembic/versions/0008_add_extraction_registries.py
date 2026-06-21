"""Add prompt template, model configuration, and extraction run registries."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0008_add_extraction_registries"
down_revision = "0007_add_document_sections_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "prompt_templates",
        sa.Column("prompt_template_id", sa.String(length=200), nullable=False),
        sa.Column("version", sa.String(length=50), nullable=False),
        sa.Column("template", sa.Text(), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("prompt_template_id", "version"),
    )
    op.create_index(
        "ix_prompt_templates_created_at",
        "prompt_templates",
        ["created_at"],
    )

    op.create_table(
        "model_configurations",
        sa.Column("model_configuration_id", sa.String(length=200), nullable=False),
        sa.Column("version", sa.String(length=50), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("endpoint", sa.String(length=500), nullable=False),
        sa.Column("settings", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("model_configuration_id", "version"),
    )
    op.create_index(
        "ix_model_configurations_created_at",
        "model_configurations",
        ["created_at"],
    )

    op.create_table(
        "extraction_runs",
        sa.Column("extraction_run_id", sa.String(length=200), nullable=False),
        sa.Column("document_version_id", sa.String(length=200), nullable=False),
        sa.Column("prompt_template_id", sa.String(length=200), nullable=False),
        sa.Column("prompt_template_version", sa.String(length=50), nullable=False),
        sa.Column("model_configuration_id", sa.String(length=200), nullable=False),
        sa.Column("model_configuration_version", sa.String(length=50), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(
            ["document_version_id"],
            ["document_versions.document_version_id"],
        ),
        sa.ForeignKeyConstraint(
            ["prompt_template_id", "prompt_template_version"],
            ["prompt_templates.prompt_template_id", "prompt_templates.version"],
        ),
        sa.ForeignKeyConstraint(
            ["model_configuration_id", "model_configuration_version"],
            ["model_configurations.model_configuration_id", "model_configurations.version"],
        ),
        sa.PrimaryKeyConstraint("extraction_run_id"),
    )
    op.create_index(
        "ix_extraction_runs_document_version_id",
        "extraction_runs",
        ["document_version_id"],
    )
    op.create_index(
        "ix_extraction_runs_created_at",
        "extraction_runs",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_extraction_runs_created_at", table_name="extraction_runs")
    op.drop_index("ix_extraction_runs_document_version_id", table_name="extraction_runs")
    op.drop_table("extraction_runs")

    op.drop_index("ix_model_configurations_created_at", table_name="model_configurations")
    op.drop_table("model_configurations")

    op.drop_index("ix_prompt_templates_created_at", table_name="prompt_templates")
    op.drop_table("prompt_templates")
