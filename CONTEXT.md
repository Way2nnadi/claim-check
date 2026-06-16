# Policy Pipeline

The policy pipeline ingests a company's internal expense policy documents, extracts candidate rules, has a human approve them, and stores them in a structured policy store that becomes the source of truth for downstream test generation and expense evaluation. This context ends at the approved policy store; it does not compile rules, generate tests, or evaluate expenses.

## Language

**Policy Document**:
A company-supplied source file describing expense policy (travel, meals, lodging, mileage, etc.) that the pipeline ingests.
_Avoid_: policy file, doc

**Rule**:
A single enforceable condition within a single scope, extracted from a Policy Document. Atomic and individually approvable; one source sentence may yield several Rules.
_Avoid_: policy, check, test, constraint

**Enforceability Class**:
The classification of a policy statement as `enforceable` (machine-checkable), `guidance` (soft, advisory), or `subjective` (requires human judgment). Every extracted statement carries one.
_Avoid_: rule type, severity

**Scope**:
The set of conditions under which a Rule applies (e.g. country, expense category, travel type, employee group, effective date).
_Avoid_: filter, context

**Exception**:
A condition attached to a Rule that, when its required evidence is present, changes the Rule's outcome (e.g. client entertainment over the meal cap requires manager approval).
_Avoid_: override, waiver

**Structured Policy Store**:
The versioned, human-approved store of Rules. The source of truth for the rest of the system. Not the raw vector database.
_Avoid_: rule database, policy DB

**Citation**:
The full anchor binding a Rule to its source: document id, document version, stable section id (heading path + content hash), verbatim quote, and character offsets. A Rule is invalid without a resolvable Citation.
_Avoid_: reference, source link

**QA Flag**:
A warning attached to a candidate Rule before human review (e.g. missing threshold, ambiguous scope, possible contradiction, undefined term, low extraction confidence).
_Avoid_: error, lint

**Candidate Rule**:
A Rule in the `extracted` or `in_review` state, not yet approved. Carries both the original LLM-extracted values and any human edits.
_Avoid_: draft, proposal

**Document Version**:
An immutable snapshot of an uploaded Policy Document. Re-uploading the same policy creates a new Document Version, never mutates the old one.
_Avoid_: revision, upload

**Policy Version**:
An immutable, published snapshot of the approved Rules at a point in time. The unit downstream consumers pin to for reproducible runs.
_Avoid_: release, ruleset

**Approver**:
The role authorized to move a Candidate Rule into the Structured Policy Store. Distinct from admin and viewer roles.
_Avoid_: reviewer, user

## Relationships

- A **Policy Document** yields many candidate **Rules**
- A **Rule** has exactly one **Enforceability Class** and exactly one **Scope**
- A **Rule** may carry zero or more **Exceptions**
- Only `enforceable` **Rules** carry machine-checkable conditions; `guidance`/`subjective` are stored as cited, human-routed items
- Approved **Rules** live in the **Structured Policy Store**
- A **Policy Document** has many immutable **Document Versions**; extraction runs against one **Document Version**
- A **Candidate Rule** carries a **Citation** and zero or more **QA Flags** before reaching an **Approver**
- An **Approver** publishes a set of approved **Rules** as an immutable **Policy Version**
- Re-ingesting a new **Document Version** diffs candidate **Rules** against the current **Policy Version** so only deltas need re-approval

## Example dialogue

> **Dev:** "This sentence caps meals at $75 domestic and $100 international, with a client-entertainment exception. How many **Rules**?"
> **Domain expert:** "Two **Rules** — one per **Scope** — and both carry the client-entertainment **Exception**. They're each `enforceable`."
> **Dev:** "And 'entertainment must be in good taste'?"
> **Domain expert:** "That's a `subjective` statement. We still store and cite it, but it has no machine condition — it routes to a human."

## Flagged ambiguities

- "test" was used to mean both the extracted policy artifact and downstream generated test cases — resolved: inside this context the artifact is a **Rule**; test-case generation is out of scope.
