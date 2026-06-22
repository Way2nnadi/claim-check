from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from policy_pipeline.compiled_rule_sets.compiler import compile_policy_version_snapshot
from policy_pipeline.compiled_rule_sets.models import CompiledRuleSet
from policy_pipeline.compiled_rule_sets.records import CompiledRuleSetRecord
from policy_pipeline.policy_versions.store import get_policy_version_snapshot


def compile_policy_version(
    session: Session,
    *,
    policy_version_id: str,
    compiled_by: str,
) -> tuple[CompiledRuleSet, bool]:
    existing = get_compiled_rule_set_for_policy_version(
        session,
        policy_version_id=policy_version_id,
    )
    if existing is not None:
        return existing, False

    snapshot = get_policy_version_snapshot(session, policy_version_id=policy_version_id)
    if snapshot is None:
        raise PolicyVersionNotFoundError(policy_version_id)

    compiled_at = datetime.now(UTC)
    compiled_rule_set = compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id=f"compiled-{uuid4().hex}",
        compiled_by=compiled_by,
        compiled_at=compiled_at,
    )
    session.add(
        CompiledRuleSetRecord(
            compiled_rule_set_id=compiled_rule_set.compiled_rule_set_id,
            policy_version_id=compiled_rule_set.policy_version_id,
            compiled_by=compiled_rule_set.compiled_by,
            payload=compiled_rule_set.model_dump(mode="json"),
            compiled_at=compiled_at,
        )
    )
    session.flush()
    return compiled_rule_set, True


def get_compiled_rule_set(
    session: Session,
    *,
    compiled_rule_set_id: str,
) -> CompiledRuleSet | None:
    record = session.get(CompiledRuleSetRecord, compiled_rule_set_id)
    if record is None:
        return None
    return compiled_rule_set_from_record(record)


def get_compiled_rule_set_for_policy_version(
    session: Session,
    *,
    policy_version_id: str,
) -> CompiledRuleSet | None:
    record = session.scalar(
        select(CompiledRuleSetRecord).where(
            CompiledRuleSetRecord.policy_version_id == policy_version_id
        )
    )
    if record is None:
        return None
    return compiled_rule_set_from_record(record)


def list_compiled_rule_sets(session: Session) -> list[CompiledRuleSet]:
    records = session.scalars(
        select(CompiledRuleSetRecord).order_by(
            CompiledRuleSetRecord.compiled_at.desc(),
            CompiledRuleSetRecord.compiled_rule_set_id.desc(),
        )
    ).all()
    return [compiled_rule_set_from_record(record) for record in records]


def compiled_rule_set_from_record(record: CompiledRuleSetRecord) -> CompiledRuleSet:
    compiled_at = record.compiled_at
    if compiled_at.tzinfo is None:
        compiled_at = compiled_at.replace(tzinfo=UTC)
    else:
        compiled_at = compiled_at.astimezone(UTC)
    compiled_rule_set = CompiledRuleSet.model_validate(record.payload)
    return compiled_rule_set.model_copy(update={"compiled_at": compiled_at})


class PolicyVersionNotFoundError(Exception):
    def __init__(self, policy_version_id: str) -> None:
        self.policy_version_id = policy_version_id
        super().__init__(policy_version_id)
