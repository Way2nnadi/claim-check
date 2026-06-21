"""Add pgvector-backed Document Section embeddings."""

from __future__ import annotations

from alembic import op

revision = "0010_add_document_section_embeddings"
down_revision = "0009_add_extraction_registries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE document_section_embeddings (
            document_version_id VARCHAR(200) NOT NULL,
            section_id VARCHAR(255) NOT NULL,
            document_id VARCHAR(200) NOT NULL,
            embedding VECTOR(16) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (document_version_id, section_id),
            FOREIGN KEY (document_version_id, section_id)
                REFERENCES document_sections (document_version_id, section_id)
        )
        """
    )
    op.create_index(
        "ix_document_section_embeddings_document_id",
        "document_section_embeddings",
        ["document_id"],
    )
    op.execute(
        """
        CREATE INDEX ix_document_section_embeddings_embedding
        ON document_section_embeddings
        USING ivfflat (embedding vector_cosine_ops)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX ix_document_section_embeddings_embedding")
    op.drop_index(
        "ix_document_section_embeddings_document_id",
        table_name="document_section_embeddings",
    )
    op.drop_table("document_section_embeddings")
