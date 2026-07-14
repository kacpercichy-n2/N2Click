import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLiveOutput, parseCacheFile, CACHE_FRESHNESS_MS } from "../lib/usage.mjs";

test("parseLiveOutput parses UTILIZATION|RESETS_AT", () => {
  const result = parseLiveOutput("75|2026-07-14T22:30:00Z");
  assert.deepEqual(result, {
    utilization: 75,
    resetsAt: "2026-07-14T22:30:00Z",
    source: "live",
  });
});

test("parseLiveOutput accepts missing reset as null", () => {
  assert.deepEqual(parseLiveOutput("42|"), {
    utilization: 42,
    resetsAt: null,
    source: "live",
  });
});

test("parseLiveOutput returns null for ERROR, empty and garbage", () => {
  assert.equal(parseLiveOutput("ERROR: no token"), null);
  assert.equal(parseLiveOutput(""), null);
  assert.equal(parseLiveOutput("   \n  "), null);
  assert.equal(parseLiveOutput("not-a-number|x"), null);
  assert.equal(parseLiveOutput(undefined), null);
});

test("parseCacheFile accepts a fresh cache and sets source cache", () => {
  const timestamp = 1_784_067_092;
  const nowMs = timestamp * 1000 + 60_000; // 1 minute old
  const text = [
    "UTILIZATION=81",
    "RESETS_AT=2026-07-14T22:30:00Z",
    `TIMESTAMP=${timestamp}`,
    "WEEKLY_UTILIZATION=38",
    "WEEKLY_RESETS_AT=2026-07-20T01:00:00Z",
  ].join("\n");
  assert.deepEqual(parseCacheFile(text, nowMs), {
    utilization: 81,
    resetsAt: "2026-07-14T22:30:00Z",
    source: "cache",
  });
});

test("parseCacheFile rejects a stale cache", () => {
  const timestamp = 1_784_067_092;
  const nowMs = timestamp * 1000 + CACHE_FRESHNESS_MS + 1; // just past threshold
  const text = `UTILIZATION=81\nRESETS_AT=2026-07-14T22:30:00Z\nTIMESTAMP=${timestamp}`;
  assert.equal(parseCacheFile(text, nowMs), null);
});

test("parseCacheFile returns null when keys are missing", () => {
  const nowMs = 1_784_067_152_000;
  assert.equal(parseCacheFile("RESETS_AT=2026-07-14T22:30:00Z", nowMs), null); // no UTILIZATION
  assert.equal(parseCacheFile("UTILIZATION=81", nowMs), null); // no TIMESTAMP
});

test("parseCacheFile ignores WEEKLY_ lines when reading utilization", () => {
  const timestamp = 1_784_067_092;
  const nowMs = timestamp * 1000 + 1000;
  const text = [
    "WEEKLY_UTILIZATION=99",
    "UTILIZATION=12",
    `TIMESTAMP=${timestamp}`,
  ].join("\n");
  const result = parseCacheFile(text, nowMs);
  assert.equal(result.utilization, 12);
});
