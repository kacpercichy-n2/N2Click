#!/usr/bin/env bash
# codex-implement.sh — optional implementation worker for a ready tier package.
#
# The Claude Code workflow remains the orchestrator, but the architect can route
# a bounded package to Codex when an external coding worker is useful. This
# script pins that worker to GPT-5.6 Terra with high reasoning effort.
#
# Usage:
#   bash scripts/codex-implement.sh handoffs/packages/PKG-...md

set -euo pipefail

PACKAGE_PATH="${1:-}"
CODEX_IMPLEMENT_MODEL="${CODEX_IMPLEMENT_MODEL:-gpt-5.6-terra}"
CODEX_IMPLEMENT_REASONING_EFFORT="${CODEX_IMPLEMENT_REASONING_EFFORT:-high}"

if [ -z "$PACKAGE_PATH" ] || [ ! -f "$PACKAGE_PATH" ]; then
  echo "Usage: bash scripts/codex-implement.sh handoffs/packages/PKG-...md" >&2
  exit 1
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "ERROR: codex CLI not found in PATH. Install it and run 'codex login' first." >&2
  exit 2
fi

PROMPT="You are the implementation worker in a tiered workflow. Read the package at
${PACKAGE_PATH}, CLAUDE.md, and the referenced project conventions before editing.

Pre-flight the package against docs/workflow/HANDOFF-TEMPLATE.md. If it is
ambiguous, out of scope, or fails Definition of Ready, stop without editing and
report the precise blocker. Otherwise implement only this package, run its
required verification, and append a concise synthesized result to
handoffs/RUN-STATE.md. Do not commit, push, merge, rebase or switch branches;
the scheduler owns final verification, archive and Git operations."

echo "Starting Codex implementation (${CODEX_IMPLEMENT_MODEL}, reasoning ${CODEX_IMPLEMENT_REASONING_EFFORT})..." >&2
exec codex exec \
  --model "$CODEX_IMPLEMENT_MODEL" \
  -c "model_reasoning_effort=\"${CODEX_IMPLEMENT_REASONING_EFFORT}\"" \
  --sandbox workspace-write \
  --ephemeral \
  "$PROMPT"
