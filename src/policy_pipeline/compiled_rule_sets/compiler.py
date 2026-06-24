from __future__ import annotations

from policy_pipeline.compiled_rule_sets.models import (
    CompiledExecutableRule,
    CompiledRuleEntry,
    CompiledRuleSet,
    CompiledRuleSetSummary,
    CompileStatus,
    RuleCompileEvidence,
)
from policy_pipeline.compliance_evaluation_runs.evaluator import (
    build_unavailable_scope_skip_reason,
    unavailable_v1_scope_dimensions,
)
from policy_pipeline.rule_test_cases.generator import (
    validate_condition_field,
    validate_exception_evidence,
)
from policy_pipeline.rules.models import EnforceabilityClass, PolicyVersionSnapshot, Rule

_SUPPORTED_OPERATORS = frozenset({"<=", "<", ">=", ">", "==", "!="})


def compile_policy_version_snapshot(
    snapshot: PolicyVersionSnapshot,
    *,
    compiled_rule_set_id: str,
    compiled_by: str,
    compiled_at,
) -> CompiledRuleSet:
    entries = [_compile_rule(rule) for rule in snapshot.rules]
    summary = CompiledRuleSetSummary(
        compiled=sum(1 for entry in entries if entry.status is CompileStatus.COMPILED),
        skipped_non_enforceable=sum(
            1 for entry in entries if entry.status is CompileStatus.SKIPPED_NON_ENFORCEABLE
        ),
        compile_error=sum(
            1 for entry in entries if entry.status is CompileStatus.COMPILE_ERROR
        ),
    )
    return CompiledRuleSet(
        compiled_rule_set_id=compiled_rule_set_id,
        policy_version_id=snapshot.policy_version_id,
        compiled_by=compiled_by,
        compiled_at=compiled_at,
        entries=entries,
        summary=summary,
    )


def _compile_rule(rule: Rule) -> CompiledRuleEntry:
    compile_evidence = _build_compile_evidence(rule)
    if rule.enforceability_class is EnforceabilityClass.GUIDANCE:
        return CompiledRuleEntry(
            rule_id=rule.rule_id,
            status=CompileStatus.SKIPPED_NON_ENFORCEABLE,
            source_rule=rule,
            skip_reason="Guidance Rules are not machine-checkable.",
            compile_evidence=compile_evidence,
        )
    if rule.enforceability_class is EnforceabilityClass.SUBJECTIVE:
        return CompiledRuleEntry(
            rule_id=rule.rule_id,
            status=CompileStatus.SKIPPED_NON_ENFORCEABLE,
            source_rule=rule,
            skip_reason="Subjective Rules require human judgment.",
            compile_evidence=compile_evidence,
        )

    unavailable_scope_dimensions = unavailable_v1_scope_dimensions(
        rule.scope.model_dump(mode="json")
    )
    if unavailable_scope_dimensions:
        return CompiledRuleEntry(
            rule_id=rule.rule_id,
            status=CompileStatus.SKIPPED_NON_ENFORCEABLE,
            source_rule=rule,
            skip_reason=build_unavailable_scope_skip_reason(unavailable_scope_dimensions),
            compile_evidence=compile_evidence,
        )

    error_reason = _validate_enforceable_rule(rule)
    if error_reason is not None:
        return CompiledRuleEntry(
            rule_id=rule.rule_id,
            status=CompileStatus.COMPILE_ERROR,
            source_rule=rule,
            error_reason=error_reason,
            compile_evidence=compile_evidence,
        )

    assert rule.condition is not None
    assert rule.applicability is not None
    return CompiledRuleEntry(
        rule_id=rule.rule_id,
        status=CompileStatus.COMPILED,
        source_rule=rule,
        compiled_rule=CompiledExecutableRule(
            rule_id=rule.rule_id,
            statement=rule.statement,
            scope=rule.scope.model_dump(mode="json"),
            condition=rule.condition.model_dump(mode="json"),
            applicability=rule.applicability.model_dump(mode="json"),
            exceptions=[exception.model_dump(mode="json") for exception in rule.exceptions],
            citation=rule.citation.model_dump(mode="json") if rule.citation else None,
        ),
        compile_evidence=compile_evidence,
    )


def _build_compile_evidence(rule: Rule) -> RuleCompileEvidence:
    return RuleCompileEvidence(
        rule_currency=(
            rule.applicability.currency if rule.applicability is not None else None
        ),
        effective_start_date=rule.scope.effective_start_date,
        effective_end_date=rule.scope.effective_end_date,
    )


def _validate_enforceable_rule(rule: Rule) -> str | None:
    if rule.condition is None:
        return "Enforceable Rule is missing a machine-checkable condition."
    if rule.applicability is None:
        return "Enforceable Rule is missing applicability metadata required for evaluation."
    if rule.condition.operator not in _SUPPORTED_OPERATORS:
        return (
            f"Condition operator {rule.condition.operator!r} is not supported by the "
            "Compliance Evaluator."
        )
    if not rule.condition.field.strip():
        return "Condition field must not be empty."
    field_error = validate_condition_field(rule.condition.field)
    if field_error is not None:
        return field_error
    exception_payloads = [
        exception.model_dump(mode="json") for exception in rule.exceptions
    ]
    evidence_error = validate_exception_evidence(exception_payloads)
    if evidence_error is not None:
        return evidence_error
    return None
