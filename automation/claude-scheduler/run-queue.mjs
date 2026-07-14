#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promptContractErrorFor, promptMetadata } from "./prompt-contract.mjs";
import { runResultErrorFor } from "./run-result.mjs";
import { finalizePrompt } from "./scheduler-files.mjs";
import { buildReviewDiff } from "./review-diff.mjs";
import { finalGateError } from "./final-gate.mjs";
import {
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_DISALLOWED_TOOLS,
  REVIEWER_ALLOWED_TOOLS,
} from "./allowed-tools.mjs";
import { buildClaudeArgs } from "./claude-args.mjs";
import {
  parseReviewerEnvelope,
  readJsonFile,
  reviewerVerdictErrorFor,
  workResultErrorFor,
} from "./review-orchestration.mjs";
import { captureTrustedGate, trustedGateErrorFor } from "./trusted-gate.mjs";
import { REVIEWER_SYSTEM_PROMPT } from "./reviewer-system-prompt.mjs";
import { buildWorkerEnvironment } from "./worker-environment.mjs";
import { acquireSchedulerLock } from "./scheduler-lock.mjs";
import { ActiveProcessGuard } from "./active-process.mjs";
import {
  finalizeWithFailureGuard,
  runNonFatalTelemetry,
  runNonFatalTelemetryAsync,
} from "./finalization-guard.mjs";
import { queueStopReason } from "./queue-control.mjs";
import { runTrackedCommand } from "./tracked-command.mjs";
import { initializeRunLifecycle, shouldBlockRunOnShutdown } from "./run-lifecycle.mjs";

const DEFAULT_TIMES = ["16:00", "21:01", "02:02", "07:03", "12:04"];

const repoRoot = gitOutput(["rev-parse", "--show-toplevel"]).trim();
const schedulerDir = path.join(repoRoot, "automation", "claude-scheduler");
const promptDir = path.join(schedulerDir, "prompts");
const logDir = path.join(schedulerDir, "logs");
const stateDir = path.join(schedulerDir, "state");
const stateFile = path.join(stateDir, "completed.json");

fs.mkdirSync(promptDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });

const releaseSchedulerLock = acquireSchedulerLock(path.join(stateDir, "scheduler.lock"));
const activeProcessGuard = new ActiveProcessGuard();
let shutdownInProgress = false;
let activeRunState = null;
process.on("exit", () => {
  if (!activeProcessGuard.active) releaseSchedulerLock();
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void shutdown(signal === "SIGINT" ? 130 : 143));
}
process.on("uncaughtException", (error) => {
  console.error(error);
  void shutdown(1);
});
process.on("unhandledRejection", (error) => {
  console.error(error);
  void shutdown(1);
});

