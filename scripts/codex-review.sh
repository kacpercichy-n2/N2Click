#!/usr/bin/env bash
# codex-review.sh — independent second-opinion review via the OpenAI Codex CLI.
#
# Part of the tiered model workflow: after the workers finish, this sends the
# diff to Codex (a different model family) and prints structured P1/P2/P3
# findings. The Fable "reviewer" agent then adjudicates those findings and
# issues the final verdict.
#
# Usage:
#   bash scripts/codex-review.sh                 # review uncommitted changes
#   bash scripts/codex-review.sh <base-commit>   # review <base-commit>..HEAD
#
# Requires the Codex CLI (https://github.com/openai/codex) and a one-time
# `codex login`. If Codex isn't installed the script exits cleanly (code 2) so
# the workflow can proceed without it.

set -euo pipefail

REVIEWS_DIR="reviews"
TIMESTAMP="$(date +%Y-%m-%d-%H%M%S)"
MODE="uncommitted"
BASE_COMMIT=""
CODEX_REVIEW_MODEL="${CODEX_REVIEW_MODEL:-gpt-5.6-sol}"
CODEX_REVIEW_REASONING_EFFORT="${CODEX_REVIEW_REASONING_EFFORT:-high}"
CODEX_REVIEW_RUN_ID="${CODEX_REVIEW_RUN_ID:-manual}"

# --- args ---
if [ "${1:-}" != "" ]; then
  if ! git rev-parse --verify "$1" &>/dev/null; then
    echo "ERROR: '$1' is not a valid git commit reference." >&2
    echo "Usage: bash scripts/codex-review.sh [<base-commit>]" >&2
    exit 1
  fi
  BASE_COMMIT="$1"
  MODE="range"
fi

# --- pre-flight ---
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "ERROR: not inside a git repository." >&2
  exit 1
fi
if ! command -v codex &>/dev/null; then
  echo "NOTE: codex CLI not found in PATH — skipping the Codex second opinion." >&2
  echo "      Install it (https://github.com/openai/codex) and run 'codex login'" >&2
  echo "      to enable the review gate. The rest of the workflow is unaffected." >&2
  exit 2
fi

mkdir -p "$REVIEWS_DIR"

# --- capture canonical diff ---
DIFF_FILE="$REVIEWS_DIR/${TIMESTAMP}-diff.txt"
FILES_FILE="$(mktemp /tmp/codex-review-files.XXXXXX)"
if [ "$MODE" = "range" ]; then
  DIFF_HASH="$(node scripts/write-review-diff.mjs "$DIFF_FILE" "$FILES_FILE" "$BASE_COMMIT")"
  SCOPE="Range review: $(git rev-parse --short "$BASE_COMMIT")..$(git rev-parse --short HEAD)."
else
  if [ -z "$(git status --porcelain)" ]; then
    rm -f "$FILES_FILE"
    echo "No uncommitted changes to review. (Pass a base commit to review a range.)"
    exit 0
  fi
  DIFF_HASH="$(node scripts/write-review-diff.mjs "$DIFF_FILE" "$FILES_FILE")"
  SCOPE="Review of uncommitted changes."
fi
FILES="$(<"$FILES_FILE")"
rm -f "$FILES_FILE"

if [ ! -s "$DIFF_FILE" ]; then
  echo "Empty diff — nothing to review."
  exit 0
fi

# --- build prompt ---
PROMPT="Review this code change made by another AI coding agent.

${SCOPE}

Focus on: logic bugs, regressions, hidden edge cases, bad assumptions, missing
validation, performance issues, security risks, missing or weak tests, and
cross-feature interaction issues.

Return findings as a structured list with severity (P1 = must fix, P2 = should
fix, P3 = nice to have). For each finding include: file, line/area, severity,
issue description, suggested fix. If nothing is wrong, say \"LGTM — no issues found.\"

Changed files:
${FILES}

The complete diff, including untracked files, is available locally at:
${DIFF_FILE}

Review run ID: ${CODEX_REVIEW_RUN_ID}
Canonical diff SHA-256: ${DIFF_HASH}

Read that artifact first. Inspect only direct dependencies when a finding needs
confirmation; do not scan unrelated repository areas."

TMPFILE="$(mktemp /tmp/codex-review-prompt.XXXXXX)"
echo "$PROMPT" > "$TMPFILE"

# --- call Codex (read-only sandbox: Codex advises, it does not edit files) ---
echo "Sending to Codex for review (${CODEX_REVIEW_MODEL}, reasoning ${CODEX_REVIEW_REASONING_EFFORT})..." >&2
if REVIEW="$(codex exec --model "$CODEX_REVIEW_MODEL" -c "model_reasoning_effort=\"${CODEX_REVIEW_REASONING_EFFORT}\"" --sandbox read-only --ephemeral "$(cat "$TMPFILE")" 2>/dev/null)"; then
  rm -f "$TMPFILE"
else
  CODE=$?
  rm -f "$TMPFILE"
  echo "ERROR: codex exec failed (exit $CODE). If this is an auth issue, run: codex login" >&2
  exit 4
fi
if [ -z "${REVIEW//[[:space:]]/}" ]; then
  echo "ERROR: codex exec returned an empty review." >&2
  exit 5
fi

# --- save + emit ---
REVIEW_FILE="$REVIEWS_DIR/${TIMESTAMP}-codex-review.md"
echo "$REVIEW" > "$REVIEW_FILE"
METADATA_FILE="$REVIEWS_DIR/${TIMESTAMP}-codex-review.json"
node -e '
  const fs = require("node:fs");
  const [file, runId, diffHash, reviewArtifact] = process.argv.slice(1);
  fs.writeFileSync(file, JSON.stringify({ runId, diffHash, reviewArtifact }, null, 2) + "\n");
' "$METADATA_FILE" "$CODEX_REVIEW_RUN_ID" "$DIFF_HASH" "$REVIEW_FILE"
echo "Review saved to: $REVIEW_FILE" >&2
echo "Review metadata: $METADATA_FILE" >&2
echo ""
echo "$REVIEW"
