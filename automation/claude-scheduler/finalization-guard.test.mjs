import test from "node:test";
import assert from "node:assert/strict";
import {
  finalizeWithFailureGuard,
  runNonFatalTelemetry,
  runNonFatalTelemetryAsync,
} from "./finalization-guard.mjs";

test("records blocked state when archive or commit finalization throws", () => {
  let blockedReason = null;
  const error = finalizeWithFailureGuard(
    () => { throw new Error("commit failed"); },
    (failure) => { blockedReason = failure.message; },
  );
  assert.equal(error.message, "commit failed");
  assert.equal(blockedReason, "commit failed");
});

test("does not call failure handler after successful finalization", () => {
  let failed = false;
  assert.equal(finalizeWithFailureGuard(() => {}, () => { failed = true; }), null);
  assert.equal(failed, false);
});

test("treats completed-state telemetry failure as non-fatal after commit", () => {
  let warned = null;
  const error = runNonFatalTelemetry(
    () => {
      throw new Error("telemetry disk full");
    },
    (caught) => {
      warned = caught.message;
    },
  );

  assert.equal(error.message, "telemetry disk full");
  assert.equal(warned, "telemetry disk full");
});

test("treats async metrics failure as non-fatal after commit", async () => {
  let warned = null;
  const value = await runNonFatalTelemetryAsync(
    async () => {
      throw new Error("usage helper failed");
    },
    (caught) => {
      warned = caught.message;
    },
  );

  assert.equal(value, null);
  assert.equal(warned, "usage helper failed");
});
