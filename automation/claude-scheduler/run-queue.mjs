#!/usr/bin/env node
// Reset-anchored unattended prompt scheduler.
//
// Runs Markdown prompts from prompts/ in lexical order, anchored to the Claude
// 5h usage reset, with usage-aware chaining, append-only run logging and a
// per-run snapshot commit on a review/claude-auto-* branch. It NEVER pushes.
//
// Start:  node automation/claude-scheduler/run-queue.mjs
// Stop:   Ctrl-C (SIGINT) or SIGTERM — writes phase "stopped" and drops the lock.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { getUsage } from "./lib/usage.mjs";
import { computeNextRunAt, chainDecision } from "./lib/schedule.mjs";
import { appendRun, readRuns, consecutiveCrashCount } from "./lib/runlog.mjs";
import { writeStatus } from "./lib/state.mjs";

const schedulerDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(schedulerDir, "..", "..");
const promptDir = path.join(schedulerDir, "prompts");
const completedDir = path.join(schedulerDir, "archive", "completed");
const failedDir = path.join(schedulerDir, "archive", "failed");
const logDir = path.join(schedulerDir, "logs");
const stateDir = path.join(schedulerDir, "state");
const statusPath = path.join(stateDir, "status.json");
const lockPath = path.join(stateDir, "scheduler.lock");
const runsPath = path.join(stateDir, "runs.jsonl");

const home = os.homedir();
const usageHelperPath = process.env.CLAUDE_AUTO_USAGE_HELPER
  || path.join(home, ".claude", "fetch-claude-usage.swift");
const cachePath = process.env.CLAUDE_AUTO_USAGE_CACHE
  || path.join(home, ".claude", ".statusline-usage-cache");

const FIVE_MIN_MS = 5 * 60_000;
const HEARTBEAT_MS = 30_000;            // keep updatedAt well under the 90s alive window
const SAFETY_VALVE_MS = (5 * 60 + 5) * 60_000; // 5h05m without a usable reset -> run anyway

/**
 * Keep the Mac awake for the scheduler's complete lifetime. `-w` ties the
 * caffeinate helper to this Node PID, so it exits automatically when the
 * scheduler exits (including SIGINT/SIGTERM shutdown). This prevents ordinary
 * idle sleep; closing a laptop lid or a forced system shutdown can still stop
 * the process, as macOS intends.
 */
function startCaffeinate() {
  if (process.platform !== "darwin") return;
  const helper = spawn("/usr/bin/caffeinate", ["-dimsu", "-w", String(process.pid)], {
    stdio: "ignore",
  });
  helper.once("spawn", () => {
    console.log(`caffeinate started for scheduler pid ${process.pid}`);
  });
  helper.once("error", (error) => {
    console.error(`Could not start caffeinate; scheduler will not prevent idle sleep: ${error.message}`);
  });
}

const status = {
  pid: process.pid,
  phase: "idle",
  updatedAt: null,
  nextRunAt: null,
  currentPrompt: null,
  queue: [],
  lastRun: null,
  usage: null,
  lastError: null,
};

