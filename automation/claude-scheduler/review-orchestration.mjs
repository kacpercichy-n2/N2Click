import fs from "node:fs";

export function workResultErrorFor(result, { prompt, runId }) {
  if (!result || typeof result !== "object") return "missing implementation phase result";
  if (result.prompt !== prompt) return "implementation result prompt mismatch";
  if (result.runId !== runId) return "implementation result runId mismatch";
  if (!["ready", "blocked"].includes(result.status)) return "implementation result status must be ready or blocked";
  if (result.status !== "ready") return "implementation phase reported blocked";
  if (!Array.isArray(result.contextExpansions)
    || !result.contextExpansions.every((item) => typeof item === "string")) {
    return "implementation result needs a string contextExpansions array";
  }
  if (!Array.isArray(result.focusedChecks)
    || result.focusedChecks.length === 0
    || !result.focusedChecks.every((item) => typeof item === "string" && item.trim())) {
    return "ready implementation result needs nonempty focusedChecks evidence";
  }
  return null;
}

export function reviewerVerdictErrorFor(verdict, { codexPolicy, codexAvailable }) {
  if (!verdict || typeof verdict !== "object") return "reviewer did not return a JSON verdict";
  if (!["approve", "changes-required", "codex-requested"].includes(verdict.status)) {
    return "reviewer status must be approve, changes-required or codex-requested";
  }
  if (!Array.isArray(verdict.blockers) || !verdict.blockers.every((item) => typeof item === "string")) {
    return "reviewer verdict needs a string blockers array";
  }
  if (!Array.isArray(verdict.contextExpansions)
    || !verdict.contextExpansions.every((item) => typeof item === "string" && item.trim())) {
    return "reviewer verdict needs a string contextExpansions array";
  }
  if (!verdict.wiki || !["updated", "unchanged"].includes(verdict.wiki.status)
    || typeof verdict.wiki.reason !== "string" || !verdict.wiki.reason.trim()) {
    return "reviewer verdict needs one reasoned wiki decision";
  }
  if (verdict.status === "codex-requested" && codexPolicy !== "conditional") {
    return "Codex may be requested only under a conditional policy";
  }
  if (verdict.status === "codex-requested" && codexAvailable) {
    return "reviewer requested Codex after evidence was already supplied";
  }
  if (verdict.status === "codex-requested" && verdict.blockers.length > 0) {
    return "conditional Codex request cannot carry blockers; use changes-required";
  }
  if (verdict.status === "codex-requested"
    && (typeof verdict.codexRequest !== "string" || !verdict.codexRequest.trim())) {
    return "conditional Codex request needs a specific reason";
  }
  if (codexAvailable && (typeof verdict.codexFindings !== "string" || !verdict.codexFindings.trim())) {
    return "reviewer must adjudicate supplied Codex findings";
  }
  if (verdict.status === "approve" && verdict.blockers.length > 0) {
    return "reviewer cannot approve with blockers";
  }
  if (verdict.status === "changes-required" && verdict.blockers.length === 0) {
    return "changes-required verdict needs at least one blocker";
  }
  return null;
}

export function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function parseReviewerEnvelope(output) {
  let envelope;
  try {
    envelope = JSON.parse(output);
  } catch {
    return null;
  }
  const raw = typeof envelope.result === "string" ? envelope.result.trim() : "";
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
  const json = fenced ? fenced[1] : raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
