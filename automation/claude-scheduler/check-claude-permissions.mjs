#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_DISALLOWED_TOOLS,
} from "./allowed-tools.mjs";
import { buildClaudeArgs } from "./claude-args.mjs";

const EXPECTED_COMMAND = "pwd";
const FORBIDDEN_COMMAND = "codex exec --help";

export function smokeErrorFor(events, expectedCommand = EXPECTED_COMMAND, expectedOutput = null) {
  const toolUses = events.flatMap((event) =>
    event?.type === "assistant" && Array.isArray(event.message?.content)
      ? event.message.content.filter((item) => item?.type === "tool_use")
      : [],
  );
  if (toolUses.length !== 1) {
    return `expected exactly one tool call, received ${toolUses.length}`;
  }

  const toolUse = toolUses[0];
  if (toolUse.name !== "Bash" || toolUse.input?.command !== expectedCommand) {
    return `unexpected tool call: ${toolUse.name || "unknown"} ${toolUse.input?.command || ""}`.trim();
  }

  const toolResults = events.flatMap((event) =>
    event?.type === "user" && Array.isArray(event.message?.content)
      ? event.message.content.filter((item) => item?.type === "tool_result")
      : [],
  );
  const matchingResult = toolResults.find((item) => item.tool_use_id === toolUse.id);
  if (!matchingResult || matchingResult.is_error) {
    return "the authorized Bash call did not complete with the expected preflight result";
  }
  if (expectedOutput !== null && matchingResult.content !== expectedOutput) {
    return "the authorized Bash call returned unexpected output";
  }

  const finalResult = events.find((event) => event?.type === "result");
  if (finalResult?.subtype !== "success" || finalResult.is_error) {
    return "Claude did not finish the permission smoke test successfully";
  }
  if (Array.isArray(finalResult.permission_denials) && finalResult.permission_denials.length > 0) {
    return `Claude reported ${finalResult.permission_denials.length} permission denial(s)`;
  }
  return null;
}

export function denialSmokeErrorFor(events, forbiddenCommand = FORBIDDEN_COMMAND) {
  const toolUses = events.flatMap((event) =>
    event?.type === "assistant" && Array.isArray(event.message?.content)
      ? event.message.content.filter((item) => item?.type === "tool_use")
      : [],
  );
  if (toolUses.length !== 1 || toolUses[0].name !== "Bash" || toolUses[0].input?.command !== forbiddenCommand) {
    return "Claude did not attempt exactly the forbidden Bash command";
  }

  const toolUse = toolUses[0];
  const finalResult = events.find((event) => event?.type === "result");
  const matchingDenial = Array.isArray(finalResult?.permission_denials)
    && finalResult.permission_denials.some((denial) =>
      denial?.tool_use_id === toolUse.id
      && denial?.tool_name === "Bash"
      && denial?.tool_input?.command === forbiddenCommand,
    );
  if (!matchingDenial) {
    return "the forbidden direct Codex command has no correlated permission denial";
  }
  return null;
}

export function reviewerToolsetErrorFor(events) {
  const init = events.find((event) => event?.type === "system" && event.subtype === "init");
  if (!init || !Array.isArray(init.tools)) return "reviewer smoke emitted no effective tool list";
  if (init.tools.includes("Bash")) return "reviewer effective tool list still contains Bash";
  for (const required of ["Read", "Glob", "Grep"]) {
    if (!init.tools.includes(required)) return `reviewer effective tool list is missing ${required}`;
  }
  return null;
}

function parseEvents(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function run() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const baseArgs = buildClaudeArgs({
    allowedTools: DEFAULT_ALLOWED_TOOLS.join(","),
    disallowedTools: DEFAULT_DISALLOWED_TOOLS.join(","),
  });
  const args = [
    ...baseArgs,
    "--no-session-persistence",
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  const invoke = (prompt) => spawnSync("claude", args, {
    cwd: repoRoot,
    encoding: "utf8",
    input: prompt,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000,
  });

  const allowedResult = invoke(
    `Run exactly this command once: ${EXPECTED_COMMAND}. Do not run any other tool. Return only its output.\n`,
  );
  if (allowedResult.error) throw allowedResult.error;
  if (allowedResult.status !== 0) {
    throw new Error(allowedResult.stderr.trim() || `claude exited with status ${allowedResult.status}`);
  }
  const allowedError = smokeErrorFor(parseEvents(allowedResult.stdout), EXPECTED_COMMAND, repoRoot);
  if (allowedError) throw new Error(allowedError);

  const denialArgs = buildClaudeArgs({
    allowedTools: [...DEFAULT_ALLOWED_TOOLS, "Bash(codex exec --help)"].join(","),
    disallowedTools: DEFAULT_DISALLOWED_TOOLS.join(","),
  });
  const deniedResult = spawnSync("claude", [
    ...denialArgs,
    "--no-session-persistence",
    "--output-format",
    "stream-json",
    "--verbose",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    input: `Run exactly this command once: ${FORBIDDEN_COMMAND}. Do not run any other tool.\n`,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000,
  });
  if (deniedResult.error) throw deniedResult.error;
  const denialError = denialSmokeErrorFor(parseEvents(deniedResult.stdout));
  if (denialError) throw new Error(denialError);

  const reviewerArgs = buildClaudeArgs({
    allowedTools: "Read,Glob,Grep,LS",
    disallowedTools: "Bash,Write,Edit,MultiEdit",
    settingSources: "",
  });
  const reviewerResult = spawnSync("claude", [
    ...reviewerArgs,
    "--tools",
    "Read,Glob,Grep,LS",
    "--safe-mode",
    "--model",
    "haiku",
    "--no-session-persistence",
    "--output-format",
    "stream-json",
    "--verbose",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    input: "Do not use tools. Return only OK.\n",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000,
  });
  if (reviewerResult.error) throw reviewerResult.error;
  const reviewerToolsetError = reviewerToolsetErrorFor(parseEvents(reviewerResult.stdout));
  if (reviewerToolsetError) throw new Error(reviewerToolsetError);
  console.log("Claude unattended Codex permission smoke test: OK");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    run();
  } catch (error) {
    console.error(`Claude unattended Codex permission smoke test: FAILED — ${error.message}`);
    process.exitCode = 1;
  }
}
