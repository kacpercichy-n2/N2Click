#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promptContractErrorFor, promptMetadata } from "./prompt-contract.mjs";
import { runResultErrorFor } from "./run-result.mjs";
import { finalizePrompt } from "./scheduler-files.mjs";
import { buildReviewDiff } from "./review-diff.mjs";
import { finalGateError } from "./final-gate.mjs";

const DEFAULT_TIMES = ["16:00", "21:01", "02:02", "07:03", "12:04"];
const DEFAULT_ALLOWED_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Glob",
  "Grep",
  "LS",
  "TodoWrite",
  "Agent",
  "Bash(git status *)",
  "Bash(git diff *)",
  "Bash(git log *)",
  "Bash(git show *)",
  "Bash(git rev-parse *)",
  "Bash(git branch --show-current)",
  "Bash(git merge-base *)",
  "Bash(npm *)",
  "Bash(npx *)",
  "Bash(node *)",
  "Bash(bash scripts/codex-review.sh *)",
  "Bash(CODEX_REVIEW_RUN_ID=* bash scripts/codex-review.sh *)",
  "Bash(codex exec *)",
  "Bash(rg *)",
  "Bash(sed *)",
  "Bash(cat *)",
  "Bash(ls *)",
  "Bash(pwd)",
  "Bash(mkdir *)",
  "Bash(find *)",
];

const repoRoot = gitOutput(["rev-parse", "--show-toplevel"]).trim();
const schedulerDir = path.join(repoRoot, "automation", "claude-scheduler");
const promptDir = path.join(schedulerDir, "prompts");
const logDir = path.join(schedulerDir, "logs");
const stateDir = path.join(schedulerDir, "state");
const stateFile = path.join(stateDir, "completed.json");

fs.mkdirSync(promptDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });

const scheduleTimes = parseTimes(process.env.CLAUDE_AUTO_TIMES || DEFAULT_TIMES.join(","));
const branchName = process.env.CLAUDE_AUTO_BRANCH || `review/claude-auto-${formatDateTimeForFile(new Date())}`;
const continueOnError = process.env.CLAUDE_AUTO_CONTINUE_ON_ERROR === "1";
const dryRun = process.env.CLAUDE_AUTO_DRY_RUN === "1";
const skipPermissions = process.env.CLAUDE_AUTO_SKIP_PERMISSIONS === "1";
const allowedTools = process.env.CLAUDE_AUTO_ALLOWED_TOOLS || DEFAULT_ALLOWED_TOOLS.join(",");
const verifyCommands = parseVerifyCommands(process.env.CLAUDE_AUTO_VERIFY || "npm test && npm run build");
const earlyCheckMinutes = parseOptionalPositiveInt(process.env.CLAUDE_AUTO_EARLY_CHECK_MINUTES);
const usageHelper = process.env.CLAUDE_AUTO_USAGE_HELPER || path.join(process.env.HOME || "", ".claude", "fetch-claude-usage.swift");
const usageTelemetryEnabled = fs.existsSync(usageHelper);
const usageGateEnabled = process.env.CLAUDE_AUTO_USAGE_GATE === "1" && usageTelemetryEnabled;
const metricsFile = path.join(stateDir, "run-metrics.jsonl");
const runResultFile = path.join(repoRoot, "handoffs", "RUN-RESULT.json");

const promptFiles = fs
  .readdirSync(promptDir)
  .filter((file) => file.endsWith(".md"))
  .sort((a, b) => a.localeCompare(b, "en"))
  .map((file) => path.join(promptDir, file));

if (promptFiles.length === 0) {
  console.error(`No prompt files found in ${promptDir}`);
  console.error("Add files like 001.md, 002.md, 003.md and run this script again.");
  process.exit(1);
}

const completed = readCompleted();
const staleCheckpoints = promptFiles.filter((file) => completed.includes(path.basename(file)));
if (staleCheckpoints.length > 0) {
  console.warn(`Ignoring stale completed checkpoint(s) for active prompt files: ${staleCheckpoints.map((file) => path.basename(file)).join(", ")}`);
}
const remainingPrompts = promptFiles;

if (!dryRun) {
  ensureReviewBranch();
  assertSafeReviewBranch();
}

