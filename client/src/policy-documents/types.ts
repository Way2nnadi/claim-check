export interface PolicyDocumentSummary {
  document_id: string;
  latest_document_version_id: string;
  latest_uploaded_at: string;
  version_count: number;
  active_version_count: number;
  has_deleted_versions: boolean;
}

export interface PolicyDocumentListResponse {
  items: PolicyDocumentSummary[];
}

export interface DocumentVersion {
  document_id: string;
  document_version_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
  deleted_at: string | null;
  deletion_reason: string | null;
}

export interface DocumentVersionListResponse {
  items: DocumentVersion[];
}

export interface DocumentSection {
  document_id: string;
  document_version_id: string;
  section_id: string;
  heading_path: string[];
  content: string;
  start_char: number;
  end_char: number;
}

export interface DocumentSectionListResponse {
  items: DocumentSection[];
}
