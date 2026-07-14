import test from "node:test";
import assert from "node:assert/strict";
import { buildClaudeArgs } from "./claude-args.mjs";

test("unattended scheduler excludes user/local settings and denies explicit bypasses", () => {
  assert.deepEqual(buildClaudeArgs({
    allowedTools: "Read,Bash(git status:*)",
    disallowedTools: "Bash(codex:*)",
  }), [
    "--print",
    "--setting-sources",
    "project",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    "Read,Bash(git status:*)",
    "--disallowedTools",
    "Bash(codex:*)",
  ]);
});

test("explicit operator override retains the dangerous bypass mode", () => {
  assert.deepEqual(buildClaudeArgs({
    allowedTools: "Read",
    disallowedTools: "Bash(codex:*)",
    skipPermissions: true,
  }), [
    "--print",
    "--dangerously-skip-permissions",
  ]);
});

test("review phase can isolate all settings sources", () => {
  const args = buildClaudeArgs({
    allowedTools: "Read",
    disallowedTools: "Write",
    settingSources: "",
  });
  assert.deepEqual(args.slice(0, 3), ["--print", "--setting-sources", ""]);
});
