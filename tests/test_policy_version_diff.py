import pytest

from policy_pipeline.policy_versions.diff import diff_candidate_rules_against_current_policy_version
from policy_pipeline.rules.models import (
    Applicability,
    CandidateRule,
    Citation,
    EnforceabilityClass,
    LifecycleState,
    PolicyVersionSnapshot,
    Rule,
    RuleCondition,
    RuleException,
    RuleOrigin,
    RuleOriginType,
    Scope,
)


def _build_published_rule(
    *,
    rule_id: str,
    statement: str,
    document_version_id: str = "docv-old",
    section_id: str = "meals#domestic",
    start_char: int = 10,
    end_char: int = 50,
    value: str = "75",
    document_id: str = "expense-policy",
    exceptions: list[RuleException] | None = None,
    origin: RuleOrigin | None = None,
) -> Rule:
    return Rule(
        rule_id=rule_id,
        statement=statement,
        enforceability_class=EnforceabilityClass.ENFORCEABLE,
        lifecycle_state=LifecycleState.PUBLISHED,
        origin=origin
        or RuleOrigin(
            source_type=RuleOriginType.EXTRACTED,
            extraction_run_id="extract-v1",
        ),
        scope=Scope(
            expense_category="meals",
            employee_group="employees",
        ),
        citation=Citation(
            document_id=document_id,
            document_version_id=document_version_id,
            section_id=section_id,
            quote=statement,
            start_char=start_char,
            end_char=end_char,
        ),
        condition=RuleCondition(
            field="meal.amount",
            operator="<=",
            value=value,
        ),
        applicability=Applicability(
            aggregation_period="per_day",
            unit="money",
            currency="USD",
            limit_basis="per employee",
        ),
        exceptions=exceptions or [],
    )


def _build_candidate_rule(
    *,
    rule_id: str,
    statement: str,
    value: str = "75",
    document_id: str = "expense-policy",
    exceptions: list[RuleException] | None = None,
) -> CandidateRule:
    return CandidateRule(
        rule_id=rule_id,
        statement=statement,
        enforceability_class=EnforceabilityClass.ENFORCEABLE,
        lifecycle_state=LifecycleState.EXTRACTED,
        origin=RuleOrigin(
            source_type=RuleOriginType.EXTRACTED,
            extraction_run_id="extract-v2",
        ),
        scope=Scope(
            expense_category="meals",
            employee_group="employees",
        ),
        citation=Citation(
            document_id=document_id,
            document_version_id="docv-new",
            section_id="meals#domestic",
            quote=statement,
            start_char=10,
            end_char=50,
        ),
        condition=RuleCondition(
            field="meal.amount",
            operator="<=",
            value=value,
        ),
        applicability=Applicability(
            aggregation_period="per_day",
            unit="money",
            currency="USD",
            limit_basis="per employee",
        ),
        exceptions=exceptions or [],
    )


def _policy_snapshot(*rules: Rule) -> PolicyVersionSnapshot:
    return PolicyVersionSnapshot(
        policy_version_id="policy-v1",
        change_summary="Baseline",
        published_by="approver-user",
        rules=list(rules),
    )


@pytest.mark.parametrize(
    ("current_policy_version", "candidate_rules", "expected"),
    [
        pytest.param(
            None,
            [_build_candidate_rule(rule_id="cand-1", statement="New rule.")],
            {"baseline": None, "added": ["cand-1"], "unchanged": 0, "changed": 0, "removed": 0},
            id="no-current-policy-version",
        ),
        pytest.param(
            _policy_snapshot(
                _build_published_rule(
                    rule_id="rule-other-doc",
                    statement="Other document rule.",
                    document_id="other-policy",
                )
            ),
            [_build_candidate_rule(rule_id="cand-1", statement="New rule.")],
            {
                "baseline": "policy-v1",
                "added": ["cand-1"],
                "unchanged": 0,
                "changed": 0,
                "removed": 0,
            },
            id="empty-baseline-for-document",
        ),
    ],
)
def test_policy_version_diff_baseline_edge_cases(
    current_policy_version: PolicyVersionSnapshot | None,
    candidate_rules: list[CandidateRule],
    expected: dict[str, object],
) -> None:
    diff = diff_candidate_rules_against_current_policy_version(
        document_id="expense-policy",
        candidate_rules=candidate_rules,
        current_policy_version=current_policy_version,
    )

    assert diff.baseline_policy_version_id == expected["baseline"]
    assert [rule.rule_id for rule in diff.added] == expected["added"]
    assert len(diff.unchanged) == expected["unchanged"]
    assert len(diff.changed) == expected["changed"]
    assert len(diff.removed) == expected["removed"]


