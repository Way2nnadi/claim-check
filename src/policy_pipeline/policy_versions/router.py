import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from policy_pipeline.audit.events import record_audit_event
from policy_pipeline.auth.auth import require_roles
from policy_pipeline.auth.identity import AuthenticatedPrincipal, Role
from policy_pipeline.policy_versions.store import (
    NoApprovedRulesError,
    PolicyVersionConflictError,
    PolicyVersionListResponse,
    get_policy_version_snapshot,
    list_policy_version_summaries,
    publish_policy_version,
)
from policy_pipeline.rules.models import PolicyVersionSnapshot
from policy_pipeline.shared.database import get_session

router = APIRouter()

_SNAPSHOT_FILENAME_UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def _snapshot_filename(policy_version_id: str) -> str:
    safe_stem = _SNAPSHOT_FILENAME_UNSAFE_CHARS.sub("_", policy_version_id).strip("._-")
    if not safe_stem:
        safe_stem = "policy-version"
    return f"{safe_stem}.json"


class PolicyVersionPublishRequest(BaseModel):
    policy_version_id: str = Field(min_length=1)
    change_summary: str = Field(min_length=1)


class PolicyVersionPublishResponse(BaseModel):
    policy_version_id: str
    rule_count: int
    status: str
    published_by: str


@router.get("/policy-versions", response_model=PolicyVersionListResponse)
def list_policy_versions(
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> PolicyVersionListResponse:
    del principal
    return PolicyVersionListResponse(items=list_policy_version_summaries(session))


@router.post(
    "/policy-versions",
    response_model=PolicyVersionPublishResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_policy_version(
    request: PolicyVersionPublishRequest,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> PolicyVersionPublishResponse:
    try:
        snapshot = publish_policy_version(
            session,
            policy_version_id=request.policy_version_id,
            change_summary=request.change_summary,
            published_by=principal.subject,
        )
    except PolicyVersionConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Published Policy Versions are immutable and cannot be overwritten.",
        ) from exc
    except NoApprovedRulesError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Policy Version requires at least one approved Rule.",
        ) from exc

    record_audit_event(
        session,
        action="policy_version.published",
        actor_subject=principal.subject,
        actor_roles=[role.value for role in principal.roles],
        entity_type="policy_version",
        entity_id=request.policy_version_id,
        payload={
            "change_summary": request.change_summary,
            "rule_count": len(snapshot.rules),
        },
        commit=False,
    )
    session.commit()
    return PolicyVersionPublishResponse(
        policy_version_id=snapshot.policy_version_id,
        rule_count=len(snapshot.rules),
        status="published",
        published_by=snapshot.published_by,
    )


@router.get("/policy-versions/{policy_version_id}", response_model=PolicyVersionSnapshot)
def get_policy_version(
    policy_version_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> PolicyVersionSnapshot:
    del principal
    snapshot = get_policy_version_snapshot(
        session,
        policy_version_id=policy_version_id,
    )
    if snapshot is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Policy Version was not found.",
        )
    return snapshot


@router.get("/policy-versions/{policy_version_id}/snapshot")
def export_policy_version_snapshot(
    policy_version_id: str,
    principal: Annotated[
        AuthenticatedPrincipal,
        Depends(require_roles(Role.ADMIN, Role.APPROVER, Role.VIEWER)),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> JSONResponse:
    del principal
    snapshot = get_policy_version_snapshot(
        session,
        policy_version_id=policy_version_id,
    )
    if snapshot is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Policy Version was not found.",
        )
    return JSONResponse(
        content=snapshot.model_dump(mode="json"),
        headers={
            "Content-Disposition": (
                f'attachment; filename="{_snapshot_filename(policy_version_id)}"'
            )
        },
    )
