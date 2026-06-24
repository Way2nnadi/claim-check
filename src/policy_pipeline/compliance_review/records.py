from __future__ import annotations

from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from policy_pipeline.shared.database.base import Base


class ComplianceReviewDecisionRecord(Base):
    __tablename__ = "compliance_review_decisions"

    compliance_review_decision_id: Mapped[str] = mapped_column(
        sa.String(length=200),
        primary_key=True,
    )
    evaluation_outcome_id: Mapped[str] = mapped_column(
        sa.String(length=420),
        nullable=False,
        unique=True,
    )
    compliance_evaluation_run_id: Mapped[str] = mapped_column(
        sa.String(length=200),
        nullable=False,
        index=True,
    )
    row_index: Mapped[int] = mapped_column(sa.Integer(), nullable=False)
    resolution_type: Mapped[str] = mapped_column(sa.String(length=40), nullable=False)
    rationale: Mapped[str] = mapped_column(sa.Text(), nullable=False)
    recorded_by: Mapped[str] = mapped_column(sa.String(length=120), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )
    payload: Mapped[dict[str, Any]] = mapped_column(sa.JSON(), nullable=False)
