import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendRun, readRuns, consecutiveCrashCount } from "../lib/runlog.mjs";

test("appendRun and readRuns round trip", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runlog-"));
  const file = path.join(dir, "runs.jsonl");
  const a = { runId: "a", prompt: "001.md", outcome: "success" };
  const b = { runId: "b", prompt: "002.md", outcome: "crash" };
  appendRun(file, a);
  appendRun(file, b);
  const entries = readRuns(fs.readFileSync(file, "utf8"));
  assert.deepEqual(entries, [a, b]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("readRuns skips malformed lines without throwing", () => {
  const text = [
    JSON.stringify({ prompt: "001.md", outcome: "success" }),
    "not json",
    "",
    "{ broken",
    JSON.stringify({ prompt: "002.md", outcome: "crash" }),
  ].join("\n");
  const entries = readRuns(text);
  assert.equal(entries.length, 2);
  assert.equal(entries[1].prompt, "002.md");
});

test("consecutiveCrashCount is zero for an unseen prompt", () => {
  const entries = [{ prompt: "001.md", outcome: "crash" }];
  assert.equal(consecutiveCrashCount(entries, "999.md"), 0);
});

test("consecutiveCrashCount counts trailing crashes", () => {
  const entries = [
    { prompt: "001.md", outcome: "crash" },
    { prompt: "001.md", outcome: "crash" },
    { prompt: "001.md", outcome: "crash" },
  ];
  assert.equal(consecutiveCrashCount(entries, "001.md"), 3);
});

test("consecutiveCrashCount resets after an interleaved success", () => {
  const entries = [
    { prompt: "001.md", outcome: "crash" },
    { prompt: "001.md", outcome: "success" },
    { prompt: "001.md", outcome: "crash" },
  ];
  assert.equal(consecutiveCrashCount(entries, "001.md"), 1);
});

test("consecutiveCrashCount ignores other prompts", () => {
  const entries = [
    { prompt: "001.md", outcome: "crash" },
    { prompt: "002.md", outcome: "success" },
    { prompt: "001.md", outcome: "crash" },
    { prompt: "002.md", outcome: "crash" },
  ];
  assert.equal(consecutiveCrashCount(entries, "001.md"), 2);
});
