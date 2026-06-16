# Controlled-autonomy boundary: LLM extracts, deterministic layer validates, human approves

The LLM is used only to extract candidate Rules from policy text, classify their enforceability, and attach QA flags. It never writes directly to the Structured Policy Store. A deterministic layer validates each candidate against the Rule schema (required fields, valid enums, resolvable Citation), and a human Approver must explicitly approve a candidate before it enters the source of truth.

We chose this over a more autonomous "agent reads docs and maintains the rule store" design because the target customers are regulated enterprises for whom auditability and human oversight are buying criteria, and because OWASP LLM risks (excessive agency, overreliance on LLM outputs) make unilateral LLM writes to the source of truth unacceptable. The trade-off is slower onboarding (a human must approve rules) in exchange for a defensible, auditable source of truth.
