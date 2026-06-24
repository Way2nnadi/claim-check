from __future__ import annotations

from sqlalchemy.orm import Session

from policy_pipeline.rule_test_cases.runner import list_rule_test_runs
from policy_pipeline.rule_test_cases.store import list_active_rule_test_cases


class RuleTestRunGateBlockedError(Exception):
    def __init__(
        self,
        compiled_rule_set_id: str,
        *,
        reason: str,
        rule_test_run_id: str | None = None,
    ) -> None:
        self.compiled_rule_set_id = compiled_rule_set_id
        self.reason = reason
        self.rule_test_run_id = rule_test_run_id
        super().__init__(compiled_rule_set_id)


def assert_rule_test_run_gate_passed(
    session: Session,
    *,
    compiled_rule_set_id: str,
) -> None:
    active_cases = list_active_rule_test_cases(
        session,
        compiled_rule_set_id=compiled_rule_set_id,
    )
    if not active_cases:
        return

    runs = list_rule_test_runs(
        session,
        compiled_rule_set_id=compiled_rule_set_id,
    )
    if not runs:
        raise RuleTestRunGateBlockedError(
            compiled_rule_set_id,
            reason="missing",
        )

    latest = runs[0]
    if not latest.summary.overall_passed:
        raise RuleTestRunGateBlockedError(
            compiled_rule_set_id,
            reason="failed",
            rule_test_run_id=latest.rule_test_run_id,
        )
