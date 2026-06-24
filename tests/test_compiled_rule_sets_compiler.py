from datetime import UTC, datetime

from policy_pipeline.compiled_rule_sets.compiler import compile_policy_version_snapshot
from policy_pipeline.compiled_rule_sets.models import CompileStatus
from policy_pipeline.compliance_evaluation_runs.evaluator import (
    EMPLOYEE_GROUP_SCOPE_V1_SKIP_REASON,
    build_unavailable_scope_skip_reason,
)
from policy_pipeline.rules.models import (
    AggregationPeriod,
    Applicability,
    EnforceabilityClass,
    LifecycleState,
    PolicyVersionSnapshot,
    Rule,
    RuleCondition,
    RuleOrigin,
    RuleOriginType,
    Scope,
)


def _build_enforceable_rule(*, rule_id: str) -> Rule:
    return Rule(
        rule_id=rule_id,
        statement="Domestic meals are capped at $75 per day.",
        enforceability_class=EnforceabilityClass.ENFORCEABLE,
        lifecycle_state=LifecycleState.PUBLISHED,
        origin=RuleOrigin(
            source_type=RuleOriginType.MANUAL,
            rationale="Manual cap for compile unit test.",
        ),
        scope=Scope(expense_category="meals"),
        condition=RuleCondition(field="meal.amount", operator="<=", value="75"),
        applicability=Applicability(
            aggregation_period=AggregationPeriod.PER_DAY,
            unit="money",
            currency="USD",
        ),
    )


def _build_guidance_rule(*, rule_id: str) -> Rule:
    return Rule(
        rule_id=rule_id,
        statement="Prefer negotiated hotel blocks when available.",
        enforceability_class=EnforceabilityClass.GUIDANCE,
        lifecycle_state=LifecycleState.PUBLISHED,
        origin=RuleOrigin(
            source_type=RuleOriginType.MANUAL,
            rationale="Guidance note.",
        ),
        scope=Scope(expense_category="lodging"),
    )


def test_compile_policy_version_snapshot_partitions_rule_statuses() -> None:
    snapshot = PolicyVersionSnapshot(
        policy_version_id="policy-v1",
        change_summary="Compile unit test snapshot.",
        published_by="admin-user",
        rules=[
            _build_enforceable_rule(rule_id="rule-enforceable"),
            _build_guidance_rule(rule_id="rule-guidance"),
        ],
    )

    compiled_rule_set = compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id="compiled-test",
        compiled_by="admin-user",
        compiled_at=datetime(2026, 6, 22, tzinfo=UTC),
    )

    assert compiled_rule_set.summary.compiled == 1
    assert compiled_rule_set.summary.skipped_non_enforceable == 1
    assert compiled_rule_set.summary.compile_error == 0
    assert compiled_rule_set.entries[0].status is CompileStatus.COMPILED
    assert compiled_rule_set.entries[1].status is CompileStatus.SKIPPED_NON_ENFORCEABLE


def test_compile_policy_version_snapshot_skips_employee_group_scoped_enforceable_rules() -> None:
    rule = _build_enforceable_rule(rule_id="rule-exec-meals")
    rule = rule.model_copy(
        update={
            "scope": Scope(
                expense_category="meals",
                country="domestic",
                employee_group="executives",
            ),
        }
    )
    snapshot = PolicyVersionSnapshot(
        policy_version_id="policy-v1",
        change_summary="Compile unit test snapshot.",
        published_by="admin-user",
        rules=[rule],
    )

    compiled_rule_set = compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id="compiled-test",
        compiled_by="admin-user",
        compiled_at=datetime(2026, 6, 22, tzinfo=UTC),
    )

    assert compiled_rule_set.summary.compiled == 0
    assert compiled_rule_set.summary.skipped_non_enforceable == 1
    assert compiled_rule_set.summary.compile_error == 0
    entry = compiled_rule_set.entries[0]
    assert entry.status is CompileStatus.SKIPPED_NON_ENFORCEABLE
    assert entry.skip_reason == EMPLOYEE_GROUP_SCOPE_V1_SKIP_REASON
    assert entry.compiled_rule is None


def test_compile_policy_version_snapshot_skips_deferred_scope_dimensions() -> None:
    rule = _build_enforceable_rule(rule_id="rule-manager-meals")
    rule = rule.model_copy(
        update={
            "scope": Scope(
                expense_category="meals",
                country="domestic",
                department="sales",
                state="CA",
            ),
        }
    )
    snapshot = PolicyVersionSnapshot(
        policy_version_id="policy-v1",
        change_summary="Compile unit test snapshot.",
        published_by="admin-user",
        rules=[rule],
    )

    compiled_rule_set = compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id="compiled-test",
        compiled_by="admin-user",
        compiled_at=datetime(2026, 6, 22, tzinfo=UTC),
    )

    assert compiled_rule_set.summary.compiled == 0
    assert compiled_rule_set.summary.skipped_non_enforceable == 1
    entry = compiled_rule_set.entries[0]
    assert entry.status is CompileStatus.SKIPPED_NON_ENFORCEABLE
    assert entry.skip_reason == build_unavailable_scope_skip_reason(
        ("department", "state")
    )
    assert entry.source_rule.scope.department == "sales"
    assert entry.compiled_rule is None


def test_compile_policy_version_snapshot_rejects_unsupported_condition_field() -> None:
    rule = _build_enforceable_rule(rule_id="rule-bad-field")
    rule = rule.model_copy(
        update={
            "condition": RuleCondition(
                field="director_approval",
                operator="==",
                value="true",
            ),
        }
    )
    snapshot = PolicyVersionSnapshot(
        policy_version_id="policy-v1",
        change_summary="Compile unit test snapshot.",
        published_by="admin-user",
        rules=[rule],
    )

    compiled_rule_set = compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id="compiled-test",
        compiled_by="admin-user",
        compiled_at=datetime(2026, 6, 22, tzinfo=UTC),
    )

    assert compiled_rule_set.summary.compile_error == 1
    assert compiled_rule_set.entries[0].status is CompileStatus.COMPILE_ERROR
    assert "director_approval" in (compiled_rule_set.entries[0].error_reason or "")


def test_compile_policy_version_snapshot_rejects_unsupported_operator() -> None:
    rule = _build_enforceable_rule(rule_id="rule-bad-operator")
    rule = rule.model_copy(
        update={
            "condition": RuleCondition(field="meal.amount", operator="contains", value="75"),
        }
    )
    snapshot = PolicyVersionSnapshot(
        policy_version_id="policy-v1",
        change_summary="Compile unit test snapshot.",
        published_by="admin-user",
        rules=[rule],
    )

    compiled_rule_set = compile_policy_version_snapshot(
        snapshot,
        compiled_rule_set_id="compiled-test",
        compiled_by="admin-user",
        compiled_at=datetime(2026, 6, 22, tzinfo=UTC),
    )

    assert compiled_rule_set.summary.compile_error == 1
    assert compiled_rule_set.entries[0].status is CompileStatus.COMPILE_ERROR
