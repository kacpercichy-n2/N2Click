import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { finalizePrompt } from "./scheduler-files.mjs";

test("restores an active prompt and unstages when commit fails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n2hub-finalize-"));
  const promptDir = path.join(root, "prompts");
  const archiveDir = path.join(root, "archive");
  fs.mkdirSync(promptDir);
  const promptFile = path.join(promptDir, "001.md");
  fs.writeFileSync(promptFile, "# Prompt\n");
  let unstaged = false;

  assert.throws(() => finalizePrompt({
    promptFile,
    archiveDir,
    commit: () => { throw new Error("commit failed"); },
    unstage: () => { unstaged = true; },
  }), /commit failed/);
  assert.equal(fs.existsSync(promptFile), true);
  assert.equal(fs.existsSync(path.join(archiveDir, "001.md")), false);
  assert.equal(unstaged, true);
});

test("does not move an active prompt over an archive collision", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n2hub-finalize-"));
  const promptDir = path.join(root, "prompts");
  const archiveDir = path.join(root, "archive");
  fs.mkdirSync(promptDir);
  fs.mkdirSync(archiveDir);
  const promptFile = path.join(promptDir, "001.md");
  fs.writeFileSync(promptFile, "# Active\n");
  fs.writeFileSync(path.join(archiveDir, "001.md"), "# Archived\n");

  assert.throws(() => finalizePrompt({ promptFile, archiveDir, commit() {}, unstage() {} }), /already exists/);
  assert.equal(fs.readFileSync(promptFile, "utf8"), "# Active\n");
});
