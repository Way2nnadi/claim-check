import { describeFetchError, formatBytes } from "./format";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { uploadDocumentVersion } from "./api";

import {
	DOCUMENT_ID_ERROR,
	isAcceptedUploadFile,
	isValidDocumentId,
	normalizeDocumentId,
	UPLOAD_ACCEPT,
	UPLOAD_FORMAT_ERROR,
} from "./upload";
import MissionDrawerHead from "../shared/ui/MissionDrawerHead";

interface RegisterDocumentDrawerProps {
	open: boolean;
	onClose: () => void;
	existingDocumentIds: string[];
	onRegistered: (documentId: string) => void;
}

export default function RegisterDocumentDrawer({
	open,
	onClose,
	existingDocumentIds,
	onRegistered,
}: RegisterDocumentDrawerProps) {
	const [documentIdInput, setDocumentIdInput] = useState("");
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [uploadInputKey, setUploadInputKey] = useState(0);

	const normalizedDocumentId = normalizeDocumentId(documentIdInput);
	const documentIdIsValid =
		normalizedDocumentId.length > 0 && isValidDocumentId(normalizedDocumentId);
	const documentAlreadyExists =
		existingDocumentIds.includes(normalizedDocumentId);

	useEffect(() => {
		if (!open) {
			setDocumentIdInput("");
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

	async function handleSubmit(
		event: FormEvent<HTMLFormElement>,
	): Promise<void> {
		event.preventDefault();
		if (!selectedFile || isUploading) {
			return;
		}

		if (!documentIdIsValid) {
			setUploadError(DOCUMENT_ID_ERROR);
			return;
		}

		if (!isAcceptedUploadFile(selectedFile)) {
			setUploadError(UPLOAD_FORMAT_ERROR);
			return;
		}

		setIsUploading(true);
		setUploadError(null);

		try {
			await uploadDocumentVersion(normalizedDocumentId, selectedFile);
			onRegistered(normalizedDocumentId);
		} catch (error: unknown) {
			setUploadError(describeFetchError(error, "Registration failed."));
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
				aria-label="Close register document drawer"
				disabled={isUploading}
				onClick={() => {
					if (!isUploading) {
						onClose();
					}
				}}
			/>
			<dialog
				open
				className="mission-drawer"
				aria-labelledby="register-document-heading"
			>
				<MissionDrawerHead
					folio="Registry intake"
					title="Register Policy Document"
					titleId="register-document-heading"
					lede="Choose a registry id and deposit the first PDF or DOCX version. Re-uploads use New version on the document record."
					onClose={onClose}
					closeDisabled={isUploading}
				/>

				<div className="mission-drawer-body">
					<form
						className="register-document-form"
						onSubmit={(event) => void handleSubmit(event)}
					>
						<label htmlFor="register-document-id">
							Document id
							<input
								id="register-document-id"
								name="register-document-id"
								type="text"
								value={documentIdInput}
								autoComplete="off"
								spellCheck={false}
								disabled={isUploading}
								placeholder="expense-policy"
								onChange={(event) => {
									setDocumentIdInput(event.target.value);
									setUploadError(null);
								}}
							/>
						</label>

						{documentIdInput.trim() && !documentIdIsValid ? (
							<p className="version-upload-feedback error" role="alert">
								{DOCUMENT_ID_ERROR}
							</p>
						) : null}

						{documentAlreadyExists && documentIdIsValid ? (
							<p className="catalog-register-note">
								This id is already indexed — upload will append a new version to
								the existing record.
							</p>
						) : null}

						<label
							className="version-upload-dropzone compact"
							htmlFor="register-document-file"
						>
							<input
								key={uploadInputKey}
								id="register-document-file"
								name="register-document-file"
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
								className="document-command document-command-accent"
								disabled={
									!documentIdIsValid ||
									!selectedFile ||
									isUploading ||
									Boolean(uploadError && !selectedFile)
								}
							>
								{isUploading ? "Registering…" : "Deposit document"}
							</button>
							{selectedFile || documentIdInput ? (
								<button
									type="button"
									className="version-upload-clear"
									disabled={isUploading}
									onClick={() => {
										setDocumentIdInput("");
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
