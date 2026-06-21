from __future__ import annotations

from copy import deepcopy

from sqlalchemy import select
from sqlalchemy.orm import Session

from policy_pipeline.database import PolicyVersionRecord, RuleRecord
from policy_pipeline.rules import LifecycleState, PolicyVersionSnapshot, Rule


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
        rule = Rule.model_validate(record.payload)
        if rule.lifecycle_state is not LifecycleState.APPROVED:
            continue

        published_payload = deepcopy(record.payload)
        published_payload["lifecycle_state"] = LifecycleState.PUBLISHED.value
        published_rules.append(Rule.model_validate(published_payload))

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
