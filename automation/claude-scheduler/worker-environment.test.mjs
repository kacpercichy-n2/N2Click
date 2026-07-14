import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkerEnvironment } from "./worker-environment.mjs";

test("worker environment prepends shims without removing shared tooling", () => {
  const result = buildWorkerEnvironment({
    PATH: "/usr/bin:/home/user/.local/bin:/usr/local/bin",
    OPENAI_API_KEY: "secret",
  }, {
    isolatedBin: "/tmp/worker-bin",
    isolatedCodexHome: "/tmp/no-codex",
  });
  assert.equal(result.PATH, "/tmp/worker-bin:/usr/bin:/home/user/.local/bin:/usr/local/bin");
  assert.equal(result.CODEX_HOME, "/tmp/no-codex");
  assert.equal(result.OPENAI_API_KEY, "");
  assert.equal(result.NPM_CONFIG_OFFLINE, "true");
});
