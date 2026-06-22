from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from policy_pipeline.rules.models import Applicability, EnforceabilityClass, RuleCondition, Scope


@dataclass(frozen=True)
class GoldenCorpusExpectedRuleSpec:
    statement: str
    enforceability_class: EnforceabilityClass
    scope: Scope
    citation_quote: str
    condition: RuleCondition | None = None
    applicability: Applicability | None = None


@dataclass(frozen=True)
class GoldenCorpusCase:
    case_id: str
    document_id: str
    filename: str
    pdf_lines: list[tuple[str, int]]
    expected_rules: list[GoldenCorpusExpectedRuleSpec]
    fake_structured_output: dict[str, Any]


GOLDEN_CORPUS_CASES = [
    GoldenCorpusCase(
        case_id="expense-policy-core-rules",
        document_id="expense-policy-core",
        filename="expense-policy-core.pdf",
        pdf_lines=[
            ("Meals", 18),
            ("Domestic meals are capped at $75 per day.", 12),
            ("Lodging", 18),
            ("Lodging is capped at $220 per night.", 12),
            ("Receipts", 18),
            ("Hotel stays require itemized receipts.", 12),
        ],
        expected_rules=[
            GoldenCorpusExpectedRuleSpec(
                statement="Domestic meals are capped at $75 per day.",
                enforceability_class=EnforceabilityClass.ENFORCEABLE,
                scope=Scope(expense_category="meals", country="domestic"),
                citation_quote="Domestic meals are capped at $75 per day.",
                condition=RuleCondition(field="meal.amount", operator="<=", value="75"),
                applicability=Applicability(
                    aggregation_period="per_day",
                    unit="money",
                    currency="USD",
                ),
            ),
            GoldenCorpusExpectedRuleSpec(
                statement="Lodging is capped at $220 per night.",
                enforceability_class=EnforceabilityClass.ENFORCEABLE,
                scope=Scope(expense_category="lodging"),
                citation_quote="Lodging is capped at $220 per night.",
                condition=RuleCondition(field="lodging.amount", operator="<=", value="220"),
                applicability=Applicability(
                    aggregation_period="per_night",
                    unit="money",
                    currency="USD",
                ),
            ),
            GoldenCorpusExpectedRuleSpec(
                statement="Hotel stays require itemized receipts.",
                enforceability_class=EnforceabilityClass.GUIDANCE,
                scope=Scope(expense_category="lodging"),
                citation_quote="Hotel stays require itemized receipts.",
            ),
        ],
        fake_structured_output={
            "candidate_rules": [
                {
                    "statement": "Domestic meals are capped at $75 per day.",
                    "enforceability_class": "enforceable",
                    "scope": {
                        "expense_category": "meals",
                        "country": "domestic",
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
                    },
                    "citation_quote": "Domestic meals are capped at $75 per day.",
                },
                {
                    "statement": "Lodging is capped at $220 per night.",
                    "enforceability_class": "enforceable",
                    "scope": {
                        "expense_category": "lodging",
                    },
                    "condition": {
                        "field": "lodging.amount",
                        "operator": "<=",
                        "value": "250",
                    },
                    "applicability": {
                        "aggregation_period": "per_night",
                        "unit": "money",
                        "currency": "USD",
                    },
                    "citation_quote": "Hotel stays require itemized receipts.",
                },
                {
                    "statement": "Hotel stays require itemized receipts.",
                    "enforceability_class": "subjective",
                    "scope": {
                        "expense_category": "lodging",
                    },
                    "citation_quote": "Hotel stays require itemized receipts.",
                },
            ]
        },
    ),
    GoldenCorpusCase(
        case_id="expense-policy-invalid-structured-output",
        document_id="expense-policy-invalid",
        filename="expense-policy-invalid.pdf",
        pdf_lines=[
            ("Ground Transportation", 18),
            ("Ground transportation is capped at $60 per trip.", 12),
        ],
        expected_rules=[
            GoldenCorpusExpectedRuleSpec(
                statement="Ground transportation is capped at $60 per trip.",
                enforceability_class=EnforceabilityClass.ENFORCEABLE,
                scope=Scope(expense_category="ground_transportation"),
                citation_quote="Ground transportation is capped at $60 per trip.",
                condition=RuleCondition(
                    field="ground_transportation.amount",
                    operator="<=",
                    value="60",
                ),
                applicability=Applicability(
                    aggregation_period="per_trip",
                    unit="money",
                    currency="USD",
                ),
            )
        ],
        fake_structured_output={
            "candidate_rules": [
                {
                    "statement": "Ground transportation is capped at $60 per trip.",
                    "enforceability_class": "enforceable",
                    "scope": {
                        "expense_category": "ground_transportation",
                    },
                    "condition": {
                        "field": "ground_transportation.amount",
                        "operator": "<=",
                        "value": "60",
                    },
                    "applicability": {
                        "aggregation_period": "per_trip",
                        "unit": "money",
                        "currency": "USD",
                    },
                    "citation_quote": "Ground transportation is capped at $60 per trip.",
                },
                {
                    "statement": "Taxi rides require receipts.",
                    "enforceability_class": "guidance",
                    "scope": {
                        "expense_category": "ground_transportation",
                    },
                },
            ]
        },
    ),
]
