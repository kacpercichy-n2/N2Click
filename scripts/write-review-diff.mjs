#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReviewDiff } from "../automation/claude-scheduler/review-diff.mjs";

const [diffFile, filesFile, baseCommit = ""] = process.argv.slice(2);
if (!diffFile || !filesFile) {
  console.error("Usage: node scripts/write-review-diff.mjs <diff-file> <files-file> [base-commit]");
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = buildReviewDiff(repoRoot, baseCommit || null);
fs.writeFileSync(diffFile, result.diff);
fs.writeFileSync(filesFile, `${result.files.join("\n")}${result.files.length ? "\n" : ""}`);
process.stdout.write(result.hash);
