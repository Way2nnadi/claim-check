from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from policy_pipeline.audit.events import AuditEventListResponse, list_audit_events
from policy_pipeline.auth.auth import require_roles
from policy_pipeline.auth.identity import AuthenticatedPrincipal, Role
from policy_pipeline.shared.database import get_session

router = APIRouter()


@router.get("/audit-events", response_model=AuditEventListResponse)
def get_audit_events(
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
    entity_type: str | None = None,
    entity_id: str | None = None,
) -> AuditEventListResponse:
    del principal
    return AuditEventListResponse(
        items=list_audit_events(
            session,
            entity_type=entity_type,
            entity_id=entity_id,
        )
    )