console.log(`Repo: ${repoRoot}`);
console.log(`Branch: ${gitOutput(["branch", "--show-current"]).trim()}`);
console.log(`Schedule: ${scheduleTimes.join(", ")}`);
if (earlyCheckMinutes) {
  console.log(`Early check: next prompt may run ${earlyCheckMinutes} minutes after a successful prompt.`);
}
if (usageTelemetryEnabled) {
  console.log(`Usage telemetry: enabled${usageGateEnabled ? " (gating at explicit request)" : " (observational; it will not delay the queue)"}.`);
}
console.log(`Remaining prompts: ${remainingPrompts.map((file) => path.basename(file)).join(", ")}`);
console.log("Keep the Mac awake with: caffeinate -dimsu node automation/claude-scheduler/run-queue.mjs");

let earlyEligibleAt = null;
let schedulingCursor = new Date();
for (const promptFile of remainingPrompts) {
  const slot = nextRunSlot(schedulingCursor, scheduleTimes, earlyEligibleAt);
  console.log(`\nNext prompt ${path.basename(promptFile)} scheduled for ${formatDateTime(slot)}${slot.source ? ` (${slot.source})` : ""}.`);

  if (!dryRun) {
    await sleepUntil(slot);
    schedulingCursor = new Date();
  } else {
    schedulingCursor = new Date(slot.getTime() + 2_000);
  }
  if (usageGateEnabled && !dryRun) {
    await waitForUsageBudget();
  }

  const ok = await runPrompt(promptFile);
  if (ok && earlyCheckMinutes) {
    earlyEligibleAt = new Date(Date.now() + earlyCheckMinutes * 60_000);
  }
  if (!ok && !continueOnError) {
    console.error("Stopping queue because Claude or verification failed.");
    process.exit(1);
  }
}

console.log("\nPrompt queue finished.");

