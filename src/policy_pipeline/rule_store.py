from __future__ import annotations

from sqlalchemy.orm import Session

from policy_pipeline.database import RuleRecord
from policy_pipeline.rules import CandidateRule, Rule


def create_rule(session: Session, *, rule: Rule | CandidateRule, commit: bool = True) -> RuleRecord:
    record = RuleRecord(
        rule_id=rule.rule_id,
        origin_source_type=rule.origin.source_type.value,
        payload=rule.model_dump(mode="json"),
    )
    session.add(record)
    session.flush()
    if commit:
        session.commit()
        session.refresh(record)
    return record
