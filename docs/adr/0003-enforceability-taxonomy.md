# Enforceability taxonomy as a first-class field on every Rule

Every extracted statement carries an Enforceability Class of `enforceable`, `guidance`, or `subjective`. Only `enforceable` Rules hold machine-checkable conditions; `guidance` and `subjective` statements are still stored and cited, but route to humans rather than to a deterministic check.

We chose to model this explicitly rather than treating all policy text as equally enforceable (a failure mode called out in the product spec). Policy prose mixes hard limits, soft guidance, and judgment calls; collapsing them produces either false violations or unenforceable rules. The trade-off is added classification complexity (and a human-reviewable classification step) in exchange for correctness and a clear boundary for what the downstream deterministic engine will and will not decide.
