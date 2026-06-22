from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

from policy_pipeline.rules.models import Rule


class CompileStatus(StrEnum):
    COMPILED = "compiled"
    SKIPPED_NON_ENFORCEABLE = "skipped_non_enforceable"
    COMPILE_ERROR = "compile_error"


class CompiledExecutableRule(BaseModel):
    rule_id: str = Field(min_length=1)
    statement: str = Field(min_length=1)
    scope: dict[str, Any]
    condition: dict[str, str]
    applicability: dict[str, Any]
    exceptions: list[dict[str, Any]] = Field(default_factory=list)
    citation: dict[str, Any] | None = None


class CompiledRuleEntry(BaseModel):
    rule_id: str = Field(min_length=1)
    status: CompileStatus
    source_rule: Rule
    compiled_rule: CompiledExecutableRule | None = None
    skip_reason: str | None = None
    error_reason: str | None = None


class CompiledRuleSetSummary(BaseModel):
    compiled: int = Field(ge=0)
    skipped_non_enforceable: int = Field(ge=0)
    compile_error: int = Field(ge=0)


class CompiledRuleSet(BaseModel):
    compiled_rule_set_id: str = Field(min_length=1)
    policy_version_id: str = Field(min_length=1)
    compiled_by: str = Field(min_length=1)
    compiled_at: datetime
    entries: list[CompiledRuleEntry] = Field(default_factory=list)
    summary: CompiledRuleSetSummary


class CompiledRuleSetListResponse(BaseModel):
    items: list[CompiledRuleSet]
