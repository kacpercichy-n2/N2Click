import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runResultErrorFor } from "./run-result.mjs";

function fixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "n2hub-run-result-"));
  fs.mkdirSync(path.join(repoRoot, "handoffs"));
  fs.mkdirSync(path.join(repoRoot, "reviews"));
  const resultFile = path.join(repoRoot, "handoffs/RUN-RESULT.json");
  const artifact = "reviews/current-codex-review.md";
  const metadata = "reviews/current-codex-review.json";
  fs.writeFileSync(path.join(repoRoot, artifact), "LGTM\n");
  fs.writeFileSync(path.join(repoRoot, metadata), JSON.stringify({
    runId: "run-123",
    diffHash: "hash-123",
    reviewArtifact: artifact,
  }));
  const result = {
    prompt: "019a.md",
    runId: "run-123",
    status: "approved",
    reviewerVerdict: "approve",
    codexReview: {
      policy: "required", requested: true, status: "passed", artifact, metadata, diffHash: "hash-123",
    },
    contextExpansions: [],
    wiki: { status: "unchanged", reason: "No boundary changed." },
  };
  fs.writeFileSync(resultFile, JSON.stringify(result));
  return { repoRoot, resultFile, result };
}

test("accepts a fresh approved result with required Codex evidence", () => {
  const { repoRoot, resultFile } = fixture();
  assert.equal(runResultErrorFor({
    resultFile,
    repoRoot,
    prompt: "019a.md",
    runId: "run-123",
    codexPolicy: "required",
    startedAt: new Date(Date.now() - 1_000),
    currentDiffHash: "hash-123",
  }), null);
});

test("rejects a non-approving reviewer verdict", () => {
  const { repoRoot, resultFile, result } = fixture();
  result.reviewerVerdict = "changes-required";
  fs.writeFileSync(resultFile, JSON.stringify(result));
  assert.equal(runResultErrorFor({
    resultFile, repoRoot, prompt: "019a.md", runId: "run-123",
    codexPolicy: "required", startedAt: new Date(Date.now() - 1_000),
    currentDiffHash: "hash-123",
  }), "reviewer did not approve the run");
});

test("rejects stale or missing required Codex evidence", () => {
  const { repoRoot, resultFile } = fixture();
  assert.equal(runResultErrorFor({
    resultFile, repoRoot, prompt: "019a.md", runId: "run-123",
    codexPolicy: "required", startedAt: new Date(Date.now() + 10_000),
    currentDiffHash: "hash-123",
  }), "Codex review artifact is stale");
});

test("rejects code changed after the Codex review", () => {
  const { repoRoot, resultFile } = fixture();
  assert.equal(runResultErrorFor({
    resultFile, repoRoot, prompt: "019a.md", runId: "run-123",
    codexPolicy: "required", startedAt: new Date(Date.now() - 1_000),
    currentDiffHash: "different-hash",
  }), "code changed after the Codex review");
});

test("rejects an empty Codex review artifact", () => {
  const { repoRoot, resultFile, result } = fixture();
  fs.writeFileSync(path.join(repoRoot, result.codexReview.artifact), "  \n");
  assert.equal(runResultErrorFor({
    resultFile, repoRoot, prompt: "019a.md", runId: "run-123",
    codexPolicy: "required", startedAt: new Date(Date.now() - 1_000),
    currentDiffHash: "hash-123",
  }), "Codex review artifact is empty");
});

test("rejects a requested conditional review that was skipped", () => {
  const { repoRoot, resultFile, result } = fixture();
  result.codexReview = {
    policy: "conditional",
    requested: true,
    status: "skipped",
    reason: "Codex invocation failed.",
  };
  fs.writeFileSync(resultFile, JSON.stringify(result));
  assert.equal(runResultErrorFor({
    resultFile, repoRoot, prompt: "019a.md", runId: "run-123",
    codexPolicy: "conditional", startedAt: new Date(Date.now() - 1_000),
    currentDiffHash: "hash-123",
  }), "requested conditional Codex review did not pass");
});

test("accepts a reasoned conditional skip when review was not requested", () => {
  const { repoRoot, resultFile, result } = fixture();
  result.codexReview = {
    policy: "conditional",
    requested: false,
    status: "skipped",
    reason: "No boundary expansion or reviewer uncertainty.",
  };
  fs.writeFileSync(resultFile, JSON.stringify(result));
  assert.equal(runResultErrorFor({
    resultFile, repoRoot, prompt: "019a.md", runId: "run-123",
    codexPolicy: "conditional", startedAt: new Date(Date.now() - 1_000),
    currentDiffHash: "hash-123",
  }), null);
});

test("rejects a required review that is marked not requested", () => {
  const { repoRoot, resultFile, result } = fixture();
  result.codexReview.requested = false;
  fs.writeFileSync(resultFile, JSON.stringify(result));
  assert.equal(runResultErrorFor({
    resultFile, repoRoot, prompt: "019a.md", runId: "run-123",
    codexPolicy: "required", startedAt: new Date(Date.now() - 1_000),
    currentDiffHash: "hash-123",
  }), "required Codex review must be requested");
});
