from __future__ import annotations

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool, text

from alembic import context
from policy_pipeline.config import get_settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.database_url)

target_metadata = None


def _ensure_alembic_version_table(connection) -> None:
    # Alembic defaults to version_num VARCHAR(32); our revision ids are descriptive
    # and longer than that, so ensure the version table can store them.
    connection.execute(
        text(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_name = 'alembic_version'
                ) THEN
                    CREATE TABLE alembic_version (
                        version_num VARCHAR(200) NOT NULL,
                        CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
                    );
                ELSE
                    ALTER TABLE alembic_version
                    ALTER COLUMN version_num TYPE VARCHAR(200);
                END IF;
            END $$;
            """
        )
    )


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        _ensure_alembic_version_table(connection)
        connection.commit()

        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
