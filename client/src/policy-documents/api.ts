import type { DocumentSectionListResponse, DocumentVersion, DocumentVersionListResponse, PolicyDocumentListResponse } from "./types";
import { apiRequest, downloadAttachment, getStoredToken } from "../shared/api/client";

export function fetchPolicyDocuments(
  includeDeleted = false,
): Promise<PolicyDocumentListResponse> {
  const params = includeDeleted ? "?include_deleted=true" : "";
  return apiRequest<PolicyDocumentListResponse>(`/api/policy-documents${params}`);
}

export function fetchDocumentVersions(
  documentId: string,
  includeDeleted = false,
): Promise<DocumentVersionListResponse> {
  const params = includeDeleted ? "?include_deleted=true" : "";
  return apiRequest<DocumentVersionListResponse>(
    `/api/policy-documents/${encodeURIComponent(documentId)}/versions${params}`,
  );
}

export function uploadDocumentVersion(
  documentId: string,
  file: File,
): Promise<DocumentVersion> {
  const formData = new FormData();
  formData.append("file", file);
  return apiRequest<DocumentVersion>(
    `/api/policy-documents/${encodeURIComponent(documentId)}/versions`,
    {
      method: "POST",
      body: formData,
    },
  );
}

export function deleteDocumentVersion(
  documentId: string,
  documentVersionId: string,
  reason: string,
): Promise<DocumentVersion> {
  return apiRequest<DocumentVersion>(
    `/api/policy-documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(documentVersionId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ reason }),
    },
  );
}

export async function downloadDocumentVersion(
  documentId: string,
  documentVersionId: string,
  filename: string,
): Promise<void> {
  await downloadAttachment(
    `/api/policy-documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(documentVersionId)}`,
    filename,
  );
}

export function fetchDocumentSections(
  documentId: string,
  documentVersionId: string,
): Promise<DocumentSectionListResponse> {
  return apiRequest<DocumentSectionListResponse>(
    `/api/policy-documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(documentVersionId)}/sections`,
  );
}

