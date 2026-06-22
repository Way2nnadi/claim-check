import pytest
from pydantic import ValidationError

from policy_pipeline.rules import (
    AggregationPeriod,
    EnforceabilityClass,
    LifecycleState,
    Rule,
    RuleOriginType,
)


def build_extracted_rule_payload() -> dict[str, object]:
    return {
        "rule_id": "rule-meal-cap-domestic",
        "statement": "Domestic meals are capped at $75 per day.",
        "enforceability_class": "enforceable",
        "lifecycle_state": "extracted",
        "origin": {
            "source_type": "extracted",
            "extraction_run_id": "extract-2026-06-20",
        },
        "scope": {
            "country": "US",
            "expense_category": "meals",
        },
        "citation": {
            "document_id": "doc-expense-policy",
            "document_version_id": "docv-2026-06-01",
            "section_id": "meals-and-entertainment#abc123",
            "quote": "Domestic meals are capped at $75 per day.",
            "start_char": 512,
            "end_char": 554,
        },
        "condition": {
            "field": "meal.amount",
            "operator": "<=",
            "value": "75",
        },
        "applicability": {
            "aggregation_period": "per_day",
            "unit": "money",
            "currency": "USD",
            "limit_basis": "per employee",
        },
        "exceptions": [
            {
                "description": "Client entertainment is allowed with manager approval.",
                "required_evidence": ["manager_approval"],
            }
        ],
    }


def test_extracted_enforceable_quantitative_rule_payload_is_valid() -> None:
    rule = Rule.model_validate(build_extracted_rule_payload())

    assert rule.enforceability_class is EnforceabilityClass.ENFORCEABLE
    assert rule.lifecycle_state is LifecycleState.EXTRACTED
    assert rule.origin.source_type is RuleOriginType.EXTRACTED
    assert rule.applicability is not None
    assert rule.applicability.aggregation_period is AggregationPeriod.PER_DAY
    assert rule.exceptions[0].required_evidence == ["manager_approval"]


def test_invalid_currency_is_cleared_instead_of_rejected() -> None:
    payload = build_extracted_rule_payload()
    payload["applicability"]["currency"] = "100"

    rule = Rule.model_validate(payload)

    assert rule.applicability is not None
    assert rule.applicability.currency is None


def test_short_currency_is_cleared_instead_of_rejected() -> None:
    payload = build_extracted_rule_payload()
    payload["applicability"]["currency"] = "US"

    rule = Rule.model_validate(payload)

    assert rule.applicability is not None
    assert rule.applicability.currency is None


def test_manual_guidance_rule_payload_is_valid_without_citation() -> None:
    rule = Rule.model_validate(
        {
            "rule_id": "rule-entertainment-guidance",
            "statement": "Entertainment spending should remain modest and in good taste.",
            "enforceability_class": "guidance",
            "lifecycle_state": "in_review",
            "origin": {
                "source_type": "manual",
                "rationale": "Approver captured unwritten finance guidance for reviewers.",
            },
            "scope": {
                "expense_category": "entertainment",
                "employee_group": "all",
            },
            "exceptions": [],
        }
    )

    assert rule.enforceability_class is EnforceabilityClass.GUIDANCE
    assert rule.lifecycle_state is LifecycleState.IN_REVIEW
    assert rule.origin.source_type is RuleOriginType.MANUAL
    assert rule.citation is None
    assert rule.condition is None


def test_manual_guidance_rule_payload_is_valid_with_citation() -> None:
    rule = Rule.model_validate(
        {
            "rule_id": "rule-entertainment-guidance-cited",
            "statement": "Entertainment spending should remain modest and in good taste.",
            "enforceability_class": "guidance",
            "lifecycle_state": "in_review",
            "origin": {
                "source_type": "manual",
                "rationale": "Approver captured cited guidance from the Policy Document.",
            },
            "scope": {
                "expense_category": "entertainment",
                "employee_group": "all",
            },
            "citation": {
                "document_id": "doc-expense-policy",
                "document_version_id": "docv-2026-06-01",
                "section_id": "meals-and-entertainment#def456",
                "quote": "Entertainment spending should remain modest and in good taste.",
                "start_char": 901,
                "end_char": 962,
            },
            "exceptions": [],
        }
    )

    assert rule.origin.source_type is RuleOriginType.MANUAL
    assert rule.citation is not None
    assert rule.citation.document_version_id == "docv-2026-06-01"


def test_rule_enums_publish_expected_contract_values() -> None:
    assert {state.value for state in LifecycleState} == {
        "extracted",
        "in_review",
        "approved",
        "published",
        "rejected",
        "withdrawn",
        "superseded",
    }
    assert {classification.value for classification in EnforceabilityClass} == {
        "enforceable",
        "guidance",
        "subjective",
    }
    assert {origin.value for origin in RuleOriginType} == {
        "extracted",
        "manual",
    }


@pytest.mark.parametrize(
    ("mutator", "message"),
    [
        (
            lambda payload: payload.pop("citation"),
            "Rule requires a Citation.",
        ),
        (
            lambda payload: payload["origin"].pop("extraction_run_id"),
            "Extracted origin requires extraction_run_id.",
        ),
        (
            lambda payload: payload.__setitem__("enforceability_class", "guidance"),
            "Guidance and subjective Rules must not include a machine-checkable condition.",
        ),
        (
            lambda payload: payload["citation"].__setitem__("end_char", 500),
            "Citation end_char must be greater than start_char.",
        ),
    ],
)
def test_rule_validation_rejects_invalid_payloads(mutator, message: str) -> None:
    payload = build_extracted_rule_payload()
    mutator(payload)

    with pytest.raises(ValidationError, match=message):
        Rule.model_validate(payload)


def test_manual_rule_requires_rationale() -> None:
    with pytest.raises(ValidationError, match="Manual origin requires rationale."):
        Rule.model_validate(
            {
                "rule_id": "rule-manual-without-rationale",
                "statement": "A manual Rule requires rationale.",
                "enforceability_class": "subjective",
                "lifecycle_state": "approved",
                "origin": {
                    "source_type": "manual",
                },
                "scope": {
                    "expense_category": "meals",
                },
            }
        )


def test_enforceable_rule_requires_machine_checkable_condition() -> None:
    payload = build_extracted_rule_payload()
    payload.pop("condition")

    with pytest.raises(
        ValidationError,
        match="Enforceable Rule requires a machine-checkable condition.",
    ):
        Rule.model_validate(payload)
