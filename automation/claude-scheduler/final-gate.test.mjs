import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { finalGateError } from "./final-gate.mjs";
import { buildReviewDiff } from "./review-diff.mjs";

test("blocks a successful verification command that changes a tracked file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n2hub-final-gate-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Scheduler Test");
  git(root, "config", "user.email", "scheduler@example.test");
  fs.writeFileSync(path.join(root, "snapshot.txt"), "baseline\n");
  git(root, "add", "snapshot.txt");
  git(root, "commit", "-qm", "initial");
  fs.writeFileSync(path.join(root, "snapshot.txt"), "reviewed\n");
  const reviewedDiffHash = buildReviewDiff(root).hash;

  const verification = spawnSync(process.execPath, ["-e", "require('fs').writeFileSync('snapshot.txt', 'generated\\n')"], { cwd: root });
  assert.equal(verification.status, 0);
  assert.equal(finalGateError({
    reviewedDiffHash,
    currentDiffHash: buildReviewDiff(root).hash,
    branchError: null,
  }), "canonical diff changed during final verification");
});

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
}
