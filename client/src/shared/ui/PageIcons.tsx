import type { ReactNode } from "react";

interface IconProps {
	size?: number;
}

function IconShell({ children, size = 16 }: IconProps & { children: ReactNode }) {
	return (
		<span className="page-icon" aria-hidden="true" style={{ width: size, height: size }}>
			{children}
		</span>
	);
}

export function DocumentPageIcon({ size = 16 }: IconProps) {
	return (
		<IconShell size={size}>
			<svg viewBox="0 0 16 16" fill="currentColor" width={size} height={size}>
				<title>Document</title>
				<path d="M3 1h7l3 3v11H3V1zm6 0v3h3L9 1zM5 7h6v1H5V7zm0 3h6v1H5v-1zm0 3h4v1H5v-1z" />
			</svg>
		</IconShell>
	);
}

export function RulePageIcon({ size = 16 }: IconProps) {
	return (
		<IconShell size={size}>
			<svg viewBox="0 0 16 16" fill="currentColor" width={size} height={size}>
				<title>Rule</title>
				<path d="M6.5 11.5L3 8l1-1 2.5 2.5L12 4l1 1-6.5 6.5z" />
			</svg>
		</IconShell>
	);
}

export function PolicyVersionPageIcon({ size = 16 }: IconProps) {
	return (
		<IconShell size={size}>
			<svg viewBox="0 0 16 16" fill="currentColor" width={size} height={size}>
				<title>Policy version</title>
				<path d="M2 3h12v2H2V3zm0 4h8v2H2V7zm0 4h10v2H2v-2z" />
			</svg>
		</IconShell>
	);
}

export function WorkspacePageIcon({ size = 16 }: IconProps) {
	return (
		<IconShell size={size}>
			<svg viewBox="0 0 16 16" fill="currentColor" width={size} height={size}>
				<title>Workspace</title>
				<path d="M2 2h5v5H2V2zm7 0h5v5H9V2zM2 9h5v5H2V9zm7 0h5v5H9V9z" />
			</svg>
		</IconShell>
	);
}

export function ExpenseReportPageIcon({ size = 16 }: IconProps) {
	return (
		<IconShell size={size}>
			<svg viewBox="0 0 16 16" fill="currentColor" width={size} height={size}>
				<title>Expense report</title>
				<path d="M2 3h12v10H2V3zm1.5 1.5v7h9v-7h-9zM5 6h6v1H5V6zm0 3h4v1H5V9z" />
			</svg>
		</IconShell>
	);
}

export function EvaluationRunPageIcon({ size = 16 }: IconProps) {
	return (
		<IconShell size={size}>
			<svg viewBox="0 0 16 16" fill="currentColor" width={size} height={size}>
				<title>Evaluation run</title>
				<path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zm0 1.5a5 5 0 110 10 5 5 0 010-10zm-.75 2.25v3.19l2.72 1.59.78-1.33-2-1.17V5.25H7.25z" />
			</svg>
		</IconShell>
	);
}

export function ComplianceReviewPageIcon({ size = 16 }: IconProps) {
	return (
		<IconShell size={size}>
			<svg viewBox="0 0 16 16" fill="currentColor" width={size} height={size}>
				<title>Compliance review</title>
				<path d="M3 2h10v12H3V2zm1.5 1.5v9h7v-9h-7zM5 6h6v1.25H5V6zm0 2.5h4.5V9.75H5V8.5z" />
			</svg>
		</IconShell>
	);
}

export function ExtractionRunPageIcon({ size = 16 }: IconProps) {
	return (
		<IconShell size={size}>
			<svg viewBox="0 0 16 16" fill="currentColor" width={size} height={size}>
				<title>Extraction run</title>
				<path d="M3 1h7l3 3v6H3V1zm6 0v3h3L9 1zM11 8.5h2.5l-2 2 2 2H11v1.5L14.5 12 11 9.5V8.5z" />
			</svg>
		</IconShell>
	);
}

export function RecordPageIcon({
	icon,
	size = 56,
}: {
	icon: ReactNode;
	size?: number;
}) {
	return (
		<div className="record-page-icon" aria-hidden="true" style={{ width: size, height: size }}>
			{icon}
		</div>
	);
}
