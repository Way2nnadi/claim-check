import CompiledRuleSetCatalog from "../compiled-rule-sets/CompiledRuleSetCatalog";
import type { AuthenticatedPrincipal } from "../shared/auth/types";

interface RuleTestCaseCatalogProps {
  principal: AuthenticatedPrincipal;
  initialCompiledRuleSetId?: string | null;
}

export default function RuleTestCaseCatalog({
  principal,
  initialCompiledRuleSetId = null,
}: RuleTestCaseCatalogProps) {
  return (
    <CompiledRuleSetCatalog
      principal={principal}
      initialCompiledRuleSetId={initialCompiledRuleSetId}
      variant="rule-test-cases"
    />
  );
}
