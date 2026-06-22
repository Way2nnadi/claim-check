from __future__ import annotations

from pydantic import BaseModel, Field, model_validator

from policy_pipeline.rules.models import EnforceabilityClass, RuleException, Scope


class StructuredCandidateRuleCondition(BaseModel):
    field: str | None = None
    operator: str | None = None
    value: str | None = None


class StructuredCandidateRuleApplicability(BaseModel):
    aggregation_period: str | None = None
    unit: str | None = None
    currency: str | None = None
    limit_basis: str | None = None


class StructuredCandidateRule(BaseModel):
    statement: str = Field(min_length=1)
    enforceability_class: EnforceabilityClass
    scope: Scope
    citation_quote: str = Field(min_length=1)
    condition: StructuredCandidateRuleCondition | None = None
    applicability: StructuredCandidateRuleApplicability | None = None
    exceptions: list[RuleException] = Field(default_factory=list)
    extraction_confidence: float | None = Field(default=None, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def validate_candidate_rule(self) -> StructuredCandidateRule:
        if self.condition is not None:
            has_field = bool(self.condition.field)
            has_operator = bool(self.condition.operator)
            has_value = bool(self.condition.value)

            if has_value and (not has_field or not has_operator):
                raise ValueError(
                    "Candidate Rule condition with a threshold value must include field "
                    "and operator."
                )
            if (has_field or has_operator) and not (has_field and has_operator):
                raise ValueError(
                    "Candidate Rule condition must include both field and operator when "
                    "partially specified."
                )
        if (
            self.enforceability_class is not EnforceabilityClass.ENFORCEABLE
            and self.condition is not None
        ):
            raise ValueError(
                "Guidance and subjective Candidate Rules must not include "
                "a machine-checkable condition."
            )
        return self


class StructuredCandidateRulesPayload(BaseModel):
    candidate_rules: list[StructuredCandidateRule] = Field(default_factory=list)
