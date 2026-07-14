import fs from "node:fs";
import path from "node:path";

export function runResultErrorFor({ resultFile, repoRoot, prompt, runId, codexPolicy, startedAt, currentDiffHash }) {
  if (!fs.existsSync(resultFile)) return `missing required run result: ${path.relative(repoRoot, resultFile)}`;

  let result;
  try {
    result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  } catch {
    return "run result is not valid JSON";
  }

  if (result.prompt !== prompt) return `run result prompt mismatch: expected ${prompt}`;
  if (result.runId !== runId) return "run result runId does not match the current scheduler run";
  if (result.status !== "approved" || result.reviewerVerdict !== "approve") {
    return "reviewer did not approve the run";
  }
  if (!Array.isArray(result.contextExpansions)) return "run result must contain a contextExpansions array";
  if (!result.wiki || !["updated", "unchanged"].includes(result.wiki.status) || !result.wiki.reason?.trim()) {
    return "run result must contain one reasoned wiki updated/unchanged decision";
  }

  const codex = result.codexReview;
  if (!codex || codex.policy !== codexPolicy) return "run result Codex policy mismatch";
  if (typeof codex.requested !== "boolean") return "run result must record whether Codex review was requested";
  if (codexPolicy === "required" && !codex.requested) return "required Codex review must be requested";
  if (codexPolicy === "skip" && codex.requested) return "skip policy cannot request Codex review";
  if (codex.status === "passed" && !codex.requested) return "passed Codex review must be marked requested";
  if (codexPolicy === "conditional" && codex.requested && codex.status !== "passed") {
    return "requested conditional Codex review did not pass";
  }
  if (codexPolicy === "required" && codex.status !== "passed") {
    return "required Codex review did not pass";
  }
  if (codex.status === "passed") {
    const artifactError = codexArtifactError(codex, repoRoot, runId, startedAt, currentDiffHash);
    if (artifactError) return artifactError;
  } else if (["conditional", "skip"].includes(codexPolicy)) {
    if (codex.status !== "skipped" || !codex.reason?.trim()) {
      return "skipped Codex review must contain a reason";
    }
  } else {
    return "invalid Codex review status";
  }

  return null;
}

function codexArtifactError(codex, repoRoot, runId, startedAt, currentDiffHash) {
  const { artifact, metadata } = codex;
  if (typeof artifact !== "string" || !/^reviews\/[\w.-]+-codex-review\.md$/.test(artifact)) {
    return "passed Codex review must name its reviews/*-codex-review.md artifact";
  }
  if (typeof metadata !== "string" || !/^reviews\/[\w.-]+-codex-review\.json$/.test(metadata)) {
    return "passed Codex review must name its reviews/*-codex-review.json metadata";
  }
  const resolved = path.resolve(repoRoot, artifact);
  const resolvedMetadata = path.resolve(repoRoot, metadata);
  if (!isWithin(repoRoot, resolved) || !fs.existsSync(resolved)) return "Codex review artifact is missing";
  if (!isWithin(repoRoot, resolvedMetadata) || !fs.existsSync(resolvedMetadata)) return "Codex review metadata is missing";
  const modifiedAt = fs.statSync(resolved).mtimeMs;
  if (modifiedAt + 2_000 < startedAt.getTime()) return "Codex review artifact is stale";
  if (!fs.readFileSync(resolved, "utf8").trim()) return "Codex review artifact is empty";
  let reviewMetadata;
  try {
    reviewMetadata = JSON.parse(fs.readFileSync(resolvedMetadata, "utf8"));
  } catch {
    return "Codex review metadata is invalid";
  }
  if (reviewMetadata.runId !== runId) return "Codex review metadata runId mismatch";
  if (reviewMetadata.reviewArtifact !== artifact) return "Codex review metadata artifact mismatch";
  if (reviewMetadata.diffHash !== codex.diffHash) return "Codex review diff hash mismatch";
  if (reviewMetadata.diffHash !== currentDiffHash) return "code changed after the Codex review";
  return null;
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
