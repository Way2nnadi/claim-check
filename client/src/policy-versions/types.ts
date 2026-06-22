import type { Rule } from "../rules/types";

export interface PolicyVersionSummary {
  policy_version_id: string;
  published_by: string;
  change_summary: string;
  rule_count: number;
  created_at: string;
}

export interface PolicyVersionListResponse {
  items: PolicyVersionSummary[];
}

export interface PolicyVersionPublishRequest {
  policy_version_id: string;
  change_summary: string;
}

export interface PolicyVersionPublishResponse {
  policy_version_id: string;
  rule_count: number;
  status: string;
  published_by: string;
}

export interface PolicyVersionSnapshot {
  policy_version_id: string;
  change_summary: string;
  published_by: string;
  rules: Rule[];
}
