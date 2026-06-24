# Defer employee and fine-grained jurisdiction scope resolution in v1

**Status:** accepted

Compliance Evaluation v1 uses the uploaded **Expense Report** CSV as the only source of row-level expense facts. Expense rows carry `employee_id`, `expense_date`, `expense_category`, `amount`, `currency`, optional `country`, optional `travel_type`, and the current evidence fields (`business_purpose`, `attendee_list`, `manager_approval`, `receipt_attached`, `trip_id`, `submission_days`). `currency` belongs on the expense row and Rule applicability, not Rule Scope.

Rule Scope may preserve extracted or manually-authored `employee_group`, `department`, `role`, `seniority`, `state`, `city`, and `region` values so the policy contract is not lost. In v1 those dimensions are not resolved from Expense Report rows. They are deferred to future HR profile, travel profile, or jurisdiction lookup services.

Rules whose Scope includes any deferred dimension are compiled with `skipped_non_enforceable` status and an explicit skip reason. During a **Compliance Evaluation Run**, when an expense row matches all resolvable dimensions on such a Rule (`expense_category`, `country`, `travel_type`, effective dates), the row **Evaluation Outcome** is `needs_review` — never silent `pass` and never an automated `violation` from the Rule's condition. Rows that do not match the resolvable dimensions still `pass` for that Rule.

Historical reproducibility is preserved because each **Compiled Rule Set** entry keeps the full source Rule, including deferred Scope fields and citations. Evaluation Runs store the selected compiled rule set, expense input fingerprint, row outcomes, reasons, and evidence used at execution time.

We rejected adding optional employee and jurisdiction columns to the v1 CSV because buyers have not yet wired HR master data or jurisdiction normalization into Expense Report import, and partial matching without trusted facts would produce false violations. We rejected silent skipping because scoped Rules for executive tiers, departments, roles, seniority bands, states, cities, or regions would appear compliant when they were never evaluated — an unacceptable audit gap.

The follow-up connector work adds authoritative lookup boundaries for employee and jurisdiction facts, compiles matching enforceable Rules as `compiled`, and evaluates them with full scope equality. When a Rule requires a lookup-backed dimension and the lookup cannot resolve it for the row, the outcome is `missing_evidence` with the unresolved dimension in missing evidence fields.

## Considered options

| Option | CSV impact | Outcome when deferred data absent | Rejected because |
|--------|------------|----------------------------------------|------------------|
| Add optional employee and jurisdiction columns now | New optional columns | Match when present; TBD when absent | v1 CSV contract, HR data, and jurisdiction normalization are not ready; risks false violations |
| Compile-time skip + `needs_review` on partial scope match | No change | `needs_review` when other scope dims match | **Chosen** |
| Defer entirely (silent skip) | No change | Silent `pass` | Rules never surface; compliance blind spot |

## Consequences

- **Compiled Rule Set** summaries count Rules scoped by deferred dimensions under `skipped_non_enforceable`; UI and API surface the skip reason per Rule entry.
- **Compliance Review** queue receives deferred-scope Rules alongside `guidance`/`subjective` items; rationale cites the v1 data gap.
- **Rule Test Cases** for deferred-scope Rules follow the same partial-scope / `needs_review` contract until lookup-backed evaluation ships.
- Follow-on implementation can add lookup-backed resolution without changing the v1 Expense Report CSV contract.

## Follow-up acceptance criteria (implementation)

- [ ] Employee facts (`employee_group`, `department`, `role`, `seniority`) resolve from an HR/profile connector or versioned lookup snapshot.
- [ ] Jurisdiction facts (`state`, `city`, `region`) resolve from a travel profile, expense location, or jurisdiction lookup snapshot.
- [ ] Enforceable Rules with lookup-backed Scope dimensions compile as `compiled` when otherwise valid.
- [ ] Scope matcher compares every resolved dimension with the Rule Scope value.
- [ ] When Rule Scope requires a lookup-backed dimension and it cannot be resolved for the row, **Evaluation Outcome** is `missing_evidence` with that dimension in missing evidence fields.
- [ ] Evaluation Runs persist the lookup snapshot identifiers needed to reproduce historical results.
- [ ] Golden corpus and API tests cover at least one enforceable employee-scope Rule, one jurisdiction-scope Rule, and one row with an unresolved lookup dimension.
