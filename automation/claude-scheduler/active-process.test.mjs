import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { ActiveProcessGuard } from "./active-process.mjs";
import { acquireSchedulerLock } from "./scheduler-lock.mjs";

test("keeps the scheduler lock until the active process group is terminated", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "active-process-"));
  const lock = path.join(root, "scheduler.lock");
  const release = acquireSchedulerLock(lock);
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
  });
  const guard = new ActiveProcessGuard();
  guard.track(child);

  assert.throws(() => acquireSchedulerLock(lock), /already running/);
  assert.equal(await guard.terminate(2_000), true);
  assert.equal(guard.active, false);
  release();
  const releaseAgain = acquireSchedulerLock(lock);
  releaseAgain();
});

test("waits for a signal-ignoring descendant after the group leader exits", async () => {
  const descendantCode = `process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);`;
  const leaderCode = `
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendantCode)}], { stdio: "ignore" });
    child.once("spawn", () => process.stdout.write("ready\\n"));
    process.on("SIGTERM", () => process.exit(0));
    setInterval(() => {}, 1000);
  `;
  const leader = spawn(process.execPath, ["-e", leaderCode], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  await new Promise((resolve, reject) => {
    leader.stdout.once("data", resolve);
    leader.once("error", reject);
  });

  const guard = new ActiveProcessGuard();
  guard.track(leader);
  assert.equal(await guard.terminate(100), true);
  assert.equal(guard.active, false);
  assert.throws(() => process.kill(-leader.pid, 0), /ESRCH/);
});
