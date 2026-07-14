import test from "node:test";
import assert from "node:assert/strict";
import { initializeRunLifecycle, shouldBlockRunOnShutdown } from "./run-lifecycle.mjs";

test("invalidates the previous result before awaiting usage telemetry", async () => {
  const events = [];
  const usage = await initializeRunLifecycle({
    dryRun: false,
    writeRunning: () => events.push("running"),
    readUsage: async () => {
      events.push("usage-start");
      await Promise.resolve();
      events.push("usage-end");
      return { percent: 12 };
    },
  });

  assert.deepEqual(events, ["running", "usage-start", "usage-end"]);
  assert.equal(usage.percent, 12);
});

test("shutdown blocks an active run until its commit succeeds", () => {
  assert.equal(shouldBlockRunOnShutdown(null), false);
  assert.equal(shouldBlockRunOnShutdown({ approvalPublished: false, commitSucceeded: false }), true);
  assert.equal(shouldBlockRunOnShutdown({ approvalPublished: true, commitSucceeded: false }), true);
  assert.equal(shouldBlockRunOnShutdown({ approvalPublished: true, commitSucceeded: true }), false);
});
