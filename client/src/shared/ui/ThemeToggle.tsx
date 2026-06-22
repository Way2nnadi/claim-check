import { useEffect, useState } from "react";
import {
	persistTheme,
	resolveTheme,
	type Theme,
} from "../theme";

function readAppliedTheme(): Theme {
	if (typeof document !== "undefined") {
		const applied = document.documentElement.dataset.theme;
		if (applied === "light" || applied === "dark") {
			return applied;
		}
	}
	return resolveTheme();
}

export default function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>(() => readAppliedTheme());

	useEffect(() => {
		setTheme(readAppliedTheme());
	}, []);

	function toggleTheme(): void {
		const nextTheme: Theme = theme === "dark" ? "light" : "dark";
		persistTheme(nextTheme);
		setTheme(nextTheme);
	}

	const label =
		theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

	return (
		<button
			type="button"
			className={`theme-dial${theme === "light" ? " is-light" : ""}`}
			onClick={toggleTheme}
			aria-label={label}
			title={label}
		>
			<span className="theme-dial-glyph" aria-hidden="true">
				{theme === "dark" ? "☾" : "☀"}
			</span>
		</button>
	);
}