async function runPrompt(promptFile) {
  const basename = path.basename(promptFile);
  const startedAt = new Date();
  const runId = randomUUID();
  const logFile = path.join(logDir, `${formatDateTimeForFile(startedAt)}-${basename.replace(/\.md$/, "")}.log`);
  const promptBody = fs.readFileSync(promptFile, "utf8");
  const promptContractError = promptContractErrorFor(promptBody, repoRoot);
  const metadata = promptMetadata(promptBody);
  const fullPrompt = buildPrompt(promptBody, basename, runId);
  let ok = true;
  let reviewedDiffHash = null;
  const metrics = {
    prompt: basename,
    runId,
    startedAt: startedAt.toISOString(),
    promptBytes: Buffer.byteLength(promptBody),
    promptWords: countWords(promptBody),
    risk: metadata.risk,
    route: metadata.route,
    codexReview: metadata.codexReview,
    usageBefore: usageTelemetryEnabled && !dryRun ? await readUsageSnapshot() : null,
    claudeExitCode: null,
    verification: [],
  };

  appendLog(logFile, `# ${basename}\nStarted: ${startedAt.toISOString()}\nBranch: ${gitOutput(["branch", "--show-current"]).trim()}\n\n`);
  if (metrics.usageBefore) {
    appendLog(logFile, `Usage before run: ${formatUsage(metrics.usageBefore)}\n`);
  }
  if (promptContractError) {
    appendLog(logFile, `Prompt contract failed: ${promptContractError}\n`);
    console.error(`Cannot run ${basename}: ${promptContractError}`);
    return false;
  }
  if (metadata.codexReview === "required" && !commandAvailable("codex")) {
    const message = "Codex review is required for this high-risk prompt, but the codex CLI is unavailable.";
    appendLog(logFile, `${message}\n`);
    console.error(`Cannot run ${basename}: ${message}`);
    return false;
  }

  const branchError = dryRun ? null : reviewBranchSafetyError();
  if (branchError !== null) {
    appendLog(logFile, `Scheduler branch preflight failed: ${branchError}\n`);
    console.error(`Cannot run ${basename}: ${branchError}`);
    return false;
  }

  if (!dryRun && dirtyStatus()) {
    appendLog(logFile, "Working tree was dirty before Claude started. Aborting this prompt.\n");
    console.error(`Working tree is dirty before ${basename}; resolve it before continuing.`);
    return false;
  }

  console.log(`${dryRun ? "Dry-run validating" : "Running Claude for"} ${basename}. Log: ${logFile}`);
  if (!dryRun) {
    const claudeArgs = skipPermissions
      ? ["--print", "--dangerously-skip-permissions"]
      : ["--print", "--allowedTools", allowedTools];
    const claudeCode = await streamCommand("claude", claudeArgs, logFile, fullPrompt);
    metrics.claudeExitCode = claudeCode;
    ok = ok && claudeCode === 0;
  } else {
    appendLog(logFile, "[dry run] Claude execution skipped.\n");
  }

  if (ok && !dryRun) {
    reviewedDiffHash = buildReviewDiff(repoRoot).hash;
    const resultError = runResultErrorFor({
      resultFile: runResultFile,
      repoRoot,
      prompt: basename,
      runId,
      codexPolicy: metadata.codexReview,
      startedAt,
      currentDiffHash: reviewedDiffHash,
    });
    if (resultError) {
      appendLog(logFile, `Run result gate failed: ${resultError}\n`);
      console.error(`Cannot approve ${basename}: ${resultError}`);
      ok = false;
    }
  }

  for (const command of ok ? verifyCommands : []) {
    appendLog(logFile, `\n$ ${command}\n`);
    if (!dryRun) {
      const [cmd, ...args] = command.split(/\s+/);
      const code = await streamCommand(cmd, args, logFile);
      metrics.verification.push({ command, exitCode: code });
      ok = ok && code === 0;
      if (!ok) break;
    }
  }

  if (ok && !dryRun) {
    const gateError = finalGateError({
      reviewedDiffHash,
      currentDiffHash: buildReviewDiff(repoRoot).hash,
      branchError: reviewBranchSafetyError(),
    });
    if (gateError) {
      appendLog(logFile, `Final gate failed: ${gateError}\n`);
      console.error(`Cannot commit ${basename}: ${gateError}`);
      ok = false;
    }
  }

  if (dryRun) {
    appendLog(logFile, "\nDry run: no commit and no completed-state update.\n");
  } else if (ok) {
    const promptTitle = firstPromptLine(promptFile);
    finalizePrompt({
      promptFile,
      archiveDir: path.join(schedulerDir, "archive", "completed"),
      commit: () => commitIfNeeded(basename, promptTitle, logFile),
      unstage: unstageAll,
    });
    markCompleted(basename);
  } else {
    appendLog(logFile, "\nRun or verification failed: changes were intentionally left uncommitted for human recovery.\nPrompt was not marked as completed.\n");
  }
  metrics.finishedAt = new Date().toISOString();
  metrics.durationSeconds = Math.round((new Date(metrics.finishedAt).getTime() - startedAt.getTime()) / 1000);
  metrics.status = ok ? "ok" : "failed";
  metrics.usageAfter = usageTelemetryEnabled && !dryRun ? await readUsageSnapshot() : null;
  if (!dryRun) appendRunMetrics(metrics);
  if (metrics.usageAfter) {
    appendLog(logFile, `Usage after run: ${formatUsage(metrics.usageAfter)}\n`);
  }
  appendLog(logFile, `\nFinished: ${new Date().toISOString()}\nStatus: ${ok ? "ok" : "failed"}\n`);
  return ok;
}

