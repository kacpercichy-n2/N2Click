// Usage source parsing for the prompt scheduler.
//
// Live source: `swift ~/.claude/fetch-claude-usage.swift` prints
// `UTILIZATION|RESETS_AT_ISO` on exit 0, or `ERROR:...` on exit 1.
// Cache fallback: `~/.claude/.statusline-usage-cache` with `KEY=value` lines.
//
// The parse functions are pure so tests need no processes or real files.

import fs from "node:fs";
import { spawn } from "node:child_process";

export const CACHE_FRESHNESS_MS = 600_000; // 10 minutes

// Parse the stdout of the live usage helper.
// Returns { utilization, resetsAt: string|null, source: 'live' } or null.
export function parseLiveOutput(stdout) {
  if (typeof stdout !== "string") return null;
  const line = stdout.trim().split("\n").find((value) => value.trim());
  if (!line || line.startsWith("ERROR")) return null;
  const [utilizationRaw, resetsRaw = ""] = line.trim().split("|");
  const utilization = Number(utilizationRaw);
  if (!Number.isFinite(utilization)) return null;
  return { utilization, resetsAt: parseResetsAt(resetsRaw), source: "live" };
}

// Parse the raw fields of the statusline usage cache file.
// Returns { utilization, resetsAt: string|null, timestamp: number|null } or null.
export function parseCacheFields(text) {
  if (typeof text !== "string") return null;
  const fields = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("WEEKLY_")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    fields[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  const utilization = Number(fields.UTILIZATION);
  if (!Number.isFinite(utilization)) return null;
  const timestampRaw = Number(fields.TIMESTAMP);
  const timestamp = Number.isFinite(timestampRaw) ? timestampRaw : null;
  return { utilization, resetsAt: parseResetsAt(fields.RESETS_AT), timestamp };
}

// Parse the cache file and accept it only when it is fresh (<= 10 min old).
// Returns { utilization, resetsAt, source: 'cache' } or null.
export function parseCacheFile(text, nowMs) {
  const fields = parseCacheFields(text);
  if (!fields || fields.timestamp === null) return null;
  if (nowMs - fields.timestamp * 1000 > CACHE_FRESHNESS_MS) return null;
  return { utilization: fields.utilization, resetsAt: fields.resetsAt, source: "cache" };
}

function parseResetsAt(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : value;
}

// Runtime: fetch usage live, then fall back to a fresh cache file.
// Returns a usage object (with fetchedAt) or null when unavailable.
export async function getUsage({ usageHelperPath, cachePath, nowMs = Date.now() } = {}) {
  const live = await fetchLiveUsage(usageHelperPath);
  if (live) return { ...live, fetchedAt: new Date().toISOString() };
  const cached = readCacheUsage(cachePath, nowMs);
  if (cached) return { ...cached, fetchedAt: new Date().toISOString() };
  return null;
}

export function readCacheUsage(cachePath, nowMs = Date.now()) {
  if (!cachePath || !fs.existsSync(cachePath)) return null;
  try {
    return parseCacheFile(fs.readFileSync(cachePath, "utf8"), nowMs);
  } catch {
    return null;
  }
}

function fetchLiveUsage(usageHelperPath) {
  return new Promise((resolve) => {
    if (!usageHelperPath || !fs.existsSync(usageHelperPath)) {
      resolve(null);
      return;
    }
    const child = spawn("swift", [usageHelperPath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 ? parseLiveOutput(stdout) : null));
  });
}