for (const dir of [promptDir, completedDir, failedDir, logDir, stateDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

main().catch((error) => {
  console.error(error);
  try { fs.rmSync(lockPath, { force: true }); } catch { /* ignore */ }
  process.exit(1);
});

async function main() {
  startCaffeinate();
  acquireLock();
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`Scheduler started (pid ${process.pid}). Prompts: ${promptDir}`);
  let lastRunStartedMs = Date.now(); // baseline for the missing-reset safety valve

  while (true) {
    const queue = scanPrompts();
    if (queue.length === 0) {
      publish({ phase: "idle", nextRunAt: null, currentPrompt: null, queue: [], lastError: null });
      await idleSleep(FIVE_MIN_MS, () => publish({ phase: "idle", queue: scanPrompts() }));
      continue;
    }

    const usage = await fetchUsage();
    publish({ usage, queue, currentPrompt: null });
    const decision = chainDecision(usage);

    if (decision === "retry-usage") {
      publish({ phase: "waiting", nextRunAt: null, lastError: "Zużycie niedostępne — ponawiam za 5 min" });
      await idleSleep(FIVE_MIN_MS, () => publish({ phase: "waiting", queue: scanPrompts() }));
      continue;
    }

    if (decision === "wait") {
      const target = computeNextRunAt(usage.resetsAt, Date.now());
      if (target === null) {
        // resetsAt missing while utilization >= 50.
        if (Date.now() - lastRunStartedMs > SAFETY_VALVE_MS) {
          publish({ phase: "waiting", lastError: "Brak resetu > 5h05m — uruchamiam awaryjnie" });
        } else {
          publish({ phase: "waiting", nextRunAt: null, lastError: "Brak czasu resetu — ponawiam za 5 min" });
          await idleSleep(FIVE_MIN_MS, () => publish({ phase: "waiting", queue: scanPrompts() }));
          continue;
        }
      } else {
        publish({ phase: "waiting", nextRunAt: new Date(target).toISOString(), lastError: null });
        await waitUntil(target);
      }
    }

    const head = scanPrompts()[0];
    if (!head) continue;
    lastRunStartedMs = Date.now();
    const entry = await runPrompt(head);
    await honorDecision(entry);
  }
}

// Sleep after a run based on the entry's recorded decision, so a crash retries
// only at the next reset window even when utilization is below the chain limit.
async function honorDecision(entry) {
  if (entry.decision === "wait") {
    if (entry.nextRunAt) {
      publish({ phase: "waiting", nextRunAt: entry.nextRunAt });
      await waitUntil(Date.parse(entry.nextRunAt));
    } else if (entry.outcome === "crash") {
      // Crash with an unknown reset: a crashed, non-parked prompt must retry at
      // the NEXT RESET regardless of utilization. Keep refetching usage until
      // the reset is known (safety valve still applies), then wait for it —
      // never let the loop chain the crashed prompt early on a <50% reading.
      await waitForNextReset(Date.parse(entry.startedAt) || Date.now());
    } else {
      publish({ phase: "waiting", nextRunAt: null });
      await idleSleep(FIVE_MIN_MS, () => publish({ phase: "waiting", queue: scanPrompts() }));
    }
  } else if (entry.decision === "retry-usage") {
    publish({ phase: "waiting", nextRunAt: null, lastError: "Zużycie niedostępne — ponawiam za 5 min" });
    await idleSleep(FIVE_MIN_MS, () => publish({ phase: "waiting", queue: scanPrompts() }));
  }
  // "chain" and "parked" fall straight back to the loop head.
}

// Poll usage until the reset time is known, then wait for reset + 60s. The
// 5h05m safety valve returns early so a permanently missing reset cannot stall
// the queue forever.
async function waitForNextReset(runStartedMs) {
  while (true) {
    const usage = await fetchUsage();
    const target = usage ? computeNextRunAt(usage.resetsAt, Date.now()) : null;
    if (target !== null) {
      publish({ usage, phase: "waiting", nextRunAt: new Date(target).toISOString(), lastError: null });
      await waitUntil(target);
      return;
    }
    if (Date.now() - runStartedMs > SAFETY_VALVE_MS) {
      publish({ usage, phase: "waiting", lastError: "Brak resetu > 5h05m — uruchamiam awaryjnie" });
      return;
    }
    publish({ usage, phase: "waiting", nextRunAt: null, lastError: "Awaria — czekam na reset zużycia" });
    await idleSleep(FIVE_MIN_MS, () => publish({ phase: "waiting", queue: scanPrompts() }));
  }
}

async function runPrompt(basename) {
  const promptFile = path.join(promptDir, basename);
  const startedAt = new Date();
  const runId = `${formatRunStamp(startedAt)}-${basename.replace(/\.md$/, "")}`;
  const logFile = path.join(logDir, `${runId}.log`);

  publish({ phase: "running", currentPrompt: basename, nextRunAt: null, lastError: null });
  const promptBody = fs.readFileSync(promptFile, "utf8");
  appendFile(logFile, `# ${basename}\nRun: ${runId}\nStarted: ${startedAt.toISOString()}\n\n`);

  let exitCode;
  let outcome;
  let verify;
  let attempt;
  let parked = false;

  // A run (claude + verification) can last far longer than the 90s alive window,
  // and both phases await async work, so refresh the heartbeat every 30s.
  const heartbeat = setInterval(() => publish({}), HEARTBEAT_MS);
  try {
    exitCode = await spawnClaude(promptBody, logFile);
    appendFile(logFile, `\nclaude exit code: ${exitCode}\n`);

    if (exitCode === 0) {
      outcome = "success";
      attempt = 1;
      verify = {
        test: await runVerify("npm", ["test"], logFile),
        build: await runVerify("npm", ["run", "build"], logFile),
      };
      fs.renameSync(promptFile, path.join(completedDir, basename));
    } else {
      outcome = "crash";
      verify = null;
      attempt = consecutiveCrashCount(readRunsFile(), basename) + 1;
      if (attempt >= 3) {
        fs.renameSync(promptFile, path.join(failedDir, basename));
        parked = true;
      }
    }
  } finally {
    clearInterval(heartbeat);
  }

  const endedAt = new Date();
  const usageAfter = await fetchUsage();

  let decision;
  if (parked) {
    decision = "parked";
  } else if (outcome === "crash") {
    decision = "wait"; // crash-loop damping: always wait for the next reset window
  } else {
    decision = chainDecision(usageAfter);
  }

  let nextRunAtIso = null;
  if (decision === "wait") {
    const target = computeNextRunAt(usageAfter?.resetsAt ?? null, endedAt.getTime());
    nextRunAtIso = target === null ? null : new Date(target).toISOString();
  }

  const commit = gitSnapshot(runId, outcome, exitCode, verify);

  const entry = {
    runId,
    prompt: basename,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    exitCode,
    outcome,
    attempt,
    verify,
    usageAfter: usageAfter
      ? { utilization: usageAfter.utilization, resetsAt: usageAfter.resetsAt, source: usageAfter.source }
      : null,
    decision,
    nextRunAt: nextRunAtIso,
    logFile: path.relative(schedulerDir, logFile),
    commit,
  };

  appendRun(runsPath, entry);
  publish({
    phase: decision === "wait" ? "waiting" : "idle",
    lastRun: entry,
    nextRunAt: nextRunAtIso,
    currentPrompt: null,
    usage: usageAfter ?? status.usage,
  });
  console.log(`Run ${runId}: ${outcome} (exit ${exitCode}), decision ${decision}, commit ${commit ?? "none"}.`);
  return entry;
}

// --- Git snapshot (never pushes) -----------------------------------------

function gitSnapshot(runId, outcome, exitCode, verify) {
  ensureReviewBranch();
  git(["add", "-A"], { allowFailure: true });
  if (nothingStaged()) return null;
  const verifyLabel = verify === null
    ? "skipped"
    : verify.test === 0 && verify.build === 0 ? "pass" : "fail";
  const outcomeLabel = outcome === "success" ? "success" : `crash exit ${exitCode}`;
  const message = `auto: ${runId} ${outcomeLabel} [verify: ${verifyLabel}]`;
  const committed = spawnSync("git", ["commit", "-m", message], { cwd: repoRoot, encoding: "utf8" });
  if (committed.status !== 0) return null; // failed commit -> record commit: null
  return git(["rev-parse", "--short", "HEAD"], { allowFailure: true }).trim() || null;
}

function ensureReviewBranch() {
  const current = git(["branch", "--show-current"], { allowFailure: true }).trim();
  if (/^review\/claude-auto-/.test(current)) return;
  const name = `review/claude-auto-${formatBranchStamp(new Date())}`;
  git(["checkout", "-b", name]);
}

function nothingStaged() {
  return spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: repoRoot }).status === 0;
}

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout || "";
}

