// Append-only run log (state/runs.jsonl) helpers.
//
// One JSON object per line. Past entries are never rewritten. The parse helpers
// are pure so tests need no real files.

import fs from "node:fs";

// Append one run entry as a JSON line. This is the only mutating helper.
export function appendRun(filePath, entry) {
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
}

// Parse runs.jsonl text into entries, tolerating and skipping malformed lines.
export function readRuns(text) {
  if (typeof text !== "string") return [];
  const entries = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines rather than throwing.
    }
  }
  return entries;
}

// Count trailing consecutive crash entries for a prompt, reset by any success.
// Unseen prompts and prompts whose latest entry is a success return 0.
export function consecutiveCrashCount(entries, promptName) {
  if (!Array.isArray(entries)) return 0;
  let count = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.prompt !== promptName) continue;
    if (entry.outcome === "crash") {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}
