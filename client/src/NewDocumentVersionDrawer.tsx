import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { uploadDocumentVersion } from "./api";
import { describeFetchError, formatBytes } from "./documentFormat";
import {
  isAcceptedUploadFile,
  UPLOAD_ACCEPT,
  UPLOAD_FORMAT_ERROR,
} from "./documentUpload";
import MissionDrawerHead from "./MissionDrawerHead";

interface NewDocumentVersionDrawerProps {
  documentId: string;
  open: boolean;
  onClose: () => void;
  onUploaded: (documentVersionId: string) => void;
}

export default function NewDocumentVersionDrawer({
  documentId,
  open,
  onClose,
  onUploaded,
}: NewDocumentVersionDrawerProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadInputKey, setUploadInputKey] = useState(0);

  useEffect(() => {
    if (!open) {
      setSelectedFile(null);
      setUploadError(null);
      setIsUploading(false);
      setUploadInputKey(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !isUploading) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, isUploading, onClose]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setUploadError(null);

    if (file && !isAcceptedUploadFile(file)) {
      setUploadError(UPLOAD_FORMAT_ERROR);
      setSelectedFile(null);
      setUploadInputKey((current) => current + 1);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedFile || isUploading) {
      return;
    }

    if (!isAcceptedUploadFile(selectedFile)) {
      setUploadError(UPLOAD_FORMAT_ERROR);
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const created = await uploadDocumentVersion(documentId, selectedFile);
      onUploaded(created.document_version_id);
    } catch (error: unknown) {
      setUploadError(describeFetchError(error, "Upload failed."));
    } finally {
      setIsUploading(false);
    }
  }

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="mission-drawer-root">
      <button
        type="button"
        className="mission-drawer-backdrop"
        aria-label="Close new document version drawer"
        disabled={isUploading}
        onClick={() => {
          if (!isUploading) {
            onClose();
          }
        }}
      />
      <dialog
        open
        id="new-document-version-drawer"
        className="mission-drawer"
        aria-labelledby="new-document-version-heading"
      >
        <MissionDrawerHead
          folio="Version ledger"
          title="New Document Version"
          titleId="new-document-version-heading"
          lede="Deposit a PDF or DOCX — appends an immutable version to the ledger."
          onClose={onClose}
          closeDisabled={isUploading}
        />

        <div className="mission-drawer-body">
          <form
            className="register-document-form"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <label className="version-upload-dropzone compact" htmlFor="document-version-file">
              <input
                key={uploadInputKey}
                id="document-version-file"
                name="document-version-file"
                type="file"
                accept={UPLOAD_ACCEPT}
                disabled={isUploading}
                onChange={handleFileChange}
              />
              <span className="version-upload-dropcopy">
                {selectedFile ? (
                  <>
                    <strong>{selectedFile.name}</strong>
                    <span>{formatBytes(selectedFile.size)}</span>
                  </>
                ) : (
                  <>
                    <strong>Select PDF or DOCX</strong>
                    <span>Drop file or click to browse</span>
                  </>
                )}
              </span>
            </label>

            {uploadError ? (
              <p className="version-upload-feedback error" role="alert">
                {uploadError}
              </p>
            ) : null}

            <div className="register-document-actions">
              <button
                type="submit"
                className="version-upload-submit"
                disabled={
                  !selectedFile || isUploading || Boolean(uploadError && !selectedFile)
                }
              >
                {isUploading ? "Depositing…" : "Deposit version"}
              </button>
              {selectedFile ? (
                <button
                  type="button"
                  className="version-upload-clear"
                  disabled={isUploading}
                  onClick={() => {
                    setSelectedFile(null);
                    setUploadError(null);
                    setUploadInputKey((current) => current + 1);
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </dialog>
    </div>,
    document.body,
  );
}
