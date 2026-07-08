#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const DEFAULT_TIMES = ["10:00", "15:01", "21:00", "01:00", "06:00"];
const DEFAULT_ALLOWED_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Glob",
  "Grep",
  "LS",
  "TodoWrite",
  "Bash(git *)",
  "Bash(npm *)",
  "Bash(npx *)",
  "Bash(node *)",
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
const branchName = process.env.CLAUDE_AUTO_BRANCH || `review/claude-auto-${formatDate(new Date())}`;
const continueOnError = process.env.CLAUDE_AUTO_CONTINUE_ON_ERROR === "1";
const dryRun = process.env.CLAUDE_AUTO_DRY_RUN === "1";
const skipPermissions = process.env.CLAUDE_AUTO_SKIP_PERMISSIONS === "1";
const allowedTools = process.env.CLAUDE_AUTO_ALLOWED_TOOLS || DEFAULT_ALLOWED_TOOLS.join(",");
const verifyCommands = parseVerifyCommands(process.env.CLAUDE_AUTO_VERIFY || "npm test && npm run build");

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
const remainingPrompts = promptFiles.filter((file) => !completed.includes(path.basename(file)));

if (remainingPrompts.length === 0) {
  console.log("All prompt files are already marked as completed.");
  process.exit(0);
}

ensureReviewBranch();

console.log(`Repo: ${repoRoot}`);
console.log(`Branch: ${gitOutput(["branch", "--show-current"]).trim()}`);
console.log(`Schedule: ${scheduleTimes.join(", ")}`);
console.log(`Remaining prompts: ${remainingPrompts.map((file) => path.basename(file)).join(", ")}`);
console.log("Keep the Mac awake with: caffeinate -dimsu node automation/claude-scheduler/run-queue.mjs");

for (const promptFile of remainingPrompts) {
  const slot = nextSlotAfter(new Date(), scheduleTimes);
  console.log(`\nNext prompt ${path.basename(promptFile)} scheduled for ${formatDateTime(slot)}.`);

  if (!dryRun) {
    await sleepUntil(slot);
  }

  const ok = await runPrompt(promptFile);
  if (!ok && !continueOnError) {
    console.error("Stopping queue because Claude or verification failed.");
    process.exit(1);
  }
}

console.log("\nPrompt queue finished.");

async function runPrompt(promptFile) {
  const basename = path.basename(promptFile);
  const startedAt = new Date();
  const logFile = path.join(logDir, `${formatDateTimeForFile(startedAt)}-${basename.replace(/\.md$/, "")}.log`);
  const promptBody = fs.readFileSync(promptFile, "utf8");
  const fullPrompt = buildPrompt(promptBody, basename);
  let ok = true;

  appendLog(logFile, `# ${basename}\nStarted: ${startedAt.toISOString()}\nBranch: ${gitOutput(["branch", "--show-current"]).trim()}\n\n`);

  if (dirtyStatus()) {
    appendLog(logFile, "Working tree was dirty before Claude started. Aborting this prompt.\n");
    console.error(`Working tree is dirty before ${basename}; resolve it before continuing.`);
    return false;
  }

  console.log(`Running Claude for ${basename}. Log: ${logFile}`);
  if (!dryRun) {
    const claudeArgs = skipPermissions
      ? ["--print", "--dangerously-skip-permissions", fullPrompt]
      : ["--print", "--allowedTools", allowedTools, fullPrompt];
    const claudeCode = await streamCommand("claude", claudeArgs, logFile);
    ok = ok && claudeCode === 0;
  } else {
    appendLog(logFile, "[dry run] Claude execution skipped.\n");
  }

  for (const command of verifyCommands) {
    appendLog(logFile, `\n$ ${command}\n`);
    if (!dryRun) {
      const [cmd, ...args] = command.split(/\s+/);
      const code = await streamCommand(cmd, args, logFile);
      ok = ok && code === 0;
    }
  }

  commitIfNeeded(promptFile, ok, logFile);
  if (ok) {
    markCompleted(basename);
  } else {
    appendLog(logFile, "\nPrompt was not marked as completed because Claude or verification failed.\n");
  }
  appendLog(logFile, `\nFinished: ${new Date().toISOString()}\nStatus: ${ok ? "ok" : "failed"}\n`);
  return ok;
}

function buildPrompt(promptBody, basename) {
  return `You are working unattended in this repository.

Before editing, read CLAUDE.md and follow its project rules.

Automation constraints:
- Work only in the current repository.
- Do not merge, rebase, or switch to main.
- Do not push to remote.
- Keep the change scoped to the user prompt.
- Commit your completed work to the current review branch if there are changes.
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

function commitIfNeeded(promptFile, ok, logFile) {
  const status = dirtyStatus();
  if (!status) {
    appendLog(logFile, "\nNo uncommitted changes after Claude run.\n");
    console.log("No uncommitted changes to commit.");
    return;
  }

  gitChecked(["add", "-A"]);
  const title = firstPromptLine(promptFile);
  const prefix = ok ? "auto" : "auto-failed";
  const message = `${prefix}: ${path.basename(promptFile, ".md")}${title ? ` - ${title}` : ""}`.slice(0, 120);
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

async function streamCommand(command, args, logFile) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

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
