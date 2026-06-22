import type { PolicyVersionListResponse, PolicyVersionPublishRequest, PolicyVersionPublishResponse, PolicyVersionSnapshot } from "./types";
import type { Rule } from "../rules/types";
import { apiRequest, downloadAttachment } from "../shared/api/client";

export function fetchPolicyVersions(): Promise<PolicyVersionListResponse> {
  return apiRequest<PolicyVersionListResponse>("/api/policy-versions");
}

export function fetchPolicyVersion(
  policyVersionId: string,
): Promise<PolicyVersionSnapshot> {
  return apiRequest<PolicyVersionSnapshot>(
    `/api/policy-versions/${encodeURIComponent(policyVersionId)}`,
  );
}

export function publishPolicyVersion(
  request: PolicyVersionPublishRequest,
): Promise<PolicyVersionPublishResponse> {
  return apiRequest<PolicyVersionPublishResponse>("/api/policy-versions", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

function buildSnapshotFilename(policyVersionId: string): string {
  const safeStem = policyVersionId.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "");
  return `${safeStem || "policy-version"}.json`;
}

export async function downloadPolicyVersionSnapshot(
  policyVersionId: string,
): Promise<void> {
  await downloadAttachment(
    `/api/policy-versions/${encodeURIComponent(policyVersionId)}/snapshot`,
    buildSnapshotFilename(policyVersionId),
  );
}

export type { Rule };
