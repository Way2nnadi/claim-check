export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "policy-nexus-theme";

function getStorage(): Storage | null {
	try {
		if (
			typeof window !== "undefined" &&
			typeof window.localStorage?.getItem === "function"
		) {
			return window.localStorage;
		}
	} catch {
		return null;
	}
	return null;
}

export function getStoredTheme(): Theme | null {
	const storage = getStorage();
	if (!storage) {
		return null;
	}

	const stored = storage.getItem(THEME_STORAGE_KEY);
	if (stored === "dark" || stored === "light") {
		return stored;
	}
	return null;
}

export function resolveTheme(): Theme {
	const stored = getStoredTheme();
	if (stored) {
		return stored;
	}
	if (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-color-scheme: light)").matches
	) {
		return "light";
	}
	return "dark";
}

export function applyTheme(theme: Theme): void {
	if (typeof document === "undefined") {
		return;
	}
	document.documentElement.dataset.theme = theme;
	document.documentElement.style.colorScheme = theme;
}

export function initTheme(): Theme {
	const theme = resolveTheme();
	applyTheme(theme);
	return theme;
}

export function persistTheme(theme: Theme): void {
	const storage = getStorage();
	if (storage) {
		storage.setItem(THEME_STORAGE_KEY, theme);
	}
	applyTheme(theme);
}