function buildPrompt(promptBody, basename, runId) {
  return `You are working unattended in this repository.

Before editing, read CLAUDE.md, then read only the wiki pages and source
touchpoints declared in the prompt. Do not expand context to unrelated pages,
historic handoffs, or a full repository scan unless a direct dependency makes
it necessary; record that exception in the final report.

Use the tier routing contract in .claude/commands/tier.md and delegate each
declared role to the matching project agent. Use no additional agent passes.

Automation constraints:
- Work only in the current repository.
- Do not merge, rebase, or switch to main.
- Do not commit or push. The scheduler owns the final verification, archive move,
  commit and any later operator-approved push.
- Keep the change scoped to the user prompt.
- Treat current main code, tests, and CLAUDE.md as authoritative. If part of the prompt is already implemented, verify it and do not reimplement, revert, or weaken it.
- Follow the route and review policy in ## Risk and routing. High-risk work must
  complete the required Codex review; do not silently downgrade it.
- Workers run focused verification while iterating. The scheduler owns the one
  final full npm test + npm run build gate.
- The final reviewer/orchestrator records exactly one focused wiki decision:
  what changed, or "wiki unchanged" with a reason.
- Report synthesized results only. Include context expansions, exact focused
  checks, Codex used/skipped, deviations and blockers; do not paste raw logs.
- After the final reviewer verdict, write handoffs/RUN-RESULT.json with exactly:
  {"prompt":"${basename}","runId":"${runId}","status":"approved|blocked",
  "reviewerVerdict":"approve|changes-required","codexReview":{"policy":"required|conditional|skip",
  "status":"passed|skipped","artifact":"reviews/<fresh>-codex-review.md",
  "metadata":"reviews/<same>-codex-review.json","diffHash":"<metadata hash>",
  "reason":"<required when skipped>"},
  "contextExpansions":[],"wiki":{"status":"updated|unchanged","reason":"<specific>"}}.
  Use the current prompt's Codex policy. Never claim approval or passed review
  without the matching reviewer verdict and fresh artifact.
- When Codex runs, invoke it as CODEX_REVIEW_RUN_ID="${runId}" bash
  scripts/codex-review.sh so its metadata is bound to this run and diff.
- If you cannot finish safely, leave the repo in the clearest possible state and explain why.

Prompt file: ${basename}

User prompt:
${promptBody}
`;
}

function ensureReviewBranch() {
  const currentBranch = gitOutput(["branch", "--show-current"]).trim();
  if (currentBranch === branchName) return;

  if (dirtyStatus()) {
    throw new Error(`Working tree is dirty. Commit or stash changes before switching to ${branchName}.`);
  }

  const exists = spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], {
    cwd: repoRoot,
  }).status === 0;

  if (exists) {
    gitChecked(["switch", branchName]);
  } else {
    gitChecked(["switch", "-c", branchName]);
  }
}

function reviewBranchSafetyError() {
  const currentBranch = gitOutput(["branch", "--show-current"]).trim();
  if (currentBranch !== branchName) {
    return `expected scheduler branch ${branchName}, but the working tree is on ${currentBranch || "detached HEAD"}. The branch may have been switched while the scheduler was sleeping.`;
  }

  const mainExists = spawnSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/main"], {
    cwd: repoRoot,
  }).status === 0;
  if (!mainExists) return "local main branch is missing; cannot prove the review branch baseline is current.";

  const containsMain = spawnSync("git", ["merge-base", "--is-ancestor", "main", "HEAD"], {
    cwd: repoRoot,
  }).status === 0;
  if (!containsMain) {
    return "the scheduler review branch does not contain current main. Start a fresh queue branch from main; do not implement prompts on the stale branch.";
  }
  return null;
}

function assertSafeReviewBranch() {
  const error = reviewBranchSafetyError();
  if (error) throw new Error(error);
}

function commitIfNeeded(basename, title, logFile) {
  const status = dirtyStatus();
  if (!status) {
    appendLog(logFile, "\nNo uncommitted changes after Claude run.\n");
    console.log("No uncommitted changes to commit.");
    return;
  }

  gitChecked(["add", "-A"]);
  const message = `auto: ${path.basename(basename, ".md")}${title ? ` - ${title}` : ""}`.slice(0, 120);
  gitChecked(["commit", "-m", message]);
  appendLog(logFile, `\nCommitted changes with message: ${message}\n`);
  console.log(`Committed changes: ${message}`);
}

function readCompleted() {
  if (!fs.existsSync(stateFile)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return Array.isArray(data.completed) ? data.completed : [];
  } catch {
    return [];
  }
}

function markCompleted(basename) {
  const current = new Set(readCompleted());
  current.add(basename);
  fs.writeFileSync(stateFile, `${JSON.stringify({ completed: [...current].sort() }, null, 2)}\n`);
}

async function waitForUsageBudget() {
  while (true) {
    const snapshot = await readUsageSnapshot();
    if (!snapshot) {
      console.warn("Usage helper returned no valid data; continuing with the scheduled slot.");
      return;
    }
    if (snapshot.percent <= 50) return;
    if (!snapshot.resetsAt) {
      console.warn(`Usage is ${snapshot.percent}%, but no reset time was returned. Continuing because the gate cannot schedule a safe retry.`);
      return;
    }
    const resumeAt = new Date(snapshot.resetsAt.getTime() + 60_000);
    console.log(`Usage gate is explicitly enabled and usage is ${snapshot.percent}% > 50%; waiting until ${formatDateTime(resumeAt)}.`);
    await sleepUntil(resumeAt);
  }
}

