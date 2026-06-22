from __future__ import annotations

from functools import lru_cache
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from policy_pipeline.shared.config import get_settings


class Base(DeclarativeBase):
    pass


class _PostgresVectorType(sa.types.UserDefinedType):
    cache_ok = True

    def __init__(self, dimensions: int) -> None:
        self.dimensions = dimensions

    def get_col_spec(self, **_kwargs: Any) -> str:
        return f"VECTOR({self.dimensions})"


class VectorType(sa.types.TypeDecorator):
    impl = sa.JSON
    cache_ok = True

    def __init__(self, dimensions: int) -> None:
        super().__init__()
        self.dimensions = dimensions

    def load_dialect_impl(self, dialect: sa.engine.Dialect) -> sa.types.TypeEngine[Any]:
        if dialect.name == "postgresql":
            return dialect.type_descriptor(_PostgresVectorType(self.dimensions))
        return dialect.type_descriptor(sa.JSON())

    def process_bind_param(
        self,
        value: list[float] | None,
        dialect: sa.engine.Dialect,
    ) -> str | list[float] | None:
        if value is None:
            return None

        normalized = [float(component) for component in value]
        if len(normalized) != self.dimensions:
            raise ValueError(
                f"Expected {self.dimensions}-dimensional vector, got {len(normalized)}."
            )
        if dialect.name == "postgresql":
            return "[" + ",".join(f"{component:.12g}" for component in normalized) + "]"
        return normalized

    def process_result_value(
        self,
        value: str | list[float] | None,
        _dialect: sa.engine.Dialect,
    ) -> list[float] | None:
        if value is None:
            return None
        if isinstance(value, str):
            stripped = value.strip()[1:-1].strip()
            if not stripped:
                components: list[float] = []
            else:
                components = [float(component) for component in stripped.split(",")]
        else:
            components = [float(component) for component in value]
        if len(components) != self.dimensions:
            raise ValueError(
                f"Expected {self.dimensions}-dimensional vector, got {len(components)}."
            )
        return components


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
