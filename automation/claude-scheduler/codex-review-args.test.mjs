import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const script = path.join(repoRoot, "scripts", "codex-review.sh");

test("Codex review CLI exposes the scheduler run-id contract", () => {
  const result = spawnSync("bash", [script, "--help"], { encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /--run-id <id>/);
  assert.match(result.stdout, /--check/);
  assert.match(result.stdout, /--focus <reason>/);
});

test("Codex review preflight accepts a safe run ID without invoking Codex", () => {
  const fakeBin = mkdtempSync(path.join(tmpdir(), "codex-review-test-"));
  try {
    writeFileSync(path.join(fakeBin, "codex"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
    const result = spawnSync(
      "bash",
      [script, "--run-id", "scheduler-run_123", "--check"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
      },
    );

    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "Codex review preflight OK.");
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("Codex review rejects an option token as the run ID", () => {
  const result = spawnSync("bash", [script, "--run-id", "--check"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /run ID must start/);
});

test("Codex review rejects a base commit in preflight mode", () => {
  const result = spawnSync("bash", [script, "HEAD", "--check"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot be combined with a base commit/);
});

test("Codex review requires a nonempty conditional focus", () => {
  const result = spawnSync("bash", [script, "--focus"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--focus requires a value/);
});
