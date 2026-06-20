from io import StringIO
from pathlib import Path

from alembic.config import Config

from alembic import command


def test_head_migration_bootstraps_postgres_and_pgvector() -> None:
    project_root = Path(__file__).resolve().parents[1]
    alembic_config = Config(str(project_root / "alembic.ini"))
    alembic_config.set_main_option("script_location", str(project_root / "alembic"))
    alembic_config.output_buffer = StringIO()

    command.upgrade(alembic_config, "head", sql=True)

    sql = alembic_config.output_buffer.getvalue()

    assert "CREATE EXTENSION IF NOT EXISTS vector" in sql
    assert "CREATE TABLE service_metadata" in sql
    assert "CREATE TABLE audit_events" in sql
