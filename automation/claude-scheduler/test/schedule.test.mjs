import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNextRunAt, chainDecision } from "../lib/schedule.mjs";

test("computeNextRunAt adds exactly 60s to a UTC ISO reset", () => {
  const reset = "2026-07-14T22:30:00Z";
  const now = Date.parse("2026-07-14T20:00:00Z");
  assert.equal(computeNextRunAt(reset, now), Date.parse(reset) + 60_000);
});

test("computeNextRunAt returns null for null or garbage input", () => {
  const now = Date.parse("2026-07-14T20:00:00Z");
  assert.equal(computeNextRunAt(null, now), null);
  assert.equal(computeNextRunAt(undefined, now), null);
  assert.equal(computeNextRunAt("not-a-date", now), null);
});

test("computeNextRunAt returns now when the reset already passed", () => {
  const reset = "2026-07-14T22:30:00Z";
  const now = Date.parse("2026-07-15T05:00:00Z"); // well past reset + 60s
  assert.equal(computeNextRunAt(reset, now), now);
});

test("chainDecision waits at exactly 50 and chains below it", () => {
  assert.equal(chainDecision({ utilization: 49 }), "chain");
  assert.equal(chainDecision({ utilization: 50 }), "wait");
  assert.equal(chainDecision({ utilization: 51 }), "wait");
});

test("chainDecision retries usage when unavailable", () => {
  assert.equal(chainDecision(null), "retry-usage");
  assert.equal(chainDecision(undefined), "retry-usage");
  assert.equal(chainDecision({ utilization: NaN }), "retry-usage");
});
