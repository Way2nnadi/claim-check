# Immutable, append-only versioning with delta re-approval

Policy Documents, extractions, and approved Rules are versioned immutably and append-only. Each upload creates a new immutable Document Version; each extraction is pinned to (document version + model id + prompt template version); approved Rules are published as immutable Policy Version snapshots. Re-ingesting an updated document produces a fresh candidate set that is diffed against the current Policy Version, so Approvers only re-approve the deltas (added/changed/removed Rules).

We chose this over mutable, edit-in-place Rules because the system must reproduce any past decision given the same inputs, and regulated buyers require a tamper-evident audit trail. The trade-off is more storage and a diffing step on re-ingestion, in exchange for guaranteed reproducibility and a clean upgrade path when policies change.
