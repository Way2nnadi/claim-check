from __future__ import annotations

from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from policy_pipeline.shared.database.base import Base


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