async function readUsageSnapshot() {
  return new Promise((resolve) => {
    const child = spawn(usageHelper, [], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), 30_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) return resolve(null);
      const [percentRaw, resetRaw = ""] = output.trim().split("|");
      const percent = Number(percentRaw);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return resolve(null);
      const reset = resetRaw ? new Date(resetRaw) : null;
      const resetsAt = reset && !Number.isNaN(reset.getTime()) ? reset : null;
      resolve({ percent, resetsAt });
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

function appendRunMetrics(metrics) {
  fs.appendFileSync(metricsFile, `${JSON.stringify(metrics)}\n`);
}

function formatUsage(snapshot) {
  return `${snapshot.percent}%${snapshot.resetsAt ? ` (resets ${snapshot.resetsAt.toISOString()})` : ""}`;
}

function countWords(value) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function parseTimes(value) {
  const times = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const time of times) {
    if (!/^\d{2}:\d{2}$/.test(time)) {
      throw new Error(`Invalid time "${time}". Use HH:MM, for example 15:01.`);
    }
    const [hour, minute] = time.split(":").map(Number);
    if (hour > 23 || minute > 59) {
      throw new Error(`Invalid time "${time}".`);
    }
  }

  return times;
}

function parseVerifyCommands(value) {
  return value
    .split("&&")
    .map((command) => command.trim())
    .filter(Boolean);
}

function parseOptionalPositiveInt(value) {
  if (!value) return null;
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid positive integer "${value}".`);
  }
  const parsed = Number(value);
  return parsed > 0 ? parsed : null;
}

function nextRunSlot(after, times, earlyAt) {
  const fixedSlot = nextSlotAfter(after, times);
  fixedSlot.source = "fixed slot";

  if (!earlyAt) return fixedSlot;

  const earliestUsefulTime = after.getTime() + 1000;
  if (earlyAt.getTime() <= earliestUsefulTime) {
    const immediate = new Date(earliestUsefulTime);
    immediate.source = "early check";
    return immediate;
  }

  if (earlyAt.getTime() < fixedSlot.getTime()) {
    earlyAt.source = "early check";
    return earlyAt;
  }

  return fixedSlot;
}

function nextSlotAfter(after, times) {
  const candidates = [];
  for (let dayOffset = 0; dayOffset < 3; dayOffset += 1) {
    for (const time of times) {
      const [hour, minute] = time.split(":").map(Number);
      const candidate = new Date(after);
      candidate.setDate(after.getDate() + dayOffset);
      candidate.setHours(hour, minute, 0, 0);
      if (candidate.getTime() > after.getTime() + 1000) {
        candidates.push(candidate);
      }
    }
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates[0];
}

async function sleepUntil(date) {
  while (Date.now() < date.getTime()) {
    const remaining = date.getTime() - Date.now();
    await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 60_000)));
  }
}

async function streamCommand(command, args, logFile, input = null) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (input) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      appendLog(logFile, chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      appendLog(logFile, chunk);
    });
    child.on("close", (code) => {
      appendLog(logFile, `\n[${command} exited with code ${code}]\n`);
      resolve(code ?? 1);
    });
  });
}

function dirtyStatus() {
  return gitOutput(["status", "--porcelain"]).trim();
}

function gitOutput(args) {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function gitChecked(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function unstageAll() {
  gitChecked(["restore", "--staged", "--", "."]);
}

function appendLog(logFile, value) {
  fs.appendFileSync(logFile, value);
}

function firstPromptLine(promptFile) {
  return fs
    .readFileSync(promptFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);
}

function commandAvailable(command) {
  const pathValue = process.env.PATH || "";
  return pathValue
    .split(path.delimiter)
    .filter(Boolean)
    .some((directory) => fs.existsSync(path.join(directory, command)));
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatDateTime(date) {
  return `${formatDate(date)} ${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;
}

function formatDateTimeForFile(date) {
  return `${formatDate(date)}-${`${date.getHours()}`.padStart(2, "0")}${`${date.getMinutes()}`.padStart(2, "0")}`;
}
