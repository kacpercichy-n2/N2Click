import test from "node:test";
import assert from "node:assert/strict";
import { ActiveProcessGuard } from "./active-process.mjs";
import { queueStopReason } from "./queue-control.mjs";
import { runTrackedCommand } from "./tracked-command.mjs";

const descendantCode = `process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);`;

function leaderCode({ ignoreTerm, exitAfterSpawn }) {
  return `
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendantCode)}], { stdio: "ignore" });
    child.once("spawn", () => ${exitAfterSpawn ? "process.exit(0)" : "process.stdout.write('ready\\n')"});
    ${ignoreTerm ? "process.on('SIGTERM', () => {});" : ""}
    setInterval(() => {}, 1000);
  `;
}

test("normal leader close waits until a signal-ignoring descendant is gone", async () => {
  const guard = new ActiveProcessGuard();
  const code = await runTrackedCommand({
    command: process.execPath,
    args: ["-e", leaderCode({ ignoreTerm: false, exitAfterSpawn: true })],
    cwd: process.cwd(),
    env: process.env,
    closeGraceMs: 50,
    guard,
  });

  assert.equal(code, 0);
  assert.equal(guard.active, false);
});

test("timeout settles only after the entire resistant process group is killed", async () => {
  const guard = new ActiveProcessGuard();
  const code = await runTrackedCommand({
    command: process.execPath,
    args: ["-e", leaderCode({ ignoreTerm: true, exitAfterSpawn: false })],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 30,
    timeoutGraceMs: 50,
    guard,
  });

  assert.equal(code, 124);
  assert.equal(guard.active, false);
});

test("unconfirmed cleanup blocks the queue even when continue-on-error is enabled", async () => {
  let active = false;
  const guard = {
    get active() { return active; },
    track() { active = true; },
    async terminate() { return false; },
  };
  const code = await runTrackedCommand({
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    cwd: process.cwd(),
    env: process.env,
    guard,
  });

  assert.equal(code, 125);
  assert.equal(queueStopReason({ ok: false, activeProcess: guard.active, continueOnError: true }), "active-process");
});

test("large stdin to an early-exiting child fails cleanly instead of emitting unhandled EPIPE", async () => {
  const guard = new ActiveProcessGuard();
  const code = await runTrackedCommand({
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    cwd: process.cwd(),
    env: process.env,
    input: "x".repeat(20 * 1024 * 1024),
    guard,
  });

  assert.equal(code, 126);
  assert.equal(guard.active, false);
});