const scheduleTimes = parseTimes(process.env.CLAUDE_AUTO_TIMES || DEFAULT_TIMES.join(","));
const branchName = process.env.CLAUDE_AUTO_BRANCH || `review/claude-auto-${formatDateTimeForFile(new Date())}`;
const continueOnError = process.env.CLAUDE_AUTO_CONTINUE_ON_ERROR === "1";
const dryRun = process.env.CLAUDE_AUTO_DRY_RUN === "1";
const skipPermissions = process.env.CLAUDE_AUTO_SKIP_PERMISSIONS === "1";
const allowedTools = process.env.CLAUDE_AUTO_ALLOWED_TOOLS || DEFAULT_ALLOWED_TOOLS.join(",");
const disallowedTools = DEFAULT_DISALLOWED_TOOLS.join(",");
const verifyCommands = parseVerifyCommands(
  process.env.CLAUDE_AUTO_VERIFY || "npm run test:scheduler && npm test && npm run build",
);
const earlyCheckMinutes = parseOptionalPositiveInt(process.env.CLAUDE_AUTO_EARLY_CHECK_MINUTES);
const retryDelayMinutes = parseOptionalPositiveInt(process.env.CLAUDE_AUTO_RETRY_DELAY_MINUTES) ?? 1;
const usageHelper = process.env.CLAUDE_AUTO_USAGE_HELPER || path.join(process.env.HOME || "", ".claude", "fetch-claude-usage.swift");
const usageTelemetryEnabled = fs.existsSync(usageHelper);
// Protect the account budget by default. Operators may explicitly opt out for
// diagnostic runs, but a normal queue never starts another prompt above 50%.
const usageGateEnabled = process.env.CLAUDE_AUTO_USAGE_GATE !== "0" && usageTelemetryEnabled;
const workerTimeoutMs = timeoutMsFromEnv("CLAUDE_AUTO_WORKER_TIMEOUT_MINUTES", 120);
const codexTimeoutMs = timeoutMsFromEnv("CLAUDE_AUTO_CODEX_TIMEOUT_MINUTES", 45);
const reviewerTimeoutMs = timeoutMsFromEnv("CLAUDE_AUTO_REVIEWER_TIMEOUT_MINUTES", 30);
const verificationTimeoutMs = timeoutMsFromEnv("CLAUDE_AUTO_VERIFY_TIMEOUT_MINUTES", 60);
const metricsFile = path.join(stateDir, "run-metrics.jsonl");
const runResultFile = path.join(repoRoot, "handoffs", "RUN-RESULT.json");
const workResultFile = path.join(stateDir, "current-work.json");
const reviewDiffFile = path.join(stateDir, "current-review.diff");
const candidateResultFile = path.join(stateDir, "candidate-run-result.json");
const claudeExecutable = commandPath("claude");
const codexExecutable = commandPath("codex");

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
  console.log(`Usage telemetry: enabled${usageGateEnabled ? " (gating runs at 50%)" : " (observational; it will not delay the queue)"}.`);
}
console.log(`Remaining prompts: ${remainingPrompts.map((file) => path.basename(file)).join(", ")}`);
console.log("Keep the Mac awake with: caffeinate -dimsu node automation/claude-scheduler/run-queue.mjs");

let schedulingCursor = new Date();
for (const promptFile of remainingPrompts) {
  let retryFeedback = null;
  let retryEligibleAt = null;
  while (true) {
    const slot = nextRunSlot(schedulingCursor, scheduleTimes, retryEligibleAt);
    console.log(`\n${retryFeedback ? "Retry" : "Next prompt"} ${path.basename(promptFile)} scheduled for ${formatDateTime(slot)}${slot.source ? ` (${slot.source})` : ""}.`);

    if (!dryRun) {
      await sleepUntil(slot);
      schedulingCursor = new Date();
    } else {
      schedulingCursor = new Date(slot.getTime() + 2_000);
    }
    if (usageGateEnabled && !dryRun) {
      await waitForUsageBudget();
    }

    const outcome = await runPrompt(promptFile, retryFeedback);
    if (outcome.retryFeedback) {
      retryFeedback = outcome.retryFeedback;
      retryEligibleAt = new Date(Date.now() + retryDelayMinutes * 60_000);
      console.log(`Review requested fixes for ${path.basename(promptFile)}; retrying after ${retryDelayMinutes} minute(s), subject to the usage gate.`);
      continue;
    }

    const stopReason = queueStopReason({
      ok: outcome.ok,
      activeProcess: activeProcessGuard.active,
      continueOnError,
    });
    if (stopReason === "active-process") {
      console.error("Stopping queue because a timed-out process group could not be confirmed stopped; retaining scheduler lock.");
      process.exit(1);
    }
    if (outcome.ok && earlyCheckMinutes) {
      schedulingCursor = new Date(Date.now() + earlyCheckMinutes * 60_000);
    }
    if (stopReason === "failed-run") {
      console.error("Stopping queue because Claude or verification failed.");
      process.exit(1);
    }
    break;
  }
}

console.log("\nPrompt queue finished.");
releaseSchedulerLock();

