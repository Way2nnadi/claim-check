import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { formatEditedLabel } from "../format/relativeTime";
import RecordPropertyRow, { type RecordProperty } from "./RecordPropertyRow";

export interface RecordPropertyGroup {
	title?: string;
	properties: readonly RecordProperty[];
}

interface RecordPageHeaderProps {
	icon?: ReactNode;
	title: string;
	subtitle?: string;
	breadcrumbs?: ReactNode;
	lastUpdated?: string;
	recordId?: string;
	properties?: readonly RecordProperty[];
	propertyGroups?: readonly RecordPropertyGroup[];
	propertyLayout?: "stacked" | "inline";
	propertiesCollapsible?: boolean;
	propertiesSummary?: string;
	propertiesDefaultOpen?: boolean;
	actions?: ReactNode;
	meta?: ReactNode;
}

export default function RecordPageHeader({
	icon,
	title,
	subtitle,
	breadcrumbs,
	lastUpdated,
	recordId,
	properties,
	propertyGroups,
	propertyLayout = "inline",
	propertiesCollapsible = true,
	propertiesSummary = "Details",
	propertiesDefaultOpen = false,
	actions,
	meta,
}: RecordPageHeaderProps) {
	const [copied, setCopied] = useState(false);

	const handleCopyId = useCallback(async () => {
		if (!recordId || !navigator.clipboard) {
			return;
		}
		try {
			await navigator.clipboard.writeText(recordId);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2000);
		} catch {
			setCopied(false);
		}
	}, [recordId]);

	const groups =
		propertyGroups ??
		(properties && properties.length > 0
			? [{ properties }]
			: undefined);

	return (
		<header className="record-page-header">
			<div className="record-page-topbar">
				{breadcrumbs ? (
					<div className="record-page-breadcrumbs">{breadcrumbs}</div>
				) : (
					<span />
				)}
				<div className="record-page-utility">
					{lastUpdated ? (
						<span className="record-page-edited">{formatEditedLabel(lastUpdated)}</span>
					) : null}
					{recordId ? (
						<button
							type="button"
							className="record-page-copy"
							onClick={() => void handleCopyId()}
							aria-label={`Copy ID ${recordId}`}
						>
							{copied ? "Copied" : "Copy ID"}
						</button>
					) : null}
				</div>
			</div>

			<div className="record-page-title-block">
				{icon ? <div className="record-page-icon-wrap">{icon}</div> : null}
				<div className="record-page-title-copy">
					<h3 className="record-page-title">{title}</h3>
					{subtitle ? <p className="record-page-subtitle">{subtitle}</p> : null}
				</div>
			</div>

			{meta || actions ? (
				<div className="record-page-action-bar">
					{meta ? <div className="record-page-meta">{meta}</div> : <span />}
					{actions ? (
						<div className="record-page-utility-actions">{actions}</div>
					) : null}
				</div>
			) : null}

			{groups && groups.length > 0 ? (
				propertiesCollapsible ? (
					<details
						className="record-page-properties-panel"
						open={propertiesDefaultOpen || undefined}
					>
						<summary className="record-page-properties-summary">
							{propertiesSummary}
						</summary>
						<div className="record-page-properties">
							{groups.map((group, index) => (
								<div
									key={group.title ?? `property-group-${index}`}
									className="record-property-group"
								>
									{group.title ? (
										<h4 className="record-property-group-title">{group.title}</h4>
									) : null}
									<RecordPropertyRow
										properties={group.properties}
										layout={propertyLayout}
									/>
								</div>
							))}
						</div>
					</details>
				) : (
					<div className="record-page-properties record-page-properties--static">
						{groups.map((group, index) => (
							<div
								key={group.title ?? `property-group-${index}`}
								className="record-property-group"
							>
								{group.title ? (
									<h4 className="record-property-group-title">{group.title}</h4>
								) : null}
								<RecordPropertyRow
									properties={group.properties}
									layout={propertyLayout}
								/>
							</div>
						))}
					</div>
				)
			) : null}

			<hr className="record-page-divider" />
		</header>
	);
}
