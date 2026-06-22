from __future__ import annotations

from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from policy_pipeline.shared.database.base import Base


class ExpenseReportRecord(Base):
    __tablename__ = "expense_reports"

    expense_report_id: Mapped[str] = mapped_column(sa.String(length=200), primary_key=True)
    imported_by: Mapped[str] = mapped_column(sa.String(length=120), nullable=False)
    source_filename: Mapped[str] = mapped_column(sa.String(length=255), nullable=False)
    row_count: Mapped[int] = mapped_column(sa.Integer(), nullable=False)
    rows: Mapped[list[dict[str, Any]]] = mapped_column(sa.JSON(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )
