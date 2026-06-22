import type { ReactNode } from "react";

export interface BreadcrumbItem {
	label: string;
	icon?: ReactNode;
	onClick?: () => void;
}

interface BreadcrumbsProps {
	items: readonly BreadcrumbItem[];
}

export default function Breadcrumbs({ items }: BreadcrumbsProps) {
	if (items.length === 0) {
		return null;
	}

	return (
		<nav className="page-breadcrumbs" aria-label="Breadcrumb">
			<ol>
				{items.map((item, index) => {
					const isLast = index === items.length - 1;

					return (
						<li key={`${item.label}-${index}`}>
							{!isLast && item.onClick ? (
								<button type="button" onClick={item.onClick}>
									{item.icon ? (
										<span className="breadcrumb-icon">{item.icon}</span>
									) : null}
									{item.label}
								</button>
							) : (
								<span aria-current={isLast ? "page" : undefined}>
									{item.icon ? (
										<span className="breadcrumb-icon">{item.icon}</span>
									) : null}
									{item.label}
								</span>
							)}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}
