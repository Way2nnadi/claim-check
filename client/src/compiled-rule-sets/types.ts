import type { Rule } from "../rules/types";

export type CompileStatus =
  | "compiled"
  | "skipped_non_enforceable"
  | "compile_error";

export interface CompiledExecutableRule {
  rule_id: string;
  statement: string;
  scope: Rule["scope"];
  condition: NonNullable<Rule["condition"]>;
  applicability: NonNullable<Rule["applicability"]>;
  exceptions: Rule["exceptions"];
  citation: Rule["citation"];
}

export interface CompiledRuleEntry {
  rule_id: string;
  status: CompileStatus;
  source_rule: Rule;
  compiled_rule: CompiledExecutableRule | null;
  skip_reason: string | null;
  error_reason: string | null;
}

export interface CompiledRuleSetSummary {
  compiled: number;
  skipped_non_enforceable: number;
  compile_error: number;
}

export interface CompiledRuleSet {
  compiled_rule_set_id: string;
  policy_version_id: string;
  compiled_by: string;
  compiled_at: string;
  entries: CompiledRuleEntry[];
  summary: CompiledRuleSetSummary;
}

export interface CompiledRuleSetListResponse {
  items: CompiledRuleSet[];
}
