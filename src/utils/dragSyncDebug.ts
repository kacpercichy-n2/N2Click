// Diagnostyka „gumowego” cofania przeciągnięć w trybie chmury (2026-11-06).
// Włączenie: dopisz `?dragdebug=1` do adresu (zapamiętuje się w localStorage),
// wyłączenie: `?dragdebug=0`. Bez flagi każda funkcja jest pustym wyjściem,
// więc w normalnym użyciu nie ma żadnych logów ani kosztu.
import type { WorkloadEntry } from '../types';

const KEY = 'n2hub.debug.dragSync';

function readFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const param = new URLSearchParams(window.location.search).get('dragdebug');
    if (param === '1') window.localStorage.setItem(KEY, '1');
    if (param === '0') window.localStorage.removeItem(KEY);
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

const enabled = readFlag();

export function dragSyncDebugEnabled(): boolean {
  return enabled;
}

export function dragSyncLog(event: string, detail?: unknown): void {
  if (!enabled) return;
  const t = Math.round(performance.now());
  if (detail === undefined) console.info(`[drag-sync] ${t} ${event}`);
  else console.info(`[drag-sync] ${t} ${event}`, detail);
}

type Geo = { date: string; start: number; hours: number };

function geo(w: WorkloadEntry): Geo {
  return { date: w.date, start: w.startMinutes, hours: w.plannedHours };
}

/** Zmiany geometrii bloków między dwoma stanami (id → przed/po). */
export function workloadGeometryDiff(
  before: readonly WorkloadEntry[],
  after: readonly WorkloadEntry[],
): Array<{ id: string; before: Geo | null; after: Geo | null }> {
  if (!enabled || before === after) return [];
  const prev = new Map(before.map((w) => [w.id, w]));
  const out: Array<{ id: string; before: Geo | null; after: Geo | null }> = [];
  const seen = new Set<string>();
  for (const w of after) {
    seen.add(w.id);
    const p = prev.get(w.id);
    if (p === w) continue;
    if (
      !p ||
      p.date !== w.date ||
      p.startMinutes !== w.startMinutes ||
      p.plannedHours !== w.plannedHours
    ) {
      out.push({ id: w.id, before: p ? geo(p) : null, after: geo(w) });
    }
  }
  for (const p of before) if (!seen.has(p.id)) out.push({ id: p.id, before: geo(p), after: null });
  return out;
}
