// Single persistence module. Wraps localStorage so it can be swapped for an API later.
import type { AppData } from '../types';

const STORAGE_KEY = 'n2click.data.v1';
export const DATA_VERSION = 1;

export function emptyData(): AppData {
  return {
    version: DATA_VERSION,
    tasks: [],
    people: [],
    assignments: [],
    workload: [],
    sampleBannerDismissed: false,
  };
}

function isAppData(value: unknown): value is AppData {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.tasks) &&
    Array.isArray(v.people) &&
    Array.isArray(v.assignments) &&
    Array.isArray(v.workload)
  );
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed: unknown = JSON.parse(raw);
    if (!isAppData(parsed)) return emptyData();
    // Simple version reconciliation: fill in any missing fields with defaults.
    return {
      ...emptyData(),
      ...parsed,
      version: DATA_VERSION,
    };
  } catch {
    return emptyData();
  }
}

export function saveData(data: AppData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore write failures (e.g. private mode / quota). Non-fatal for an alpha.
  }
}

export function clearData(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
