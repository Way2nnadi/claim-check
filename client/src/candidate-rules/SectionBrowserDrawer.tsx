import type { DocumentSection } from "../policy-documents/types";
import { useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";

import MissionDrawerHead from "../shared/ui/MissionDrawerHead";

interface SectionBrowserDrawerProps {
  open: boolean;
  documentId: string;
  sections: DocumentSection[];
  filter: string;
  selectedSectionId: string | null;
  citedSectionId: string;
  onFilterChange: (value: string) => void;
  onSelect: (sectionId: string) => void;
  onClose: () => void;
}

function sectionTitle(section: DocumentSection): string {
  const path = section.heading_path.length > 0 ? section.heading_path : ["Preamble"];
  const label = path[path.length - 1];
  return label.length > 72 ? `${label.slice(0, 71).trimEnd()}…` : label;
}

function sectionMatchesFilter(section: DocumentSection, filter: string): boolean {
  const query = filter.trim().toLowerCase();
  if (!query) {
    return true;
  }
  const path = section.heading_path.join(" ").toLowerCase();
  return path.includes(query) || section.content.toLowerCase().includes(query);
}

export default function SectionBrowserDrawer({
  open,
  documentId,
  sections,
  filter,
  selectedSectionId,
  citedSectionId,
  onFilterChange,
  onSelect,
  onClose,
}: SectionBrowserDrawerProps) {
  const filteredSections = useMemo(
    () => sections.filter((section) => sectionMatchesFilter(section, filter)),
    [filter, sections],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="mission-drawer-root">
      <button
        type="button"
        className="mission-drawer-backdrop"
        aria-label="Close section browser"
        onClick={onClose}
      />
      <dialog
        open
        className="mission-drawer"
        aria-labelledby="review-sections-drawer-title"
      >
        <MissionDrawerHead
          folio="Document sections"
          title={documentId}
          titleId="review-sections-drawer-title"
          lede={`${sections.length} sections`}
          onClose={onClose}
        />

        <div className="mission-drawer-body review-section-browser">
          <label className="review-section-browser-search">
            <input
              type="search"
              value={filter}
              placeholder="Find section…"
              aria-label="Filter sections"
              spellCheck={false}
              onChange={(event) => onFilterChange(event.target.value)}
            />
          </label>
          <ul className="review-section-list">
            {filteredSections.map((section) => {
              const isSelected = section.section_id === selectedSectionId;
              const isCited = section.section_id === citedSectionId;
              const depth = Math.max(section.heading_path.length, 1);

              return (
                <li key={section.section_id}>
                  <button
                    type="button"
                    className={`review-section-list-item${isSelected ? " selected" : ""}${isCited ? " cited" : ""}`}
                    style={{ "--section-depth": depth } as CSSProperties}
                    aria-current={isSelected ? "true" : undefined}
                    aria-label={`${sectionTitle(section)}${isCited ? ", cited section" : ""}`}
                    title={section.heading_path.join(" › ") || "Preamble"}
                    onClick={() => onSelect(section.section_id)}
                  >
                    <span className="review-section-list-title">{sectionTitle(section)}</span>
                    {isCited ? <span className="review-section-list-badge">Cited</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {filteredSections.length === 0 ? (
            <p className="review-section-browser-empty">No sections match your search.</p>
          ) : null}
        </div>
      </dialog>
    </div>,
    document.body,
  );
}
