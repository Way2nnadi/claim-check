from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from policy_pipeline.rules.models import LifecycleState, PolicyVersionSnapshot, Rule
from policy_pipeline.shared.database import PolicyVersionRecord, RuleRecord


class PolicyVersionSummary(BaseModel):
    policy_version_id: str = Field(min_length=1)
    published_by: str = Field(min_length=1)
    change_summary: str = Field(min_length=1)
    rule_count: int = Field(ge=0)
    created_at: datetime


class PolicyVersionListResponse(BaseModel):
    items: list[PolicyVersionSummary]


class PolicyVersionConflictError(Exception):
    pass


class NoApprovedRulesError(Exception):
    pass


def publish_policy_version(
    session: Session,
    *,
    policy_version_id: str,
    change_summary: str,
    published_by: str,
) -> PolicyVersionSnapshot:
    if session.get(PolicyVersionRecord, policy_version_id) is not None:
        raise PolicyVersionConflictError(policy_version_id)

    rule_records = session.scalars(select(RuleRecord).order_by(RuleRecord.rule_id)).all()
    published_rules: list[Rule] = []
    for record in rule_records:
        if record.payload.get("lifecycle_state") not in {
            LifecycleState.APPROVED.value,
            LifecycleState.PUBLISHED.value,
        }:
            continue

        published_payload = _published_rule_payload(record)
        published_rules.append(Rule.model_validate(published_payload))
        record.payload = published_payload

    if not published_rules:
        raise NoApprovedRulesError

    snapshot = PolicyVersionSnapshot(
        policy_version_id=policy_version_id,
        change_summary=change_summary,
        published_by=published_by,
        rules=published_rules,
    )
    session.add(
        PolicyVersionRecord(
            policy_version_id=policy_version_id,
            published_by=published_by,
            change_summary=change_summary,
            snapshot=snapshot.model_dump(mode="json"),
        )
    )
    session.flush()
    return snapshot


def get_policy_version_snapshot(
    session: Session,
    *,
    policy_version_id: str,
) -> PolicyVersionSnapshot | None:
    record = session.get(PolicyVersionRecord, policy_version_id)
    if record is None:
        return None
    return PolicyVersionSnapshot.model_validate(record.snapshot)


def list_policy_version_summaries(session: Session) -> list[PolicyVersionSummary]:
    records = session.scalars(
        select(PolicyVersionRecord).order_by(
            PolicyVersionRecord.created_at.desc(),
            PolicyVersionRecord.policy_version_id.desc(),
        )
    ).all()
    summaries: list[PolicyVersionSummary] = []
    for record in records:
        snapshot = PolicyVersionSnapshot.model_validate(record.snapshot)
        created_at = record.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)
        else:
            created_at = created_at.astimezone(UTC)
        summaries.append(
            PolicyVersionSummary(
                policy_version_id=record.policy_version_id,
                published_by=record.published_by,
                change_summary=record.change_summary,
                rule_count=len(snapshot.rules),
                created_at=created_at,
            )
        )
    return summaries


def get_latest_policy_version_snapshot(session: Session) -> PolicyVersionSnapshot | None:
    record = session.scalar(
        select(PolicyVersionRecord)
        .order_by(
            PolicyVersionRecord.created_at.desc(),
            PolicyVersionRecord.policy_version_id.desc(),
        )
        .limit(1)
    )
    if record is None:
        return None
    return PolicyVersionSnapshot.model_validate(record.snapshot)


def _published_rule_payload(record: RuleRecord) -> dict[str, object]:
    payload = deepcopy(record.payload)
    payload["lifecycle_state"] = LifecycleState.PUBLISHED.value

    committed_rule = payload.get("committed_rule")
    if isinstance(committed_rule, dict):
        committed_rule["lifecycle_state"] = LifecycleState.PUBLISHED.value

    return payload
