from __future__ import annotations

from datetime import datetime
from functools import lru_cache
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from policy_pipeline.config import get_settings


class Base(DeclarativeBase):
    pass


class AuditEventRecord(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    action: Mapped[str] = mapped_column(sa.String(length=120), nullable=False)
    actor_subject: Mapped[str] = mapped_column(sa.String(length=120), nullable=False)
    actor_roles: Mapped[list[str]] = mapped_column(sa.JSON(), nullable=False)
    entity_type: Mapped[str] = mapped_column(sa.String(length=120), nullable=False)
    entity_id: Mapped[str] = mapped_column(sa.String(length=200), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(sa.JSON(), nullable=False, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )


@lru_cache
def _engine_for_url(database_url: str) -> Engine:
    return sa.create_engine(database_url)


def clear_database_cache() -> None:
    _engine_for_url.cache_clear()


def get_session() -> Session:
    settings = get_settings()
    session_factory = sessionmaker(
        bind=_engine_for_url(settings.database_url),
        autoflush=False,
        expire_on_commit=False,
    )
    with session_factory() as session:
        yield session