// --- Process helpers ------------------------------------------------------

function spawnClaude(promptBody, logFile) {
  return new Promise((resolve) => {
    const child = spawn("claude", ["--print", "--dangerously-skip-permissions"], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => appendFile(logFile, chunk));
    child.stderr.on("data", (chunk) => appendFile(logFile, chunk));
    child.on("error", (error) => {
      appendFile(logFile, `\n[spawn error] ${error.message}\n`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
    // Swallow EPIPE if claude is missing or exits before consuming stdin, so it
    // does not become an uncaught exception that kills the scheduler.
    child.stdin.on("error", () => {});
    child.stdin.end(promptBody);
  });
}

// Async spawn (not spawnSync) so the running-phase heartbeat interval keeps
// firing while npm test / npm run build execute. Result is recorded, not gated.
function runVerify(command, args, logFile) {
  return new Promise((resolve) => {
    appendFile(logFile, `\n$ ${command} ${args.join(" ")}\n`);
    const child = spawn(command, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => appendFile(logFile, chunk));
    child.stderr.on("data", (chunk) => appendFile(logFile, chunk));
    child.on("error", (error) => {
      appendFile(logFile, `\n[spawn error] ${error.message}\n`);
      resolve(1);
    });
    child.on("close", (code) => {
      appendFile(logFile, `\nexit ${code ?? 1}\n`);
      resolve(code ?? 1);
    });
  });
}

function fetchUsage() {
  return getUsage({ usageHelperPath, cachePath, nowMs: Date.now() });
}

// --- Lock + lifecycle -----------------------------------------------------

function acquireLock() {
  if (fs.existsSync(lockPath)) {
    const pid = Number(fs.readFileSync(lockPath, "utf8").trim());
    if (Number.isFinite(pid) && isAlive(pid)) {
      console.error(`Scheduler already running (pid ${pid}). Exiting.`);
      process.exit(1);
    }
    fs.rmSync(lockPath, { force: true }); // stale lock from a dead process
  }
  fs.writeFileSync(lockPath, String(process.pid));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function shutdown() {
  try { publish({ phase: "stopped", currentPrompt: null }); } catch { /* ignore */ }
  try { fs.rmSync(lockPath, { force: true }); } catch { /* ignore */ }
  process.exit(0);
}

// --- Status heartbeat + waiting ------------------------------------------

function publish(patch = {}) {
  Object.assign(status, patch);
  status.updatedAt = new Date().toISOString();
  try {
    writeStatus(statusPath, status);
  } catch (error) {
    console.error(`status write failed: ${error.message}`);
  }
}

async function idleSleep(totalMs, tick) {
  const until = Date.now() + totalMs;
  while (Date.now() < until) {
    if (tick) tick();
    await delay(Math.min(HEARTBEAT_MS, until - Date.now()));
  }
}

async function waitUntil(targetMs) {
  while (Date.now() < targetMs) {
    publish({ phase: "waiting", queue: scanPrompts(), nextRunAt: new Date(targetMs).toISOString() });
    await delay(Math.min(HEARTBEAT_MS, targetMs - Date.now()));
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

// --- Small utilities ------------------------------------------------------

function scanPrompts() {
  try {
    return fs.readdirSync(promptDir)
      .filter((file) => file.endsWith(".md"))
      .sort(); // default sort = code-point (simple lexical) order
  } catch {
    return [];
  }
}

function readRunsFile() {
  try {
    return readRuns(fs.readFileSync(runsPath, "utf8"));
  } catch {
    return [];
  }
}

function appendFile(file, value) {
  fs.appendFileSync(file, typeof value === "string" ? value : value);
}

function formatRunStamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatBranchStamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}
