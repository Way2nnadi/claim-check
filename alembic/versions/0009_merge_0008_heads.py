"""Merge the parallel 0008 migration heads."""

from __future__ import annotations

revision = "0009_merge_0008_heads"
down_revision = (
    "0008_add_document_quality_gate_and_table_metadata",
    "0009_add_extraction_registries",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
