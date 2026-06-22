import type { ReactNode } from "react";

export interface RecordProperty {
	label: string;
	icon?: ReactNode;
	value: ReactNode;
	empty?: boolean;
}

interface RecordPropertyRowProps {
	properties: readonly RecordProperty[];
	layout?: "stacked" | "inline";
}

export default function RecordPropertyRow({
	properties,
	layout = "stacked",
}: RecordPropertyRowProps) {
	if (properties.length === 0) {
		return null;
	}

	return (
		<dl
			className={
				layout === "inline"
					? "record-property-row record-property-row--inline"
					: "record-property-row"
			}
			aria-label="Properties"
		>
			{properties.map((property) => (
				<div key={property.label} className="record-property">
					<dt className="record-property-label">
						{property.icon ? (
							<span className="record-property-icon">{property.icon}</span>
						) : null}
						<span>{property.label}</span>
					</dt>
					<dd
						className={
							property.empty ? "record-property-value is-empty" : "record-property-value"
						}
					>
						{property.empty ? "Empty" : property.value}
					</dd>
				</div>
			))}
		</dl>
	);
}
