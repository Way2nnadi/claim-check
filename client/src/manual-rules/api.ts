import type { ManualRuleCreateRequest, Rule } from "../rules/types";
import { apiRequest } from "../shared/api/client";

export function createManualRule(request: ManualRuleCreateRequest): Promise<Rule> {
  return apiRequest<Rule>("/api/rules/manual", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
