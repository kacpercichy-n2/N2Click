#!/usr/bin/env node
// Zero-dependency local monitor for the prompt scheduler.
//
// Read-only. Binds to 127.0.0.1 only and never mutates scheduler state. It is
// an internal operator tool, not a security boundary.
//
// Start:  node automation/claude-scheduler/monitor.mjs
//         SCHEDULER_MONITOR_PORT=4600 node automation/claude-scheduler/monitor.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { readStatus } from "./lib/state.mjs";
import { readRuns } from "./lib/runlog.mjs";
import { parseCacheFields, CACHE_FRESHNESS_MS } from "./lib/usage.mjs";

const schedulerDir = path.dirname(fileURLToPath(import.meta.url));
const stateDir = path.join(schedulerDir, "state");
const statusPath = path.join(stateDir, "status.json");
const lockPath = path.join(stateDir, "scheduler.lock");
const runsPath = path.join(stateDir, "runs.jsonl");
const cachePath = process.env.CLAUDE_AUTO_USAGE_CACHE
  || path.join(os.homedir(), ".claude", ".statusline-usage-cache");

const HOST = "127.0.0.1";
const PORT = Number(process.env.SCHEDULER_MONITOR_PORT) || 4599;
const ALIVE_WINDOW_MS = 90_000;

const server = http.createServer((req, res) => {
  try {
    if (req.url === "/status.json") {
      sendJson(res, 200, buildStatus());
      return;
    }
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(PAGE);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Monitor: http://${HOST}:${PORT}/`);
});

function buildStatus() {
  const status = readStatus(statusPath); // null when missing/malformed
  const alive = isSchedulerAlive(status);
  const recentRuns = readRecentRuns(20);
  const usage = readCacheUsage();
  return {
    schedulerAlive: alive,
    status: status ?? null,
    recentRuns,
    usage,
    monitorTime: new Date().toISOString(),
  };
}

function isSchedulerAlive(status) {
  const pid = readLockPid();
  if (pid === null || !pidAlive(pid)) return false;
  if (!status || typeof status.updatedAt !== "string") return false;
  const updated = Date.parse(status.updatedAt);
  if (Number.isNaN(updated)) return false;
  return Date.now() - updated < ALIVE_WINDOW_MS;
}

function readLockPid() {
  try {
    const pid = Number(fs.readFileSync(lockPath, "utf8").trim());
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function readRecentRuns(count) {
  try {
    const entries = readRuns(fs.readFileSync(runsPath, "utf8"));
    return entries.slice(-count).reverse();
  } catch {
    return [];
  }
}

function readCacheUsage() {
  let fields = null;
  try {
    fields = parseCacheFields(fs.readFileSync(cachePath, "utf8"));
  } catch {
    fields = null;
  }
  if (!fields) return null;
  const fresh = fields.timestamp !== null
    && Date.now() - fields.timestamp * 1000 <= CACHE_FRESHNESS_MS;
  return {
    utilization: fields.utilization,
    resetsAt: fields.resetsAt,
    timestamp: fields.timestamp,
    fresh,
  };
}

function sendJson(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

const PAGE = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harmonogram promptów</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: #14161a; color: #e7e9ee; }
  main { max-width: 880px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .05em; color: #9aa2af; margin: 24px 0 8px; }
  .card { background: #1c1f25; border: 1px solid #2b2f37; border-radius: 10px; padding: 14px 16px; }
  .row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; }
  .row span:first-child { color: #9aa2af; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-weight: 600; font-size: 13px; }
  .ok { background: #16351f; color: #6ee7a0; }
  .bad { background: #3a1a1e; color: #f4a0a8; }
  .warn { background: #3a3218; color: #f4d58d; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { padding: 6px 0; border-top: 1px solid #24272e; }
  li:first-child { border-top: 0; }
  code { font-family: ui-monospace, monospace; color: #c8ccd4; }
  .muted { color: #6b7280; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; margin-right: 6px; }
  .dot.ok { background: #6ee7a0; }
  .dot.bad { background: #f4a0a8; }
</style>
</head>
<body>
<main>
  <h1>Harmonogram promptów</h1>
  <div class="card">
    <div class="row"><span>Harmonogram</span><span id="alive">—</span></div>
    <div class="row"><span>Faza</span><span id="phase">—</span></div>
    <div class="row"><span>Bieżący prompt</span><span id="current">—</span></div>
    <div class="row"><span>Następne uruchomienie</span><span id="next">—</span></div>
    <div class="row"><span>Ostatnia aktualizacja</span><span id="updated">—</span></div>
    <div class="row"><span>Błąd</span><span id="error">—</span></div>
  </div>

  <h2>Zużycie</h2>
  <div class="card"><div class="row"><span>Poziom</span><span id="usage">—</span></div></div>

  <h2>Kolejka</h2>
  <div class="card"><ul id="queue"><li class="muted">—</li></ul></div>

  <h2>Ostatnie uruchomienia</h2>
  <div class="card"><ul id="runs"><li class="muted">—</li></ul></div>

  <p class="muted" id="foot">Odświeżanie co 10 s.</p>
</main>
<script>
  const tz = { timeZone: "Europe/Warsaw", dateStyle: "short", timeStyle: "medium" };
  const fmt = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("pl-PL", tz).format(d);
  };
  const setText = (id, value) => { document.getElementById(id).textContent = value; };

  async function refresh() {
    let data;
    try {
      data = await (await fetch("/status.json", { cache: "no-store" })).json();
    } catch {
      setText("alive", "błąd połączenia");
      return;
    }
    const s = data.status || {};

    const alive = document.getElementById("alive");
    alive.innerHTML = data.schedulerAlive
      ? '<span class="pill ok">działa</span>'
      : '<span class="pill bad">zatrzymany</span>';

    setText("phase", s.phase || "—");
    setText("current", s.currentPrompt || "—");
    setText("next", fmt(s.nextRunAt));
    setText("updated", fmt(s.updatedAt));
    setText("error", s.lastError || "—");

    const u = data.usage;
    setText("usage", u ? u.utilization + "% " + (u.fresh ? "(świeże)" : "(nieaktualne)") : "brak danych");

    const queue = document.getElementById("queue");
    const items = (s.queue || []);
    queue.innerHTML = items.length
      ? items.map((q) => "<li><code>" + q + "</code></li>").join("")
      : '<li class="muted">pusta</li>';

    const runs = document.getElementById("runs");
    const list = data.recentRuns || [];
    runs.innerHTML = list.length
      ? list.map((r) => {
          const ok = r.outcome === "success";
          const dot = '<span class="dot ' + (ok ? "ok" : "bad") + '"></span>';
          const commit = r.commit ? " <code>" + r.commit + "</code>" : "";
          return "<li>" + dot + "<code>" + (r.prompt || r.runId) + "</code> — "
            + (ok ? "sukces" : "awaria (kod " + r.exitCode + ")")
            + commit + " <span class=\\"muted\\">" + fmt(r.startedAt) + "</span></li>";
        }).join("")
      : '<li class="muted">brak</li>';

    setText("foot", "Odświeżono: " + fmt(data.monitorTime));
  }

  refresh();
  setInterval(refresh, 10000);
</script>
</body>
</html>`;