async function runPrompt(promptFile, retryFeedback = null) {
  const basename = path.basename(promptFile);
  const startedAt = new Date();
  const runId = randomUUID();
  const logFile = path.join(logDir, `${formatDateTimeForFile(startedAt)}-${basename.replace(/\.md$/, "")}.log`);
  const promptBody = fs.readFileSync(promptFile, "utf8");
  const trustedClaudeContext = fs.readFileSync(path.join(repoRoot, "CLAUDE.md"), "utf8");
  const promptContractError = promptContractErrorFor(promptBody, repoRoot);
  const metadata = promptMetadata(promptBody);
  const fullPrompt = buildPrompt(promptBody, basename, runId, retryFeedback);
  let ok = true;
  let reviewedDiffHash = null;
  let approvedRunResult = null;
  if (!dryRun) {
    activeRunState = {
      prompt: basename,
      runId,
      approvalPublished: false,
      commitSucceeded: false,
    };
  }
  const usageBefore = await initializeRunLifecycle({
    dryRun,
    writeRunning: () => writeRunLifecycleResult(basename, runId, "running", "Scheduler preflight started."),
    readUsage: usageTelemetryEnabled && !dryRun ? readUsageSnapshot : null,
  });
  const metrics = {
    prompt: basename,
    runId,
    startedAt: startedAt.toISOString(),
    promptBytes: Buffer.byteLength(promptBody),
    promptWords: countWords(promptBody),
    risk: metadata.risk,
    route: metadata.route,
    codexReview: metadata.codexReview,
    usageBefore,
    claudeExitCode: null,
    verification: [],
  };
  const failPreflight = (message) => {
    if (!dryRun) {
      writeRunLifecycleResult(basename, runId, "blocked", message);
      activeRunState = null;
    }
    return { ok: false, retryFeedback: null };
  };

  appendLog(logFile, `# ${basename}\nStarted: ${startedAt.toISOString()}\nBranch: ${gitOutput(["branch", "--show-current"]).trim()}\n\n`);
  if (metrics.usageBefore) {
    appendLog(logFile, `Usage before run: ${formatUsage(metrics.usageBefore)}\n`);
  }
  if (promptContractError) {
    appendLog(logFile, `Prompt contract failed: ${promptContractError}\n`);
    console.error(`Cannot run ${basename}: ${promptContractError}`);
    return failPreflight(`Prompt contract failed: ${promptContractError}`);
  }
  if (!claudeExecutable) {
    const message = "Claude CLI is unavailable or not executable.";
    appendLog(logFile, `${message}\n`);
    console.error(`Cannot run ${basename}: ${message}`);
    return failPreflight(message);
  }
  if (metadata.codexReview === "required" && !codexExecutable) {
    const message = "Codex review is required for this high-risk prompt, but the codex CLI is unavailable.";
    appendLog(logFile, `${message}\n`);
    console.error(`Cannot run ${basename}: ${message}`);
    return failPreflight(message);
  }

  const branchError = dryRun ? null : reviewBranchSafetyError();
  if (branchError !== null) {
    appendLog(logFile, `Scheduler branch preflight failed: ${branchError}\n`);
    console.error(`Cannot run ${basename}: ${branchError}`);
    return failPreflight(`Scheduler branch preflight failed: ${branchError}`);
  }

  if (!dryRun && dirtyStatusExcludingRunResult() && !retryFeedback) {
    appendLog(logFile, "Working tree was dirty before Claude started. Aborting this prompt.\n");
    console.error(`Working tree is dirty before ${basename}; resolve it before continuing.`);
    return failPreflight("Working tree became dirty before implementation started.");
  } else if (!dryRun && retryFeedback) {
    appendLog(logFile, "Retrying the previous implementation diff with reviewer feedback.\n");
  }
  if (!dryRun) fs.rmSync(workResultFile, { force: true });
  const trustedGateSnapshot = dryRun ? null : captureTrustedGate(repoRoot);
  if (!dryRun) writeRunLifecycleResult(basename, runId, "running", "Implementation phase started.");

  console.log(`${dryRun ? "Dry-run validating" : "Running Claude for"} ${basename}. Log: ${logFile}`);
  if (!dryRun) {
    const claudeArgs = buildClaudeArgs({ allowedTools, disallowedTools, skipPermissions });
    const workerCodexHome = path.join(stateDir, "worker-no-codex");
    const isolatedBin = path.join(stateDir, "worker-bin");
    fs.mkdirSync(workerCodexHome, { recursive: true });
    fs.mkdirSync(isolatedBin, { recursive: true });
    for (const command of ["codex", "claude"]) {
      const shim = path.join(isolatedBin, command);
      fs.writeFileSync(shim, "#!/bin/sh\necho 'disabled in implementation worker' >&2\nexit 126\n");
      fs.chmodSync(shim, 0o755);
    }
    const workerEnv = buildWorkerEnvironment(process.env, {
      isolatedBin,
      isolatedCodexHome: workerCodexHome,
    });
    const claudeCode = await streamCommand(
      claudeExecutable,
      claudeArgs,
      logFile,
      fullPrompt,
      workerEnv,
      workerTimeoutMs,
    );
    metrics.claudeExitCode = claudeCode;
    ok = ok && claudeCode === 0;
  } else {
    appendLog(logFile, "[dry run] Claude execution skipped.\n");
  }

  let workResult = null;
  let codexEvidence = null;
  let reviewerVerdict = null;
  let nextRetryFeedback = null;
  const reviewerContextExpansions = [];
  if (ok && !dryRun) {
    workResult = readJsonFile(workResultFile);
    const workError = workResultErrorFor(workResult, { prompt: basename, runId });
    if (workError) {
      appendLog(logFile, `Implementation phase gate failed: ${workError}\n`);
      console.error(`Cannot review ${basename}: ${workError}`);
      ok = false;
    }
    const trustedError = trustedGateErrorFor(repoRoot, trustedGateSnapshot);
    if (trustedError) {
      appendLog(logFile, `Trusted gate failed: ${trustedError}\n`);
      console.error(`Cannot review ${basename}: ${trustedError}`);
      ok = false;
    }
  }

  if (ok && !dryRun && metadata.codexReview === "required") {
    codexEvidence = await runExternalCodexReview(runId, startedAt, logFile, null);
    ok = codexEvidence !== null;
  }

  if (ok && !dryRun) {
    reviewerVerdict = await runFinalReviewer({
      promptBody,
      basename,
      runId,
      codexPolicy: metadata.codexReview,
      codexEvidence,
      trustedClaudeContext,
      logFile,
    });
    let verdictError = reviewerVerdictErrorFor(reviewerVerdict, {
      codexPolicy: metadata.codexReview,
      codexAvailable: codexEvidence !== null,
    });
    if (verdictError) {
      appendLog(logFile, `Reviewer verdict gate failed: ${verdictError}\n`);
      console.error(`Cannot approve ${basename}: ${verdictError}`);
      ok = false;
    } else {
      reviewerContextExpansions.push(...reviewerVerdict.contextExpansions);
    }

    if (ok && reviewerVerdict.status === "codex-requested") {
      appendLog(logFile, "Conditional reviewer requested Codex; scheduler is running it externally.\n");
      const codexRequest = reviewerVerdict.codexRequest;
      codexEvidence = await runExternalCodexReview(runId, startedAt, logFile, codexRequest);
      ok = codexEvidence !== null;
      if (ok) {
        reviewerVerdict = await runFinalReviewer({
          promptBody,
          basename,
          runId,
          codexPolicy: metadata.codexReview,
          codexEvidence,
          priorCodexRequest: codexRequest,
          trustedClaudeContext,
          logFile,
        });
        verdictError = reviewerVerdictErrorFor(reviewerVerdict, {
          codexPolicy: metadata.codexReview,
          codexAvailable: true,
        });
        if (verdictError) {
          appendLog(logFile, `Resumed reviewer verdict gate failed: ${verdictError}\n`);
          console.error(`Cannot approve ${basename}: ${verdictError}`);
          ok = false;
        } else {
          reviewerContextExpansions.push(...reviewerVerdict.contextExpansions);
        }
      }
    }
  }

  if (ok && !dryRun && reviewerVerdict.status !== "approve") {
    appendLog(logFile, `Final reviewer returned ${reviewerVerdict.status}: ${JSON.stringify(reviewerVerdict.blockers)}\n`);
    if (reviewerVerdict.status === "changes-required") {
      nextRetryFeedback = reviewerVerdict.blockers;
      console.log(`Reviewer requested fixes for ${basename}; preserving the diff for an automatic retry.`);
    } else {
      console.error(`Cannot approve ${basename}: reviewer returned ${reviewerVerdict.status}.`);
    }
    ok = false;
  }

  if (ok && !dryRun) {
    reviewedDiffHash = buildReviewDiff(repoRoot).hash;
    const requested = codexEvidence !== null;
    approvedRunResult = {
      prompt: basename,
      runId,
      status: "approved",
      reviewerVerdict: "approve",
      codexReview: requested
        ? {
            policy: metadata.codexReview,
            requested: true,
            status: "passed",
            artifact: codexEvidence.artifact,
            metadata: codexEvidence.metadata,
            diffHash: codexEvidence.diffHash,
          }
        : {
            policy: metadata.codexReview,
            requested: false,
            status: "skipped",
            reason: metadata.codexReview === "skip"
              ? "Prompt policy explicitly skips independent Codex review."
              : "Conditional reviewer approved without boundary expansion or unresolved uncertainty.",
          },
      contextExpansions: [...new Set([
        ...workResult.contextExpansions,
        ...reviewerContextExpansions,
      ])],
      wiki: reviewerVerdict.wiki,
    };
    fs.writeFileSync(candidateResultFile, `${JSON.stringify(approvedRunResult, null, 2)}\n`);
    const resultError = runResultErrorFor({
      resultFile: candidateResultFile,
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
    } else {
      writeRunLifecycleResult(basename, runId, "verification-pending", "Review approved; final verification is pending.");
    }
  }

  for (const command of ok ? verifyCommands : []) {
    appendLog(logFile, `\n$ ${command}\n`);
    if (!dryRun) {
      const [cmd, ...args] = command.split(/\s+/);
      const code = await streamCommand(cmd, args, logFile, null, process.env, verificationTimeoutMs);
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

  if (ok && !dryRun) {
    fs.writeFileSync(runResultFile, `${JSON.stringify(approvedRunResult, null, 2)}\n`);
    activeRunState.approvalPublished = true;
    const finalResultError = runResultErrorFor({
      resultFile: runResultFile,
      repoRoot,
      prompt: basename,
      runId,
      codexPolicy: metadata.codexReview,
      startedAt,
      currentDiffHash: buildReviewDiff(repoRoot).hash,
    });
    if (finalResultError) {
      appendLog(logFile, `Final run result gate failed: ${finalResultError}\n`);
      console.error(`Cannot commit ${basename}: ${finalResultError}`);
      ok = false;
    }
  }

  if (dryRun) {
    appendLog(logFile, "\nDry run: no commit and no completed-state update.\n");
  } else if (ok) {
    const promptTitle = firstPromptLine(promptFile);
    let commitMessage = null;
    const finalizationError = finalizeWithFailureGuard(
      () => {
        finalizePrompt({
          promptFile,
          archiveDir: path.join(schedulerDir, "archive", "completed"),
          commit: () => {
            commitMessage = commitIfNeeded(basename, promptTitle);
            activeRunState.commitSucceeded = true;
          },
          unstage: unstageAll,
        });
      },
      (error) => {
        writeRunLifecycleResult(basename, runId, "blocked", `Finalization failed: ${error.message}`);
        appendLog(logFile, `Finalization failed: ${error.stack || error.message}\n`);
      },
    );
    if (finalizationError) {
      ok = false;
    } else {
      runNonFatalTelemetry(
        () => {
          appendLog(logFile, `\nCommitted changes with message: ${commitMessage}\n`);
          console.log(`Committed changes: ${commitMessage}`);
        },
        (error) => safeTelemetryWarning("post-commit logging", error),
      );
      runNonFatalTelemetry(
        () => markCompleted(basename),
        (error) => safeTelemetryWarning("completed-state update", error),
      );
    }
  } else if (nextRetryFeedback) {
    writeRunLifecycleResult(basename, runId, "running", "Reviewer requested fixes; scheduler will retry this prompt automatically.");
    appendLog(logFile, "\nReview requested fixes; preserving changes for automatic retry.\n");
  } else {
    writeRunLifecycleResult(basename, runId, "blocked", "Run, review or verification failed; inspect the current scheduler log.");
    appendLog(logFile, "\nRun or verification failed: changes were intentionally left uncommitted for human recovery.\nPrompt was not marked as completed.\n");
  }
  await runNonFatalTelemetryAsync(
    async () => {
      metrics.finishedAt = new Date().toISOString();
      metrics.durationSeconds = Math.round((new Date(metrics.finishedAt).getTime() - startedAt.getTime()) / 1000);
      metrics.status = nextRetryFeedback ? "retrying" : ok ? "ok" : "failed";
      metrics.usageAfter = usageTelemetryEnabled && !dryRun ? await readUsageSnapshot() : null;
      if (!dryRun) appendRunMetrics(metrics);
      if (metrics.usageAfter) {
        appendLog(logFile, `Usage after run: ${formatUsage(metrics.usageAfter)}\n`);
      }
      appendLog(logFile, `\nFinished: ${new Date().toISOString()}\nStatus: ${nextRetryFeedback ? "retrying" : ok ? "ok" : "failed"}\n`);
    },
    (error) => safeTelemetryWarning("run metrics", error),
  );
  activeRunState = null;
  return { ok, retryFeedback: nextRetryFeedback };
}

function buildPrompt(promptBody, basename, runId, retryFeedback = null) {
  return `You are working unattended in this repository.

Before editing, read CLAUDE.md, then read only the wiki pages and source
touchpoints declared in the prompt. Do not expand context to unrelated pages,
historic handoffs, or a full repository scan unless a direct dependency makes
it necessary; record that exception in the final report.

Use the implementation roles from the tier routing contract in
.claude/commands/tier.md and delegate architect/developer/test-writer roles as
declared. Do not delegate the final reviewer: the scheduler runs that role in a
separate read-only phase after implementation.

Automation constraints:
- Work only in the current repository.
- Do not merge, rebase, or switch to main.
- Do not commit or push. The scheduler owns the final verification, archive move,
  commit and any later operator-approved push.
- Keep the change scoped to the user prompt.
- Treat current main code, tests, and CLAUDE.md as authoritative. If part of the prompt is already implemented, verify it and do not reimplement, revert, or weaken it.
- Follow the implementation part of ## Risk and routing. Do not invoke Codex;
  the scheduler owns independent review outside this Claude process.
- Workers run focused verification while iterating. The scheduler owns the one
  final npm run test:scheduler + npm test + npm run build gate.
- When the prompt requires a browser scenario, use the configured Playwright
  MCP tools for navigation, interaction and assertions. Start Vite with the
  allowed npm run dev -- --host 127.0.0.1 --port 5174 command as supporting
  infrastructure when needed; verify the loaded page is the current N2Hub app
  (title N2Hub Planer) before testing, then stop that Vite process afterwards.
  do not execute scripts/browser-check-*.mjs from the worker. Record the MCP
  scenario and outcome in focusedChecks.
- Report synthesized results only. Include context expansions, exact focused
  checks, deviations and blockers; do not paste raw logs.
- Before exiting, write automation/claude-scheduler/state/current-work.json with
  exactly {"prompt":"${basename}","runId":"${runId}","status":"ready|blocked",
  "contextExpansions":[],"focusedChecks":[]} using synthesized strings only.
  Use ready only when implementation and focused checks are complete. Include
  at least one nonblank result; for a docs-only task use a reasoned
  "not applicable: ..." entry. This is
  a local phase result; do not write handoffs/RUN-RESULT.json.
- If you cannot finish safely, leave the repo in the clearest possible state and explain why.

Prompt file: ${basename}

User prompt:
${promptBody}
${retryFeedback ? `\nPrevious reviewer findings — address every item below in this retry. Keep and improve the existing uncommitted diff; do not discard it.\n${retryFeedback.map((item) => `- ${item}`).join("\n")}` : ""}
`;
}

async function runExternalCodexReview(runId, startedAt, logFile, focus) {
  appendLog(logFile, "\nScheduler-owned Codex review:\n");
  const args = ["scripts/codex-review.sh", "--run-id", runId];
  if (focus) args.push("--focus", focus);
  const code = await streamCommand("bash", args, logFile, null, process.env, codexTimeoutMs);
  if (code !== 0) {
    console.error(`Codex review failed with exit ${code}.`);
    return null;
  }

  const evidence = findCodexEvidence(runId, startedAt);
  if (!evidence) {
    appendLog(logFile, "Codex review finished but no fresh matching metadata was found.\n");
    console.error("Codex review produced no fresh matching evidence.");
    return null;
  }
  return evidence;
}

function findCodexEvidence(runId, startedAt) {
  const reviewsDir = path.join(repoRoot, "reviews");
  if (!fs.existsSync(reviewsDir)) return null;
  const candidates = fs.readdirSync(reviewsDir)
    .filter((file) => file.endsWith("-codex-review.json"))
    .map((file) => ({ file, fullPath: path.join(reviewsDir, file) }))
    .filter(({ fullPath }) => fs.statSync(fullPath).mtimeMs + 2_000 >= startedAt.getTime())
    .sort((a, b) => fs.statSync(b.fullPath).mtimeMs - fs.statSync(a.fullPath).mtimeMs);

  for (const candidate of candidates) {
    const metadata = readJsonFile(candidate.fullPath);
    if (metadata?.runId !== runId || metadata.diffHash !== buildReviewDiff(repoRoot).hash) continue;
    if (typeof metadata.reviewArtifact !== "string") continue;
    const artifactPath = path.resolve(repoRoot, metadata.reviewArtifact);
    if (!fs.existsSync(artifactPath) || !fs.readFileSync(artifactPath, "utf8").trim()) continue;
    return {
      artifact: metadata.reviewArtifact,
      metadata: path.relative(repoRoot, candidate.fullPath),
      diffHash: metadata.diffHash,
    };
  }
  return null;
}

async function runFinalReviewer({
  promptBody,
  basename,
  runId,
  codexPolicy,
  codexEvidence,
  priorCodexRequest = null,
  trustedClaudeContext,
  logFile,
}) {
  const reviewDiff = buildReviewDiff(repoRoot);
  fs.writeFileSync(reviewDiffFile, reviewDiff.diff);
  const reviewerArgs = [
    ...buildClaudeArgs({
      allowedTools: REVIEWER_ALLOWED_TOOLS.join(","),
      disallowedTools: [...DEFAULT_DISALLOWED_TOOLS, "Bash", "Write", "Edit", "MultiEdit"].join(","),
      settingSources: "",
    }),
    "--tools",
    REVIEWER_ALLOWED_TOOLS.join(","),
    "--safe-mode",
    "--model",
    "fable",
    "--system-prompt",
    REVIEWER_SYSTEM_PROMPT,
    "--no-session-persistence",
    "--output-format",
    "json",
  ];
  const evidenceText = codexEvidence
    ? `Read and adjudicate ${codexEvidence.artifact}; its verified diff hash is ${codexEvidence.diffHash}.${priorCodexRequest ? ` The first reviewer requested Codex because: ${priorCodexRequest}` : ""}`
    : codexPolicy === "conditional"
      ? "No Codex artifact exists yet. Return codex-requested only if the prompt's conditional trigger is now met."
      : "The prompt policy skips Codex review.";
  const reviewerPrompt = `Perform the scheduler-owned final read-only review for ${basename}.

Use the authoritative pre-worker CLAUDE.md content supplied below. Read the
prompt's declared wiki pages and touchpoints,
automation/claude-scheduler/state/current-work.json, the structural uncommitted
diff at automation/claude-scheduler/state/current-review.diff (SHA-256
${reviewDiff.hash}) and only direct dependencies needed to validate a finding. Do not delegate,
edit files or repeat the full test/build suite.

Codex policy: ${codexPolicy}.
${evidenceText}

Return only JSON with exactly:
{"status":"approve|changes-required|codex-requested","blockers":[],
"contextExpansions":[],
"codexRequest":"<required only when requesting>",
"codexFindings":"<required when evidence is supplied>",
"wiki":{"status":"updated|unchanged","reason":"<specific>"}}

codex-requested is valid only for a first conditional review without evidence.
Approve only when the diff, tests and conventions are adequate.

Authoritative pre-worker CLAUDE.md:
${trustedClaudeContext}

Prompt:
${promptBody}
`;
  appendLog(logFile, "\nScheduler-owned read-only reviewer phase:\n");
  const result = await captureCommand(
    claudeExecutable,
    reviewerArgs,
    logFile,
    reviewerPrompt,
    reviewerTimeoutMs,
  );
  if (result.code !== 0) return null;
  if (buildReviewDiff(repoRoot).hash !== reviewDiff.hash) {
    appendLog(logFile, "Reviewer phase changed the canonical diff; rejecting verdict.\n");
    return null;
  }
  const verdict = parseReviewerEnvelope(result.stdout);
  appendLog(logFile, `Reviewer machine verdict: ${JSON.stringify(verdict)}\n`);
  return verdict;
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

function commitIfNeeded(basename, title) {
  const status = dirtyStatus();
  if (!status) return null;

  gitChecked(["add", "-A"]);
  const message = `auto: ${path.basename(basename, ".md")}${title ? ` - ${title}` : ""}`.slice(0, 120);
  gitChecked(["commit", "-m", message]);
  return message;
}

function safeTelemetryWarning(label, error) {
  try {
    console.warn(`Optional ${label} failed: ${error.message}`);
  } catch {
    // Telemetry must never change the durable result after finalization.
  }
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
      throw new Error("Usage gate could not read a valid usage snapshot; refusing to start the next prompt.");
    }
    if (snapshot.percent <= 50) return;
    if (!snapshot.resetsAt) {
      throw new Error(`Usage is ${snapshot.percent}%, but no reset time was returned; refusing to start the next prompt.`);
    }
    const resumeAt = new Date(snapshot.resetsAt.getTime() + 60_000);
    console.log(`Usage gate is enabled and usage is ${snapshot.percent}% > 50%; waiting until ${formatDateTime(resumeAt)}.`);
    await sleepUntil(resumeAt);
  }
}

async function readUsageSnapshot() {
  const result = await runTrackedCommand({
    command: usageHelper,
    args: [],
    cwd: repoRoot,
    env: process.env,
    timeoutMs: 30_000,
    timeoutGraceMs: 1_000,
    guard: activeProcessGuard,
    capture: true,
  });
  if (result.code !== 0) return null;
  const [percentRaw, resetRaw = ""] = result.stdout.trim().split("|");
  const percent = Number(percentRaw);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  const reset = resetRaw ? new Date(resetRaw) : null;
  const resetsAt = reset && !Number.isNaN(reset.getTime()) ? reset : null;
  return { percent, resetsAt };
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

function timeoutMsFromEnv(name, defaultMinutes) {
  const minutes = parseOptionalPositiveInt(process.env[name]) ?? defaultMinutes;
  return minutes * 60_000;
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

async function shutdown(exitCode) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  if (shouldBlockRunOnShutdown(activeRunState)) {
    try {
      writeRunLifecycleResult(
        activeRunState.prompt,
        activeRunState.runId,
        "blocked",
        "Scheduler stopped before the active run was durably committed.",
      );
    } catch (error) {
      console.error(`Could not record blocked shutdown state: ${error.message}`);
    }
  }
  const terminated = await activeProcessGuard.terminate();
  if (terminated) releaseSchedulerLock();
  else console.error("Active model process could not be confirmed stopped; retaining stale scheduler lock.");
  process.exit(exitCode);
}

async function streamCommand(command, args, logFile, input = null, env = process.env, timeoutMs = null) {
  return runTrackedCommand({
    command,
    args,
    cwd: repoRoot,
    env,
    input,
    timeoutMs,
    guard: activeProcessGuard,
    onStdout: (chunk) => {
      process.stdout.write(chunk);
      appendLog(logFile, chunk);
    },
    onStderr: (chunk) => {
      process.stderr.write(chunk);
      appendLog(logFile, chunk);
    },
    onLog: (value) => appendLog(logFile, value),
  });
}

async function captureCommand(command, args, logFile, input = null, timeoutMs = null) {
  return runTrackedCommand({
    command,
    args,
    cwd: repoRoot,
    env: process.env,
    input,
    timeoutMs,
    guard: activeProcessGuard,
    capture: true,
    onLog: (value) => appendLog(logFile, value),
    onStdout: (chunk) => appendLog(logFile, chunk),
    onStderr: (chunk) => {
      process.stderr.write(chunk);
      appendLog(logFile, chunk);
    },
  });
}

function dirtyStatus() {
  return gitOutput(["status", "--porcelain"]).trim();
}

function dirtyStatusExcludingRunResult() {
  return gitOutput(["status", "--porcelain"])
    .split(/\r?\n/)
    .filter((line) => line && !line.endsWith(" handoffs/RUN-RESULT.json"))
    .join("\n")
    .trim();
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

function commandPath(command) {
  const pathValue = process.env.PATH || "";
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  return null;
}

function writeRunLifecycleResult(prompt, runId, status, reason) {
  fs.writeFileSync(runResultFile, `${JSON.stringify({
    prompt,
    runId,
    status,
    reviewerVerdict: status === "blocked" ? "changes-required" : "pending",
    reason,
  }, null, 2)}\n`);
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
