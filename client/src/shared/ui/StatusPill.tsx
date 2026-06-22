export type StatusPillVariant =
	| "extracted"
	| "in-review"
	| "approved"
	| "closed"
	| "neutral"
	| "warning"
	| "danger"
	| "success";

interface StatusPillProps {
	label: string;
	variant?: StatusPillVariant;
}

export default function StatusPill({
	label,
	variant = "neutral",
}: StatusPillProps) {
	return (
		<span className={`status-pill status-pill--${variant}`}>{label}</span>
	);
}

export function lifecycleToPillVariant(
	state: string,
): StatusPillVariant {
	if (state === "extracted") {
		return "extracted";
	}
	if (state === "in_review") {
		return "in-review";
	}
	if (state === "approved" || state === "published") {
		return "success";
	}
	if (state === "rejected" || state === "withdrawn" || state === "superseded") {
		return "closed";
	}
	return "neutral";
}

export function enforceabilityToPillVariant(
	value: string,
): StatusPillVariant {
	if (value === "enforceable") {
		return "success";
	}
	if (value === "guidance") {
		return "warning";
	}
	return "neutral";
}
