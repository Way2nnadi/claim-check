"""Local development server with reload scoped to application code."""

from __future__ import annotations

import uvicorn

# Limit reload to the main worktree's application package. Sandcastle agent
# worktrees live under .sandcastle/worktrees/ and must not restart the server.
RELOAD_DIRS = ["src"]
RELOAD_EXCLUDES = [
    ".sandcastle/*",
    ".policy-pipeline/*",
    "node_modules/*",
]


def main() -> None:
    uvicorn.run(
        "policy_pipeline.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        reload_dirs=RELOAD_DIRS,
        reload_excludes=RELOAD_EXCLUDES,
    )
