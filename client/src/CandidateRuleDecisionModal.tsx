interface CandidateRuleDecisionModalProps {
	mode: "approve" | "reject";
	isResolving: boolean;
	comment: string;
	error: string | null;
	onCommentChange: (value: string) => void;
	onConfirm: () => void;
	onCancel: () => void;
}

export default function CandidateRuleDecisionModal({
	mode,
	isResolving,
	comment,
	error,
	onCommentChange,
	onConfirm,
	onCancel,
}: CandidateRuleDecisionModalProps) {
	const commentFieldId =
		mode === "approve"
			? "candidate-rule-approval-rationale"
			: "candidate-rule-rejection-reason";

	return (
		<div className="review-decision-backdrop" role="presentation">
			<div
				className="review-decision-dialog"
				role="dialog"
				aria-modal="true"
				aria-label={mode === "approve" ? "Approve rule" : "Reject rule"}
			>
				<div className="review-decision-head">
					<h4>{mode === "approve" ? "Approve" : "Reject"}</h4>
				</div>

				<label className="review-decision-field" htmlFor={commentFieldId}>
					{mode === "approve" ? "Rationale" : "Reason"}
					<textarea
						id={commentFieldId}
						value={comment}
						rows={4}
						disabled={isResolving}
						onChange={(event) => onCommentChange(event.target.value)}
					/>
				</label>

				{error ? <p className="error-banner">{error}</p> : null}

				<div className="review-decision-actions">
					<button
						type="button"
						className="review-secondary-button"
						disabled={isResolving}
						onClick={onCancel}
					>
						Cancel
					</button>
					<button
						type="button"
						className={
							mode === "approve"
								? "review-save-button"
								: "review-save-button review-danger-button"
						}
						disabled={isResolving}
						onClick={onConfirm}
					>
						{isResolving
							? mode === "approve"
								? "Approving…"
								: "Rejecting…"
							: "Confirm"}
					</button>
				</div>
			</div>
		</div>
	);
}
