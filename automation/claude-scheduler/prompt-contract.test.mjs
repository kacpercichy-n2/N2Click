import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promptContractErrorFor, promptMetadata } from "./prompt-contract.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n2hub-prompt-contract-"));
  fs.mkdirSync(path.join(root, "openwiki/n2hub"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "openwiki/n2hub/state.md"), "# State\n");
  fs.writeFileSync(path.join(root, "src/app.ts"), "export {};\n");
  const prompt = `# Test task

## Risk and routing
- Risk: high
- Route: architect → developer → reviewer
- Codex review: required

## Wiki context
- \`openwiki/n2hub/state.md\`

## Expected touchpoints
- \`src/app.ts\`

## Invariants
- Preserve current behavior.

## Scope
- Make the bounded change.

## Out of scope
- No adjacent refactors.

## Acceptance
- Focused behavior is covered.

## Verification
- Worker: focused test.
`;
  return { root, prompt };
}

test("accepts a complete prompt with existing context and touchpoints", () => {
  const { root, prompt } = fixture();
  assert.equal(promptContractErrorFor(prompt, root), null);
  assert.deepEqual(promptMetadata(prompt), {
    risk: "high",
    route: "architect → developer → reviewer",
    codexReview: "required",
    codexRationale: null,
  });
});

test("rejects a missing required section", () => {
  const { root, prompt } = fixture();
  assert.equal(
    promptContractErrorFor(prompt.replace("## Invariants", "## Notes"), root),
    "missing a ## Invariants section",
  );
});

test("rejects an absent touchpoint", () => {
  const { root, prompt } = fixture();
  assert.equal(
    promptContractErrorFor(prompt.replace("src/app.ts", "src/missing.ts"), root),
    "touchpoint does not exist: src/missing.ts",
  );
});

test("requires the independent review for high-risk prompts", () => {
  const { root, prompt } = fixture();
  assert.equal(
    promptContractErrorFor(prompt.replace("Codex review: required", "Codex review: conditional"), root),
    "high-risk prompts must require Codex review",
  );
});

test("rejects unsupported routes and unexplained skips", () => {
  const { root, prompt } = fixture();
  assert.equal(
    promptContractErrorFor(prompt.replace("architect → developer → reviewer", "banana → deploy"), root),
    "unsupported route: banana → deploy",
  );
  const lowRisk = prompt
    .replace("Risk: high", "Risk: low")
    .replace("Codex review: required", "Codex review: skip");
  assert.equal(promptContractErrorFor(lowRisk, root), "skip Codex review must include a rationale after —");
});

test("rejects absolute, traversal and symlink escape touchpoints", () => {
  const { root, prompt } = fixture();
  assert.equal(
    promptContractErrorFor(prompt.replace("src/app.ts", "/etc/passwd"), root),
    "touchpoint must be repository-relative: /etc/passwd",
  );
  assert.equal(
    promptContractErrorFor(prompt.replace("src/app.ts", "../../etc/passwd"), root),
    "touchpoint escapes the repository: ../../etc/passwd",
  );

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "n2hub-outside-"));
  fs.writeFileSync(path.join(outside, "secret.ts"), "export {};\n");
  fs.symlinkSync(path.join(outside, "secret.ts"), path.join(root, "src/link.ts"));
  assert.equal(
    promptContractErrorFor(prompt.replace("src/app.ts", "src/link.ts"), root),
    "touchpoint resolves outside the repository: src/link.ts",
  );
});

test("accepts an explicit planned file but rejects a broad directory", () => {
  const { root, prompt } = fixture();
  assert.equal(
    promptContractErrorFor(prompt.replace("src/app.ts", "new: src/planned.ts"), root),
    null,
  );
  assert.equal(
    promptContractErrorFor(prompt.replace("src/app.ts", "new: ROOT-NOTE.md"), root),
    null,
  );
  assert.equal(
    promptContractErrorFor(prompt.replace("src/app.ts", "src"), root),
    "touchpoint must name a file or file glob: src",
  );
});
