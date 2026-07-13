#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promptContractErrorFor } from "../automation/claude-scheduler/prompt-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredWikiFiles = [
  "openwiki/quickstart.md",
  "openwiki/n2hub/INDEX.md",
  "openwiki/n2hub/state-and-persistence.md",
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

const promptDir = path.join(repoRoot, "automation/claude-scheduler/prompts");
const promptFiles = fs
  .readdirSync(promptDir)
  .filter((file) => file.endsWith(".md"))
  .sort();
for (const promptFile of promptFiles) {
  const relativeFile = path.join("automation/claude-scheduler/prompts", promptFile);
  const body = fs.readFileSync(path.join(repoRoot, relativeFile), "utf8");
  const error = promptContractErrorFor(body, repoRoot);
  if (error) errors.push(`${relativeFile}: ${error}`);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Validated ${requiredWikiFiles.length} wiki files and ${promptFiles.length} active prompt contracts.`);

function validateMarkdownLinks(relativeFile, absoluteFile) {
  const body = fs.readFileSync(absoluteFile, "utf8");
  for (const match of body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, "").split("#")[0];
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(absoluteFile), target);
    if (!fs.existsSync(resolved)) errors.push(`${relativeFile}: broken link ${match[1]}`);
  }
}
