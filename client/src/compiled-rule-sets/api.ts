import type { CompiledRuleSet, CompiledRuleSetListResponse } from "./types";
import { apiRequest } from "../shared/api/client";

export function fetchCompiledRuleSets(): Promise<CompiledRuleSetListResponse> {
  return apiRequest<CompiledRuleSetListResponse>("/api/compiled-rule-sets");
}

export function fetchCompiledRuleSet(
  compiledRuleSetId: string,
): Promise<CompiledRuleSet> {
  return apiRequest<CompiledRuleSet>(
    `/api/compiled-rule-sets/${encodeURIComponent(compiledRuleSetId)}`,
  );
}

export function fetchCompiledRuleSetsForPolicyVersion(
  policyVersionId: string,
): Promise<CompiledRuleSetListResponse> {
  return apiRequest<CompiledRuleSetListResponse>(
    `/api/policy-versions/${encodeURIComponent(policyVersionId)}/compiled-rule-sets`,
  );
}

export function compilePolicyVersion(
  policyVersionId: string,
): Promise<CompiledRuleSet> {
  return apiRequest<CompiledRuleSet>(
    `/api/policy-versions/${encodeURIComponent(policyVersionId)}/compiled-rule-sets`,
    { method: "POST" },
  );
}