def test_policy_version_diff_exact_match_is_unchanged() -> None:
    current_rule = _build_published_rule(
        rule_id="rule-domestic",
        statement="Domestic meals are capped at $75 per day.",
        value="75",
    )
    candidate = _build_candidate_rule(
        rule_id="cand-domestic",
        statement="Domestic meals are capped at $75 per day.",
        value="75",
    )

    diff = diff_candidate_rules_against_current_policy_version(
        document_id="expense-policy",
        candidate_rules=[candidate],
        current_policy_version=_policy_snapshot(current_rule),
    )

    assert diff.added == []
    assert diff.changed == []
    assert diff.removed == []
    assert len(diff.unchanged) == 1
    assert diff.unchanged[0].current_rule.rule_id == "rule-domestic"
    assert diff.unchanged[0].candidate_rule.rule_id == "cand-domestic"


def test_policy_version_diff_threshold_change_is_changed() -> None:
    current_rule = _build_published_rule(
        rule_id="rule-international",
        statement="International meals are capped at $100 per day.",
        value="100",
    )
    candidate = _build_candidate_rule(
        rule_id="cand-international",
        statement="International meals are capped at $110 per day.",
        value="110",
    )

    diff = diff_candidate_rules_against_current_policy_version(
        document_id="expense-policy",
        candidate_rules=[candidate],
        current_policy_version=_policy_snapshot(current_rule),
    )

    assert diff.added == []
    assert diff.unchanged == []
    assert diff.removed == []
    assert len(diff.changed) == 1
    assert diff.changed[0].current_rule.rule_id == "rule-international"
    assert diff.changed[0].candidate_rule.rule_id == "cand-international"


def test_policy_version_diff_absent_rule_is_removed() -> None:
    current_rule = _build_published_rule(
        rule_id="rule-ground",
        statement="Ground transport is capped at $60 per day.",
        value="60",
    )

    diff = diff_candidate_rules_against_current_policy_version(
        document_id="expense-policy",
        candidate_rules=[],
        current_policy_version=_policy_snapshot(current_rule),
    )

    assert diff.added == []
    assert diff.unchanged == []
    assert diff.changed == []
    assert len(diff.removed) == 1
    assert diff.removed[0].current_rule.rule_id == "rule-ground"


def test_policy_version_diff_exception_only_change_is_changed() -> None:
    current_rule = _build_published_rule(
        rule_id="rule-meals",
        statement="Domestic meals are capped at $75 per day.",
        value="75",
        exceptions=[],
    )
    candidate = _build_candidate_rule(
        rule_id="cand-meals",
        statement="Domestic meals are capped at $75 per day.",
        value="75",
        exceptions=[
            RuleException(
                description="Client entertainment requires manager approval.",
                required_evidence=["manager_approval"],
            )
        ],
    )

    diff = diff_candidate_rules_against_current_policy_version(
        document_id="expense-policy",
        candidate_rules=[candidate],
        current_policy_version=_policy_snapshot(current_rule),
    )

    assert diff.added == []
    assert diff.unchanged == []
    assert diff.removed == []
    assert len(diff.changed) == 1


def test_policy_version_diff_excludes_manual_rules_from_baseline() -> None:
    manual_rule = _build_published_rule(
        rule_id="rule-manual",
        statement="Manual offsite dinner cap.",
        value="120",
        origin=RuleOrigin(
            source_type=RuleOriginType.MANUAL,
            rationale="Finance exception.",
        ),
    )
    extracted_rule = _build_published_rule(
        rule_id="rule-extracted",
        statement="Domestic meals are capped at $75 per day.",
        value="75",
    )
    candidate = _build_candidate_rule(
        rule_id="cand-new",
        statement="Lodging is capped at $250 per night.",
        value="250",
    )

    diff = diff_candidate_rules_against_current_policy_version(
        document_id="expense-policy",
        candidate_rules=[candidate],
        current_policy_version=_policy_snapshot(manual_rule, extracted_rule),
    )

    assert [rule.rule_id for rule in diff.added] == ["cand-new"]
    assert len(diff.removed) == 1
    assert diff.removed[0].current_rule.rule_id == "rule-extracted"
    assert all(entry.current_rule.rule_id != "rule-manual" for entry in diff.removed)
