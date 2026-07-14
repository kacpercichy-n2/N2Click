import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireSchedulerLock } from "./scheduler-lock.mjs";

test("rejects a second live scheduler and releases the owner lock", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-lock-"));
  const lock = path.join(root, "scheduler.lock");
  const release = acquireSchedulerLock(lock);
  assert.throws(() => acquireSchedulerLock(lock), /already running/);
  release();
  assert.equal(fs.existsSync(lock), false);
});

test("refuses automatic recovery from a stale lock with unknown model state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-lock-"));
  const lock = path.join(root, "scheduler.lock");
  fs.writeFileSync(lock, "99999999\n");
  assert.throws(() => acquireSchedulerLock(lock), /unknown invocation state/);
  assert.equal(fs.readFileSync(lock, "utf8").trim(), "99999999");
});
