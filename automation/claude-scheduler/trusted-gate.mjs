import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const TRUSTED_GATE_PATHS = [
  "scripts/codex-review.sh",
  "scripts/write-review-diff.mjs",
  "automation/claude-scheduler/review-diff.mjs",
];

export function captureTrustedGate(repoRoot, paths = TRUSTED_GATE_PATHS) {
  return new Map(paths.map((relative) => [relative, fileHash(path.join(repoRoot, relative))]));
}

export function trustedGateErrorFor(repoRoot, snapshot) {
  for (const [relative, expected] of snapshot) {
    const current = fileHash(path.join(repoRoot, relative));
    if (current !== expected) return `trusted gate file changed during implementation: ${relative}`;
  }
  return null;
}

function fileHash(file) {
  if (!fs.existsSync(file)) return null;
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
