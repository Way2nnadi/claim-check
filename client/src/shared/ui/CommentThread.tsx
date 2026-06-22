import { formatDateTime } from "../format/common";

export interface CommentEntry {
	id: string;
	author: string;
	timestamp?: string;
	body: string;
}

interface CommentThreadProps {
	entries: readonly CommentEntry[];
	title?: string;
	emptyMessage?: string;
}

function authorInitials(author: string): string {
	const parts = author.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) {
		return "?";
	}
	if (parts.length === 1) {
		return parts[0].slice(0, 1).toUpperCase();
	}
	return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

export default function CommentThread({
	entries,
	title = "Activity",
	emptyMessage = "No comments yet.",
}: CommentThreadProps) {
	return (
		<section className="comment-thread" aria-label={title}>
			<h4 className="record-section-heading">{title}</h4>
			{entries.length === 0 ? (
				<p className="comment-thread-empty">{emptyMessage}</p>
			) : (
				<ol className="comment-thread-list">
					{entries.map((entry) => (
						<li key={entry.id} className="comment-entry">
							<span className="comment-avatar" aria-hidden="true">
								{authorInitials(entry.author)}
							</span>
							<div className="comment-body">
								<header className="comment-head">
									<span className="comment-author">{entry.author}</span>
									{entry.timestamp ? (
										<time
											className="comment-time"
											dateTime={entry.timestamp}
										>
											{formatDateTime(entry.timestamp)}
										</time>
									) : null}
								</header>
								<p className="comment-text">{entry.body}</p>
							</div>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}
