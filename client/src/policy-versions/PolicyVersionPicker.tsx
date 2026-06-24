import SearchablePicker, {
  type SearchablePickerOption,
} from "../shared/ui/SearchablePicker";
import type { PolicyVersionSummary } from "./types";

interface PolicyVersionPickerProps {
  label?: string;
  value: string;
  policyVersions: PolicyVersionSummary[];
  disabled?: boolean;
  onChange: (policyVersionId: string) => void;
}

export default function PolicyVersionPicker({
  label = "Policy Version",
  value,
  policyVersions,
  disabled = false,
  onChange,
}: PolicyVersionPickerProps) {
  const options: SearchablePickerOption[] = policyVersions.map(
    (policyVersion) => ({
      value: policyVersion.policy_version_id,
      label: policyVersion.policy_version_id,
      meta: `${policyVersion.rule_count} rule${policyVersion.rule_count === 1 ? "" : "s"}`,
    }),
  );

  return (
    <SearchablePicker
      label={label}
      value={value}
      options={options}
      placeholder="Select a Policy Version"
      emptyMessage="No matching Policy Versions"
      disabled={disabled}
      showAllOnOpen
      onChange={onChange}
    />
  );
}
