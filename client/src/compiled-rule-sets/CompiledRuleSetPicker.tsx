import SearchablePicker, {
  type SearchablePickerOption,
} from "../shared/ui/SearchablePicker";
import { shortenId } from "../shared/format/common";
import { summarizeCompileCounts } from "./format";
import type { CompiledRuleSet } from "./types";

interface CompiledRuleSetPickerProps {
  label?: string;
  value: string;
  compiledRuleSets: CompiledRuleSet[];
  disabled?: boolean;
  onChange: (compiledRuleSetId: string) => void;
}

export default function CompiledRuleSetPicker({
  label = "Compiled Rule Set",
  value,
  compiledRuleSets,
  disabled = false,
  onChange,
}: CompiledRuleSetPickerProps) {
  const options: SearchablePickerOption[] = compiledRuleSets.map(
    (compiledRuleSet) => ({
      value: compiledRuleSet.compiled_rule_set_id,
      label: `${shortenId(compiledRuleSet.compiled_rule_set_id, 12)} · ${compiledRuleSet.policy_version_id}`,
      meta: summarizeCompileCounts(compiledRuleSet.summary),
    }),
  );

  return (
    <SearchablePicker
      label={label}
      value={value}
      options={options}
      placeholder="Select a Compiled Rule Set"
      emptyMessage="No matching Compiled Rule Sets"
      disabled={disabled}
      showAllOnOpen
      onChange={onChange}
    />
  );
}
