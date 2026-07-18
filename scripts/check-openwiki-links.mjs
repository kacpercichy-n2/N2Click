#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredWikiFiles = [
  "openwiki/quickstart.md",
  "openwiki/n2hub/INDEX.md",
  "openwiki/n2hub/state-and-persistence.md",
  "openwiki/n2hub/cloud-database.md",
  "openwiki/n2hub/scheduling-and-calendar.md",
  "openwiki/n2hub/ui-navigation-and-onboarding.md",
  "openwiki/n2hub/testing-and-automation.md",
];

const errors = [];
for (const relativeFile of requiredWikiFiles) {
  const absoluteFile = path.join(repoRoot, relativeFile);
  if (!fs.existsSync(absoluteFile)) {
    errors.push(`missing required wiki file: ${relativeFile}`);
    continue;
  }
  validateMarkdownLinks(relativeFile, absoluteFile);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Validated ${requiredWikiFiles.length} wiki files.`);

function validateMarkdownLinks(relativeFile, absoluteFile) {
  const body = fs.readFileSync(absoluteFile, "utf8");
  for (const match of body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, "").split("#")[0];
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(absoluteFile), target);
    if (!fs.existsSync(resolved)) errors.push(`${relativeFile}: broken link ${match[1]}`);
  }
}
