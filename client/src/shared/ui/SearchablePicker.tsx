import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface SearchablePickerOption<T extends string = string> {
  value: T;
  label: string;
  secondary?: string | null;
  meta?: string | null;
  icon?: ReactNode;
}

function PickerChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`searchable-picker-chevron${open ? " open" : ""}`}
      viewBox="0 0 16 16"
      width={14}
      height={14}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4.5 6L8 9.5 11.5 6" />
    </svg>
  );
}

interface SearchablePickerProps<T extends string = string> {
  label: string;
  value: T;
  options: readonly SearchablePickerOption<T>[] | SearchablePickerOption<T>[];
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  clearable?: boolean;
  allowFreeText?: boolean;
  mono?: boolean;
  hideLabel?: boolean;
  inputId?: string;
  showAllOnOpen?: boolean;
  onChange: (value: T) => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
}

function optionSearchText<T extends string>(option: SearchablePickerOption<T>): string {
  return [option.value, option.label, option.secondary, option.meta]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function resolvePickerQuery<T extends string>(
  query: string,
  options: readonly SearchablePickerOption<T>[] | SearchablePickerOption<T>[],
  allowFreeText: boolean,
  currentValue: T,
): T {
  const trimmed = query.trim();
  if (!trimmed) {
    return allowFreeText ? ("" as T) : currentValue;
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
    return trimmed as T;
  }

  const partial = options.find((option) => optionSearchText(option).includes(lowered));
  return partial?.value ?? currentValue;
}

export default function SearchablePicker<T extends string = string>({
  label,
  value,
  options,
  placeholder = "Select an option",
  emptyMessage = "No matching options",
  disabled = false,
  clearable = false,
  allowFreeText = false,
  mono = false,
  hideLabel = false,
  inputId: inputIdProp,
  showAllOnOpen = false,
  onChange,
  isOpen: controlledOpen,
  onOpenChange,
}: SearchablePickerProps<T>) {
  const fieldId = useId();
  const inputId = inputIdProp ?? `${fieldId}-input`;
  const listboxId = `${fieldId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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
  }, [isOpen, updateMenuPosition]);

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

      const currentQuery = inputRef.current?.value ?? "";
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
  }, [allowFreeText, isOpen, onChange, options, setOpen, value]);

  function openPicker(): void {
    if (disabled) {
      return;
    }
    setQuery(showAllOnOpen ? "" : closedDisplayValue);
    setHighlightIndex(0);
    setOpen(true);
  }

  function closePicker(nextQuery = inputRef.current?.value ?? query): void {
    onChange(resolvePickerQuery(nextQuery, options, allowFreeText, value));
    setOpen(false);
  }

  function selectOption(optionValue: T): void {
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
          <div
            ref={menuRef}
            id={listboxId}
            className="searchable-picker-menu"
            // biome-ignore lint/a11y/useSemanticElements: popup list for combobox input
            role="listbox"
            tabIndex={-1}
            aria-label={`${label} options`}
            style={{
              top: menuPosition.top,
              left: menuPosition.left,
              width: menuPosition.width,
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            {filteredOptions.length === 0 ? (
              <div className="searchable-picker-empty">{emptyMessage}</div>
            ) : (
              filteredOptions.map((option, index) => {
                const isSelected = value === option.value;
                const isHighlighted = index === highlightIndex;

                return (
                  <div
                    key={option.value}
                    id={`${listboxId}-${option.value}`}
                    // biome-ignore lint/a11y/useSemanticElements: combobox option target for activedescendant
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={-1}
                    className={`searchable-picker-option${isSelected ? " selected" : ""}${
                      isHighlighted ? " highlighted" : ""
                    }`}
                    onMouseEnter={() => setHighlightIndex(index)}
                    onClick={() => selectOption(option.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectOption(option.value);
                      }
                    }}
                  >
                    {option.icon ? (
                      <span className="searchable-picker-option-icon">{option.icon}</span>
                    ) : null}
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
                  </div>
                );
              })
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div
        ref={rootRef}
        className={`searchable-picker${isOpen ? " open" : ""}${value ? " has-value" : ""}${
          clearable ? " clearable" : ""
        }${mono ? " mono" : ""}${disabled ? " disabled" : ""}`}
      >
        <div className="searchable-picker-field">
          {hideLabel ? null : (
            <label className="searchable-picker-label" htmlFor={inputId}>
              {label}
            </label>
          )}
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
                setHighlightIndex(0);
                if (allowFreeText) {
                  onChange(nextQuery as T);
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
            <div className="searchable-picker-actions">
              {clearable && value ? (
                <button
                  type="button"
                  className="searchable-picker-clear"
                  aria-label={`Clear ${label}`}
                  disabled={disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange("" as T);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <svg viewBox="0 0 16 16" width={14} height={14} fill="currentColor" aria-hidden="true">
                    <path d="M4.22 3.22a.75.75 0 0 1 1.06 0L8 5.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L9.06 7l2.72 2.72a.75.75 0 1 1-1.06 1.06L8 8.06l-2.72 2.72a.75.75 0 1 1-1.06-1.06L6.94 7 4.22 4.28a.75.75 0 0 1 0-1.06z" />
                  </svg>
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
                <PickerChevron open={isOpen} />
              </button>
            </div>
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
