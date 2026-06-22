const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const UNITS: readonly { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
	{ unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
	{ unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
	{ unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
	{ unit: "day", ms: 24 * 60 * 60 * 1000 },
	{ unit: "hour", ms: 60 * 60 * 1000 },
	{ unit: "minute", ms: 60 * 1000 },
	{ unit: "second", ms: 1000 },
];

export function formatRelativeTime(value: string | Date): string {
	const date = value instanceof Date ? value : new Date(value);
	const deltaMs = date.getTime() - Date.now();

	for (const { unit, ms } of UNITS) {
		const amount = Math.round(deltaMs / ms);
		if (Math.abs(amount) >= 1 || unit === "second") {
			return rtf.format(amount, unit);
		}
	}

	return rtf.format(0, "second");
}

export function formatEditedLabel(value: string | Date): string {
	return `Edited ${formatRelativeTime(value)}`;
}
