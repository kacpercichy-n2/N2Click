import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildReviewDiff } from "./review-diff.mjs";

test("review hash changes with code but ignores current-run handoff state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n2hub-review-diff-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Scheduler Test");
  git(root, "config", "user.email", "scheduler@example.test");
  fs.writeFileSync(path.join(root, "app.ts"), "export const value = 1;\n");
  git(root, "add", "app.ts");
  git(root, "commit", "-qm", "initial");

  fs.writeFileSync(path.join(root, "app.ts"), "export const value = 2;\n");
  const reviewed = buildReviewDiff(root);

  fs.mkdirSync(path.join(root, "handoffs"));
  fs.writeFileSync(path.join(root, "handoffs/RUN-STATE.md"), "# current run\n");
  fs.writeFileSync(path.join(root, "handoffs/RUN-RESULT.json"), "{}\n");
  assert.equal(buildReviewDiff(root).hash, reviewed.hash);

  fs.writeFileSync(path.join(root, "app.ts"), "export const value = 3;\n");
  assert.notEqual(buildReviewDiff(root).hash, reviewed.hash);
});

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
}
