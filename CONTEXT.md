# Policy Pipeline

The policy pipeline ingests a company's internal expense policy documents, extracts candidate rules, has a human approve them, and stores them in a structured policy store. Downstream, a **Compiled Rule Set** derived from a **Policy Version** drives **Rule Test Cases** and **Compliance Evaluation Runs** against imported **Expense Reports**, producing per-row **Evaluation Outcomes** and a **Compliance Review** queue for outcomes that are not final on their own.

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
The full anchor binding a Rule to its source: document id, document version, stable section id (heading path + content hash), verbatim quote, and character offsets. An extracted Rule is invalid without a resolvable Citation; a Manual Rule may omit Citation when the policy knowledge is not anchored to a Policy Document.
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

**Policy Version Diff**:
The comparison of new **Candidate Rules** from a **Document Version** extraction against extracted, cited **Rules** from the same **Policy Document** in the current **Policy Version**. Categories: **added**, **changed**, **removed**, **unchanged**.
_Avoid_: re-ingestion delta, diff bucket

**Unchanged Rule** (in a Policy Version Diff):
A new **Candidate Rule** that semantically matches a published **Rule** (statement, enforceability, scope, full condition, applicability, exceptions).
_Avoid_: exact match, no-op delta

**Changed Rule** (in a Policy Version Diff):
A new **Candidate Rule** that relaxed-matches a published **Rule** (number-normalized statement shape, scope, condition field, applicability) but fails exact semantic match.
_Avoid_: modified rule, fuzzy match

**Compiled Rule Set**:
An immutable, executable artifact compiled from one **Policy Version**. Contains compiled `enforceable` **Rules** ready for deterministic evaluation; `guidance` and `subjective` **Rules** are recorded as skipped non-enforceable at compile time.
_Avoid_: ruleset, policy bundle

**Rule Test Case**:
A generated or human-edited scenario that exercises one **Rule** against a synthetic expense fixture and an expected **Evaluation Outcome**. Distinct from the upstream **Rule** itself — a **Rule** is policy truth; a **Rule Test Case** is a regression check on the evaluator.
_Avoid_: test rule, policy test

**Expense Report**:
An immutable batch of normalized expense rows produced from one CSV import. Each row carries fields the evaluator matches against **Rule** scope and conditions (e.g. expense category, amount, country, travel type).
_Avoid_: expense batch, import file

**Compliance Evaluation Run**:
A batch execution of one **Expense Report** against one **Compiled Rule Set**, both pinned to the same **Policy Version**. Produces one **Evaluation Outcome** per expense row and records reproducibility metadata (Policy Version, Compiled Rule Set, Expense Report ids).
_Avoid_: audit run, check run

**Evaluation Outcome**:
The per-expense result of a **Compliance Evaluation Run**: `pass` (no triggering violation), `violation` (enforceable **Rule** limit exceeded), `needs_review` (matching `guidance` or `subjective` **Rule**, or Exception path requiring human judgment), or `missing_evidence` (enforceable **Rule** matches but required **Exception** evidence is absent on the expense row).
_Avoid_: result, flag, status

**Compliance Review**:
The human resolution queue for **Evaluation Outcomes** that are not final on their own (`needs_review`, `missing_evidence`, and optionally unresolved `violation`). Reviewers see expense fields, triggering **Rule** statement, **Citation** quote, and automated rationale before recording a decision.
_Avoid_: review ticket, exception queue

## Relationships

- A **Policy Document** yields many candidate **Rules**
- A **Rule** has exactly one **Enforceability Class** and exactly one **Scope**
- A **Rule** may carry zero or more **Exceptions**
- Only `enforceable` **Rules** carry machine-checkable conditions; `guidance`/`subjective` are stored as cited, human-routed items
- Approved **Rules** live in the **Structured Policy Store**
- A **Policy Document** has many immutable **Document Versions**; extraction runs against one **Document Version**
- An extracted **Candidate Rule** carries a **Citation** and zero or more **QA Flags** before reaching an **Approver**
- An **Approver** publishes a set of approved **Rules** as an immutable **Policy Version**
- Re-ingesting a new **Document Version** produces a **Policy Version Diff** so only deltas need re-approval; **Manual Rules** are outside the diff baseline
- A published **Policy Version** is compiled into a **Compiled Rule Set** by an admin
- A **Compiled Rule Set** is pinned to exactly one **Policy Version** and contains one entry per source **Rule** (compiled, skipped non-enforceable, or compile error)
- **Rule Test Cases** reference one **Rule** from the **Compiled Rule Set**'s source **Policy Version**; they do not replace or mutate **Rules**
- An **Expense Report** is evaluated by exactly one **Compliance Evaluation Run** against one **Compiled Rule Set**
- Each expense row in a **Compliance Evaluation Run** yields exactly one **Evaluation Outcome**
- Only `enforceable` **Rules** produce `pass` or `violation`; `guidance` and `subjective` **Rules** that match scope route to `needs_review` (see ADR-0003)
- **Exception** evidence gating on enforceable **Rules** can yield `missing_evidence` when required fields are absent on the expense row
- Non-final **Evaluation Outcomes** enter **Compliance Review** for human resolution

## Example dialogue

> **Dev:** "This sentence caps meals at $75 domestic and $100 international, with a client-entertainment exception. How many **Rules**?"
> **Domain expert:** "Two **Rules** — one per **Scope** — and both carry the client-entertainment **Exception**. They're each `enforceable`."
> **Dev:** "And 'entertainment must be in good taste'?"
> **Domain expert:** "That's a `subjective` statement. We still store and cite it, but it has no machine condition — it routes to a human."
> **Dev:** "We imported March expenses and ran them against Policy Version 3. Row 14 matched the subjective good-taste rule — what's the outcome?"
> **Domain expert:** "`needs_review`. It lands in **Compliance Review** with the **Citation** — no automated pass or violation."

## Flagged ambiguities

- "test" was used to mean both the extracted policy artifact and downstream generated test cases — resolved: the policy artifact is a **Rule**; downstream regression scenarios are **Rule Test Cases**.

## Code layout

Domain terms map to packages in both tiers:

| Domain term | Backend (`src/policy_pipeline/`) | Frontend (`client/src/`) |
|-------------|----------------------------------|---------------------------|
| Policy Document / Document Version | `policy_documents/` | `policy-documents/` |
| Extraction Run | `extraction/` | `extraction-runs/` |
| Candidate Rule / Rule | `rules/` | `candidate-rules/` + shared `rules/` (editing) |
| Policy Version | `policy_versions/` | `policy-versions/` |
| Re-ingestion | `reingestion/` | `reingestion/` |
| Manual Rules | `rules/router_manual.py` | `manual-rules/` |
| Audit | `audit/` | `audit/` |
| Auth / config / DB session | `shared/`, `auth/` | `shared/` |
