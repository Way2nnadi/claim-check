from __future__ import annotations

from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from policy_pipeline.shared.database.base import Base


class PolicyVersionRecord(Base):
    __tablename__ = "policy_versions"

    policy_version_id: Mapped[str] = mapped_column(sa.String(length=200), primary_key=True)
    published_by: Mapped[str] = mapped_column(sa.String(length=120), nullable=False)
    change_summary: Mapped[str] = mapped_column(sa.String(length=500), nullable=False)
    snapshot: Mapped[dict[str, Any]] = mapped_column(sa.JSON(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )
