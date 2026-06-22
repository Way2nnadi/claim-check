import type { ReingestionRequest, ReingestionResult } from "./types";
import { apiRequest } from "../shared/api/client";

export function reingestDocument(
  documentId: string,
  file: File,
  request: ReingestionRequest,
): Promise<ReingestionResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("extraction_run_id", request.extraction_run_id);
  formData.append("prompt_template_id", request.prompt_template_id);
  formData.append("prompt_template_version", request.prompt_template_version);
  formData.append("model_configuration_id", request.model_configuration_id);
  formData.append("model_configuration_version", request.model_configuration_version);
  return apiRequest<ReingestionResult>(
    `/api/policy-documents/${encodeURIComponent(documentId)}/reingestions`,
    {
      method: "POST",
      body: formData,
    },
  );
}
