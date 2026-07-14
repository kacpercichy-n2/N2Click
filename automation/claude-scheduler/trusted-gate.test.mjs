import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureTrustedGate, trustedGateErrorFor } from "./trusted-gate.mjs";

test("detects a gate file changed after the worker phase", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trusted-gate-"));
  const relative = "scripts/review.sh";
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, relative), "trusted\n");
  const snapshot = captureTrustedGate(root, [relative]);

  fs.writeFileSync(path.join(root, relative), "worker-controlled\n");
  assert.equal(
    trustedGateErrorFor(root, snapshot),
    "trusted gate file changed during implementation: scripts/review.sh",
  );
});

test("accepts unchanged gate files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trusted-gate-"));
  fs.writeFileSync(path.join(root, "review.sh"), "trusted\n");
  const snapshot = captureTrustedGate(root, ["review.sh"]);
  assert.equal(trustedGateErrorFor(root, snapshot), null);
});
