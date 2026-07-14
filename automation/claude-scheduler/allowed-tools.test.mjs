import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_DISALLOWED_TOOLS,
  REVIEWER_ALLOWED_TOOLS,
} from "./allowed-tools.mjs";

test("uses current Claude Code Bash prefix matcher syntax", () => {
  const bashRules = DEFAULT_ALLOWED_TOOLS.filter((rule) => rule.startsWith("Bash("));

  assert.equal(bashRules.some((rule) => rule.includes(" *")), false);
  assert.equal(bashRules.includes("Bash(npx vitest:*)"), true);
});

test("does not authorize the environment-assignment Codex invocation", () => {
  assert.equal(
    DEFAULT_ALLOWED_TOOLS.some((rule) => rule.includes("CODEX_REVIEW_RUN_ID=")),
    false,
  );
  assert.equal(DEFAULT_ALLOWED_TOOLS.includes("Bash(codex exec:*)"), false);
});

test("contains no commas that would corrupt the combined CLI argument", () => {
  assert.equal(
    [...DEFAULT_ALLOWED_TOOLS, ...DEFAULT_DISALLOWED_TOOLS].some((rule) => rule.includes(",")),
    false,
  );
});

test("narrows executable runners and explicitly denies Codex bypasses", () => {
  assert.equal(DEFAULT_ALLOWED_TOOLS.includes("Bash(npm:*)"), false);
  assert.equal(DEFAULT_ALLOWED_TOOLS.includes("Bash(npx:*)"), false);
  assert.equal(DEFAULT_ALLOWED_TOOLS.includes("Bash(node:*)"), false);
  assert.equal(DEFAULT_ALLOWED_TOOLS.includes("Bash(npx vitest:*)"), true);
  assert.equal(DEFAULT_ALLOWED_TOOLS.includes("Bash(npm run test:scheduler:*)"), true);
  assert.equal(DEFAULT_ALLOWED_TOOLS.includes("Bash(npm run typecheck:*)"), true);
  assert.equal(DEFAULT_ALLOWED_TOOLS.includes("Bash(node scripts/run-browser-regression.mjs:*)"), true);
  assert.equal(DEFAULT_ALLOWED_TOOLS.includes("Bash(bash scripts/codex-review.sh:*)"), false);
  assert.equal(DEFAULT_ALLOWED_TOOLS.includes("Bash(find:*)"), false);
  assert.equal(DEFAULT_ALLOWED_TOOLS.includes("Bash(rg:*)"), false);
  assert.equal(DEFAULT_DISALLOWED_TOOLS.includes("Bash(codex:*)"), true);
  assert.equal(DEFAULT_DISALLOWED_TOOLS.includes("Bash(node -e:*)"), true);
  assert.equal(DEFAULT_DISALLOWED_TOOLS.includes("Bash(find:*)"), true);
});

test("developer escalation returns to the orchestrator instead of invoking Codex", () => {
  const developer = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../.claude/agents/developer.md"),
    "utf8",
  );
  assert.doesNotMatch(developer, /codex-implement\.sh/);
  assert.match(developer, /report the blocker to the scheduler-owned phase/i);
});

test("final reviewer permissions are read-only and cannot launch verification", () => {
  assert.equal(REVIEWER_ALLOWED_TOOLS.includes("Write"), false);
  assert.equal(REVIEWER_ALLOWED_TOOLS.includes("Edit"), false);
  assert.equal(REVIEWER_ALLOWED_TOOLS.some((rule) => rule.startsWith("Bash(")), false);
  assert.equal(REVIEWER_ALLOWED_TOOLS.some((rule) => /npm|npx|node|codex/.test(rule)), false);
  assert.deepEqual(REVIEWER_ALLOWED_TOOLS, ["Read", "Glob", "Grep", "LS"]);
});
