import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

export interface SearchablePickerOption {
  value: string;
  label: string;
  secondary?: string | null;
  meta?: string | null;
}

interface SearchablePickerProps {
  label: string;
  value: string;
  options: SearchablePickerOption[];
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  clearable?: boolean;
  allowFreeText?: boolean;
  mono?: boolean;
  onChange: (value: string) => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
}

function optionSearchText(option: SearchablePickerOption): string {
  return [option.value, option.label, option.secondary, option.meta]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function resolvePickerQuery(
  query: string,
  options: SearchablePickerOption[],
  allowFreeText: boolean,
  currentValue: string,
): string {
  const trimmed = query.trim();
  if (!trimmed) {
    return allowFreeText ? "" : currentValue;
  }

  const lowered = trimmed.toLowerCase();
  const byValue = options.find((option) => option.value.toLowerCase() === lowered);
  if (byValue) {
    return byValue.value;
  }

  const byLabel = options.find((option) => option.label.toLowerCase() === lowered);
  if (byLabel) {
    return byLabel.value;
  }

  if (allowFreeText) {
    return trimmed;
  }

  const partial = options.find((option) => optionSearchText(option).includes(lowered));
  return partial?.value ?? currentValue;
}

export default function SearchablePicker({
  label,
  value,
  options,
  placeholder = "Select an option",
  emptyMessage = "No matching options",
  disabled = false,
  clearable = false,
  allowFreeText = false,
  mono = false,
  onChange,
  isOpen: controlledOpen,
  onOpenChange,
}: SearchablePickerProps) {
  const fieldId = useId();
  const inputId = `${fieldId}-input`;
  const listboxId = `${fieldId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const isOpen = controlledOpen ?? internalOpen;

  const setOpen = useCallback(
    (open: boolean): void => {
      onOpenChange?.(open);
      if (controlledOpen === undefined) {
        setInternalOpen(open);
      }
    },
    [controlledOpen, onOpenChange],
  );

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  const updateMenuPosition = useCallback((): MenuPosition | null => {
    const control = controlRef.current;
    if (!control) {
      return null;
    }
    const rect = control.getBoundingClientRect();
    const nextPosition = {
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
    };
    setMenuPosition(nextPosition);
    return nextPosition;
  }, []);

  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return options;
    }
    return options.filter((option) => optionSearchText(option).includes(needle));
  }, [options, query]);

  const closedDisplayValue = useMemo(() => {
    if (!value) {
      return "";
    }
    if (selectedOption) {
      return selectedOption.label;
    }
    return value;
  }, [selectedOption, value]);

  const displayValue = isOpen ? query : closedDisplayValue;

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setHighlightIndex(0);
      setMenuPosition(null);
    }
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }
    updateMenuPosition();
  }, [isOpen, updateMenuPosition, filteredOptions.length]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleLayoutChange(): void {
      updateMenuPosition();
    }

    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
    };
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }

      const currentQuery = inputRef.current?.value ?? query;
      onChange(resolvePickerQuery(currentQuery, options, allowFreeText, value));
      setOpen(false);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [allowFreeText, isOpen, onChange, options, query, setOpen, value]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query]);

  function openPicker(): void {
    if (disabled) {
      return;
    }
    setQuery(closedDisplayValue);
    setOpen(true);
  }

  function closePicker(nextQuery = inputRef.current?.value ?? query): void {
    onChange(resolvePickerQuery(nextQuery, options, allowFreeText, value));
    setOpen(false);
  }

  function selectOption(optionValue: string): void {
    onChange(optionValue);
    setOpen(false);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        openPicker();
        return;
      }
      setHighlightIndex((current) => Math.min(current + 1, filteredOptions.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter" && isOpen && filteredOptions[highlightIndex]) {
      event.preventDefault();
      selectOption(filteredOptions[highlightIndex].value);
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const menu =
    isOpen && menuPosition
      ? createPortal(
          <ul
            ref={menuRef}
            id={listboxId}
            className="searchable-picker-menu"
            role="listbox"
            aria-label={`${label} options`}
            style={{
              top: menuPosition.top,
              left: menuPosition.left,
              width: menuPosition.width,
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            {filteredOptions.length === 0 ? (
              <li className="searchable-picker-empty">{emptyMessage}</li>
            ) : (
              filteredOptions.map((option, index) => {
                const isSelected = value === option.value;
                const isHighlighted = index === highlightIndex;

                return (
                  <li key={option.value} role="presentation">
                    <button
                      id={`${listboxId}-${option.value}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`searchable-picker-option${isSelected ? " selected" : ""}${
                        isHighlighted ? " highlighted" : ""
                      }`}
                      onMouseEnter={() => setHighlightIndex(index)}
                      onClick={() => selectOption(option.value)}
                    >
                      <span className="searchable-picker-option-copy">
                        <span
                          className={`searchable-picker-option-title${mono ? " mono" : ""}`}
                        >
                          {option.label}
                        </span>
                        {option.secondary ? (
                          <span className="searchable-picker-option-secondary">
                            {option.secondary}
                          </span>
                        ) : null}
                      </span>
                      {option.meta ? (
                        <span className="searchable-picker-option-meta">{option.meta}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>,
          document.body,
        )
      : null;

  return (
    <>
      <div
        ref={rootRef}
        className={`searchable-picker${isOpen ? " open" : ""}${value ? " has-value" : ""}${
          mono ? " mono" : ""
        }${disabled ? " disabled" : ""}`}
      >
        <div className="searchable-picker-field">
          <label className="searchable-picker-label" htmlFor={inputId}>
            {label}
          </label>
          <div ref={controlRef} className="searchable-picker-control">
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              role="combobox"
              aria-expanded={isOpen}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={
                isOpen && filteredOptions[highlightIndex]
                  ? `${listboxId}-${filteredOptions[highlightIndex].value}`
                  : undefined
              }
              value={displayValue}
              placeholder={placeholder}
              spellCheck={false}
              autoComplete="off"
              disabled={disabled}
              onFocus={openPicker}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                if (allowFreeText) {
                  onChange(nextQuery);
                }
                if (!isOpen) {
                  setOpen(true);
                }
              }}
              onBlur={(event) => {
                const nextTarget = event.relatedTarget as Node | null;
                if (
                  nextTarget &&
                  (rootRef.current?.contains(nextTarget) || menuRef.current?.contains(nextTarget))
                ) {
                  return;
                }
                if (isOpen) {
                  closePicker(event.currentTarget.value);
                  return;
                }
                onChange(
                  resolvePickerQuery(event.currentTarget.value, options, allowFreeText, value),
                );
              }}
              onKeyDown={handleInputKeyDown}
            />
            {clearable && value ? (
              <button
                type="button"
                className="searchable-picker-clear"
                aria-label={`Clear ${label}`}
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange("");
                  setQuery("");
                  setOpen(false);
                }}
              >
                ×
              </button>
            ) : null}
            <button
              type="button"
              className="searchable-picker-toggle"
              aria-label={isOpen ? `Close ${label} list` : `Open ${label} list`}
              aria-expanded={isOpen}
              aria-controls={listboxId}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (isOpen) {
                  closePicker();
                } else {
                  openPicker();
                }
              }}
            >
              {isOpen ? "▴" : "▾"}
            </button>
          </div>
          {!isOpen && selectedOption?.secondary ? (
            <span className="searchable-picker-sublabel">{selectedOption.secondary}</span>
          ) : null}
        </div>
      </div>
      {menu}
    </>
  );
}
