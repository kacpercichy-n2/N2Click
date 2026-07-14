#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const INTERVAL_MS = (5 * 60 + 1) * 60_000;
const USAGE_LIMIT = 50;
const repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
const schedulerDir = path.join(repoRoot, "automation", "claude-scheduler");
const promptDir = path.join(schedulerDir, "prompts");
const archiveDir = path.join(schedulerDir, "archive", "completed");
const logDir = path.join(schedulerDir, "logs");
const usageHelper = process.env.CLAUDE_AUTO_USAGE_HELPER
  || path.join(process.env.HOME || "", ".claude", "fetch-claude-usage.swift");
const branchName = ensureReviewBranch();

fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(archiveDir, { recursive: true });

const prompts = fs.readdirSync(promptDir)
  .filter((file) => file.endsWith(".md"))
  .sort((a, b) => a.localeCompare(b, "en"));

if (prompts.length === 0) {
  console.log("No active prompts remain.");
  process.exit(0);
}

console.log(`Repo: ${repoRoot}`);
console.log(`Review branch: ${branchName}`);
console.log(`Interval: 5h 1m`);
console.log(`Usage gate: run only at <= ${USAGE_LIMIT}%`);
console.log(`Prompts: ${prompts.join(", ")}`);

for (let index = 0; index < prompts.length; index += 1) {
  const basename = prompts[index];
  const promptFile = path.join(promptDir, basename);
  await waitForUsageBudget();
  const runStartedAt = Date.now();
  await runPrompt(promptFile, basename);
  if (index < prompts.length - 1) {
    const nextAt = new Date(runStartedAt + INTERVAL_MS);
    console.log(`Next prompt waits until ${formatDateTime(nextAt)}.`);
    await sleepUntil(nextAt);
  }
}

console.log("Prompt queue finished.");

async function runPrompt(promptFile, basename) {
  const startedAt = new Date();
  const logFile = path.join(logDir, `${formatForFile(startedAt)}-${basename.replace(/\.md$/, "")}.log`);
  const promptBody = fs.readFileSync(promptFile, "utf8");
  const workerPrompt = `Work on the following repository task autonomously.\n\nRead CLAUDE.md first, then only the wiki context and touchpoints declared by the prompt. Implement the task, use the model and tools you judge necessary, and run the checks you judge useful. Do not commit, push, merge, rebase, or switch branches; the scheduler snapshots and pushes the result.\n\nPrompt file: ${basename}\n\n${promptBody}`;

  console.log(`Running ${basename}.`);
  appendLog(logFile, `# ${basename}\nStarted: ${startedAt.toISOString()}\nBranch: ${branchName}\n\n`);
  const code = await run("claude", ["--print", "--dangerously-skip-permissions"], workerPrompt, logFile);
  appendLog(logFile, `\nClaude exit code: ${code}\n`);

  // There is intentionally no reviewer, test gate or blocker here. Each slot
  // snapshots the model's current result and advances the queue.
  fs.renameSync(promptFile, path.join(archiveDir, basename));
  git(["add", "-A"]);
  const title = firstLine(promptBody) || basename;
  git(["commit", "-m", `auto: ${basename.replace(/\.md$/, "")} - ${title}`], { allowFailure: true });
  const pushCode = runSync("git", ["push", "-u", "origin", branchName]);
  appendLog(logFile, `Git push exit code: ${pushCode}\nFinished: ${new Date().toISOString()}\n`);
  console.log(`Finished ${basename}; pushed ${branchName} (exit ${pushCode}).`);
}

async function waitForUsageBudget() {
  while (true) {
    const usage = await readUsage();
    if (usage && usage.percent <= USAGE_LIMIT) {
      console.log(`Usage ${usage.percent}%: starting the next prompt.`);
      return;
    }
    if (usage?.resetsAt) {
      const resumeAt = new Date(usage.resetsAt.getTime() + 60_000);
      console.log(`Usage ${usage.percent}%: waiting for reset at ${formatDateTime(resumeAt)}.`);
      await sleepUntil(resumeAt);
      continue;
    }
    console.log("Usage is unavailable; retrying the check in 5 minutes.");
    await sleepUntil(new Date(Date.now() + 5 * 60_000));
  }
}

async function readUsage() {
  if (!fs.existsSync(usageHelper)) return null;
  const result = await capture(usageHelper, []);
  if (result.code !== 0) return null;
  const [percentRaw, resetRaw = ""] = result.stdout.trim().split("|");
  const percent = Number(percentRaw);
  const reset = resetRaw ? new Date(resetRaw) : null;
  if (!Number.isFinite(percent)) return null;
  return { percent, resetsAt: reset && !Number.isNaN(reset.getTime()) ? reset : null };
}

function ensureReviewBranch() {
  const current = git(["branch", "--show-current"]).trim();
  if (current.startsWith("review/")) return current;
  const next = `review/claude-auto-${formatForFile(new Date())}`;
  git(["checkout", "-b", next]);
  return next;
}

function git(args, { allowFailure = false } = {}) {
  const result = captureSync("git", args);
  if (result.code !== 0 && !allowFailure) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout;
}

function runSync(command, args) {
  return captureSync(command, args).code;
}

function captureSync(command, args) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8" });
  return { code: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function capture(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
    child.on("error", () => resolve({ code: 1, stdout: "" }));
  });
}

function run(command, args, input, logFile) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => appendLog(logFile, chunk));
    child.stderr.on("data", (chunk) => appendLog(logFile, chunk));
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (error) => { appendLog(logFile, `${error.message}\n`); resolve(1); });
    child.stdin.end(input);
  });
}

function appendLog(file, value) { fs.appendFileSync(file, String(value)); }
function firstLine(value) { return value.split("\n").find((line) => line.trim() && !line.startsWith("#"))?.trim(); }
function formatForFile(date) { return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}-${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`; }
function formatDateTime(date) { return `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`; }
async function sleepUntil(date) { while (Date.now() < date.getTime()) await new Promise((resolve) => setTimeout(resolve, Math.min(60_000, date.getTime() - Date.now()))); }
