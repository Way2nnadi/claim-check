import SearchablePicker, { type SearchablePickerOption } from "../shared/ui/SearchablePicker";

export interface RegistryPickerOption {
  value: string;
  primary: string;
  secondary?: string | null;
}

interface RegistryPickerProps {
  label: string;
  value: string;
  options: RegistryPickerOption[];
  disabled?: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
}

export default function RegistryPicker({
  label,
  value,
  options,
  disabled = false,
  isOpen,
  onOpenChange,
  onChange,
}: RegistryPickerProps) {
  const pickerOptions: SearchablePickerOption[] = options.map((option) => ({
    value: option.value,
    label: option.primary,
    secondary: option.secondary,
  }));

  return (
    <SearchablePicker
      label={label}
      value={value}
      options={pickerOptions}
      placeholder="Select a registry pin"
      emptyMessage="No matching pins"
      disabled={disabled}
      mono
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onChange={onChange}
    />
  );
}
