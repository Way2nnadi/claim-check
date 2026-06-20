from __future__ import annotations

from copy import deepcopy

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from policy_pipeline.database import PolicyVersionRecord, RuleRecord
from policy_pipeline.rules import LifecycleState, PolicyVersionSnapshot, Rule


class CandidateRuleNotFoundError(Exception):
    pass


class InvalidRuleLifecycleError(Exception):
    pass


class PolicyVersionConflictError(Exception):
    pass


class NoApprovedRulesError(Exception):
    pass


def approve_candidate_rule(session: Session, *, candidate_rule_id: str) -> Rule:
    record = session.get(RuleRecord, candidate_rule_id)
    if record is None:
        raise CandidateRuleNotFoundError(candidate_rule_id)
    if record.lifecycle_state != LifecycleState.IN_REVIEW.value:
        raise InvalidRuleLifecycleError(record.lifecycle_state)

    payload = deepcopy(record.payload)
    payload["lifecycle_state"] = LifecycleState.APPROVED.value
    approved_rule = Rule.model_validate(payload)

    record.lifecycle_state = approved_rule.lifecycle_state.value
    record.payload = approved_rule.model_dump(mode="json")
    return approved_rule


def publish_policy_version(
    session: Session,
    *,
    policy_version_id: str,
    change_summary: str,
    published_by: str,
) -> PolicyVersionSnapshot:
    if session.get(PolicyVersionRecord, policy_version_id) is not None:
        raise PolicyVersionConflictError(policy_version_id)

    statement: Select[tuple[RuleRecord]] = select(RuleRecord).where(
        RuleRecord.lifecycle_state == LifecycleState.APPROVED.value
    )
    statement = statement.order_by(RuleRecord.rule_id)
    approved_rule_records = session.scalars(statement).all()
    if not approved_rule_records:
        raise NoApprovedRulesError

    published_rules: list[Rule] = []
    for record in approved_rule_records:
        payload = deepcopy(record.payload)
        payload["lifecycle_state"] = LifecycleState.PUBLISHED.value
        published_rule = Rule.model_validate(payload)
        published_rules.append(published_rule)

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
