from __future__ import annotations

from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from policy_pipeline.shared.database.base import Base


class RuleRecord(Base):
    __tablename__ = "rules"

    rule_id: Mapped[str] = mapped_column(sa.String(length=200), primary_key=True)
    origin_source_type: Mapped[str] = mapped_column(sa.String(length=50), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(sa.JSON(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )
