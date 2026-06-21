import { formatDocumentTitle } from "./documentFormat";
import SearchablePicker from "./SearchablePicker";
import type { PolicyDocumentSummary } from "./types";

interface DocumentFilterPickerProps {
  label?: string;
  value: string;
  documents: PolicyDocumentSummary[];
  placeholder?: string;
  onChange: (documentId: string) => void;
}

export default function DocumentFilterPicker({
  label = "Document",
  value,
  documents,
  placeholder = "Any document",
  onChange,
}: DocumentFilterPickerProps) {
  return (
    <SearchablePicker
      label={label}
      value={value}
      placeholder={placeholder}
      emptyMessage="No matching documents"
      allowFreeText
      clearable
      onChange={onChange}
      options={documents.map((document) => ({
        value: document.document_id,
        label: formatDocumentTitle(document.document_id),
        meta:
          document.version_count > 1 ? `${document.version_count} versions` : undefined,
      }))}
    />
  );
}
