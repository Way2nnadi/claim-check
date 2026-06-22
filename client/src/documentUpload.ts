export const UPLOAD_ACCEPT =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const UPLOAD_FORMAT_ERROR =
  "Only native-digital PDF and DOCX Policy Documents are supported.";

export const DOCUMENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const DOCUMENT_ID_ERROR =
  "Use lowercase letters, numbers, and hyphens (e.g. expense-policy).";

export function isAcceptedUploadFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  const hasExtension = lowerName.endsWith(".pdf") || lowerName.endsWith(".docx");
  if (!hasExtension) {
    return false;
  }
  if (!file.type) {
    return true;
  }
  return (
    file.type === "application/pdf" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

export function normalizeDocumentId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

export function isValidDocumentId(value: string): boolean {
  return DOCUMENT_ID_PATTERN.test(value);
}
