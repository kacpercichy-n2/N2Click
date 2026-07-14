import test from "node:test";
import assert from "node:assert/strict";
import {
  parseReviewerEnvelope,
  reviewerVerdictErrorFor,
  workResultErrorFor,
} from "./review-orchestration.mjs";

test("accepts a fresh ready implementation result", () => {
  assert.equal(workResultErrorFor({
    prompt: "019b.md",
    runId: "run-1",
    status: "ready",
    contextExpansions: [],
    focusedChecks: ["npx vitest run focused.test.ts"],
  }, { prompt: "019b.md", runId: "run-1" }), null);
});

test("rejects a stale or blocked implementation result", () => {
  assert.match(workResultErrorFor({
    prompt: "019b.md", runId: "old", status: "ready", contextExpansions: [], focusedChecks: [],
  }, { prompt: "019b.md", runId: "run-1" }), /runId mismatch/);
  assert.match(workResultErrorFor({
    prompt: "019b.md", runId: "run-1", status: "blocked", contextExpansions: [], focusedChecks: [],
  }, { prompt: "019b.md", runId: "run-1" }), /reported blocked/);
});

test("rejects malformed implementation evidence", () => {
  assert.match(workResultErrorFor({
    prompt: "019b.md",
    runId: "run-1",
    status: "ready",
    contextExpansions: [7],
    focusedChecks: [],
  }, { prompt: "019b.md", runId: "run-1" }), /string contextExpansions/);
  assert.match(workResultErrorFor({
    prompt: "019b.md",
    runId: "run-1",
    status: "ready",
    contextExpansions: [],
    focusedChecks: [],
  }, { prompt: "019b.md", runId: "run-1" }), /nonempty focusedChecks/);
});

test("accepts one conditional Codex request before evidence exists", () => {
  assert.equal(reviewerVerdictErrorFor({
    status: "codex-requested",
    blockers: [],
    codexRequest: "An undeclared persistence boundary changed.",
    contextExpansions: [],
    wiki: { status: "unchanged", reason: "Review is not final yet." },
  }, { codexPolicy: "conditional", codexAvailable: false }), null);
});

test("rejects repeated or non-conditional Codex requests", () => {
  const verdict = {
    status: "codex-requested", blockers: [], codexRequest: "Uncertainty remains.",
    contextExpansions: [],
    wiki: { status: "unchanged", reason: "Pending." },
  };
  assert.match(reviewerVerdictErrorFor(verdict, {
    codexPolicy: "required", codexAvailable: false,
  }), /only under a conditional/);
  assert.match(reviewerVerdictErrorFor(verdict, {
    codexPolicy: "conditional", codexAvailable: true,
  }), /already supplied/);
});

test("requires typed wiki fields and explicit Codex adjudication", () => {
  assert.match(reviewerVerdictErrorFor({
    status: "approve", blockers: [], contextExpansions: [], codexFindings: "LGTM",
    wiki: { status: "unchanged", reason: 7 },
  }, { codexPolicy: "required", codexAvailable: true }), /wiki decision/);
  assert.match(reviewerVerdictErrorFor({
    status: "approve", blockers: [], contextExpansions: [],
    wiki: { status: "unchanged", reason: "No docs changed." },
  }, { codexPolicy: "required", codexAvailable: true }), /adjudicate/);
});

test("rejects blockers attached to a conditional Codex request", () => {
  assert.match(reviewerVerdictErrorFor({
    status: "codex-requested",
    blockers: ["src/file.ts:1 concrete defect"],
    contextExpansions: [],
    codexRequest: "Need a second opinion.",
    wiki: { status: "unchanged", reason: "Pending." },
  }, { codexPolicy: "conditional", codexAvailable: false }), /cannot carry blockers/);
});

test("parses a Claude JSON envelope containing a reviewer verdict", () => {
  assert.deepEqual(parseReviewerEnvelope(JSON.stringify({
    type: "result",
    result: '```json\n{"status":"approve","blockers":[]}\n```',
  })), { status: "approve", blockers: [] });
  assert.deepEqual(parseReviewerEnvelope(JSON.stringify({
    type: "result",
    result: 'Review notes.\n\n```json\n{"status":"changes-required","blockers":["Fix the route guard."]}\n```',
  })), { status: "changes-required", blockers: ["Fix the route guard."] });
  assert.equal(parseReviewerEnvelope('{"result":"not json"}'), null);
});
