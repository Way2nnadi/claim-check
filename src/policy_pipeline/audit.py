from __future__ import annotations

from typing import Any

from pydantic import BaseModel
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from policy_pipeline.database import AuditEventRecord


class AuditEventItem(BaseModel):
    action: str
    actor_subject: str
    actor_roles: list[str]
    entity_type: str
    entity_id: str
    payload: dict[str, Any]


class AuditEventListResponse(BaseModel):
    items: list[AuditEventItem]


def record_audit_event(
    session: Session,
    *,
    action: str,
    actor_subject: str,
    actor_roles: list[str],
    entity_type: str,
    entity_id: str,
    payload: dict[str, Any],
) -> AuditEventRecord:
    record = AuditEventRecord(
        action=action,
        actor_subject=actor_subject,
        actor_roles=actor_roles,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=payload,
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def list_audit_events(
    session: Session,
    *,
    entity_type: str | None = None,
    entity_id: str | None = None,
) -> list[AuditEventItem]:
    statement: Select[tuple[AuditEventRecord]] = select(AuditEventRecord)
    statement = statement.order_by(AuditEventRecord.id)
    if entity_type is not None:
        statement = statement.where(AuditEventRecord.entity_type == entity_type)
    if entity_id is not None:
        statement = statement.where(AuditEventRecord.entity_id == entity_id)

    items = session.scalars(statement).all()
    return [
        AuditEventItem(
            action=item.action,
            actor_subject=item.actor_subject,
            actor_roles=item.actor_roles,
            entity_type=item.entity_type,
            entity_id=item.entity_id,
            payload=item.payload,
        )
        for item in items
    ]
