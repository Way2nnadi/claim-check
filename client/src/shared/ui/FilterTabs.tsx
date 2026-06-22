export interface FilterTabItem {
	id: string;
	label: string;
	count?: number;
}

interface FilterTabsProps {
	tabs: readonly FilterTabItem[];
	activeTabId: string;
	onTabChange: (tabId: string) => void;
	ariaLabel: string;
	idPrefix: string;
	panelId?: string;
	className?: string;
}

export default function FilterTabs({
	tabs,
	activeTabId,
	onTabChange,
	ariaLabel,
	idPrefix,
	panelId,
	className,
}: FilterTabsProps) {
	return (
		<div
			className={className ? `notion-filter-tabs ${className}` : "notion-filter-tabs"}
			role="tablist"
			aria-label={ariaLabel}
		>
			{tabs.map((tab) => {
				const isActive = activeTabId === tab.id;

				return (
					<button
						key={tab.id}
						type="button"
						role="tab"
						id={`${idPrefix}-${tab.id}`}
						className={`notion-filter-tab${isActive ? " is-active" : ""}`}
						data-tab-id={tab.id}
						aria-selected={isActive}
						aria-controls={panelId}
						onClick={() => onTabChange(tab.id)}
					>
						<span className="notion-filter-tab-label">{tab.label}</span>
						{tab.count !== undefined ? (
							<span className="notion-filter-tab-count">{tab.count}</span>
						) : null}
					</button>
				);
			})}
		</div>
	);
}
