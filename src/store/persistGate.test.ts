// Focused tests for the pure retirement persist gate (persistGate.ts):
// touchesOnlyMirrored per-collection reference comparison, and the full
// shouldSkipLocalPersist gate (marker + Supabase env + health flag + collection
// scope). No React. localStorage + import.meta.env are stubbed for the duration.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyData, writeCloudRetirementMarker } from './storage';

// `import.meta.env` jest per-moduł i vitest wczytuje .env.local, więc na
// maszynie z prawdziwymi kluczami nie da się zasymulować trybu lokalnego przez
// stubowanie środowiska. Bramkę testujemy z jawnie sterowaną flagą konfiguracji;
// samo parsowanie env pokrywa src/supabase/config.test.ts.
const supabaseConfigured = vi.hoisted(() => ({ value: true }));
vi.mock('../supabase/config', () => ({
  isSupabaseConfigured: () => supabaseConfigured.value,
}));
import {
  setCloudMirrorHealthy,
  shouldSkipLocalPersist,
  touchesOnlyMirrored,
} from './persistGate';
import type { AppData } from '../types';

function withLocalStorage<T>(fn: () => T): T {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  const prev = (globalThis as { localStorage?: Storage }).localStorage;
  (globalThis as { localStorage?: Storage }).localStorage = stub;
  try {
    return fn();
  } finally {
    (globalThis as { localStorage?: Storage }).localStorage = prev;
  }
}

function configureSupabaseEnv(): void {
  supabaseConfigured.value = true;
}

afterEach(() => {
  supabaseConfigured.value = true;
  setCloudMirrorHealthy(false);
});

const base = (): AppData => emptyData();

describe('touchesOnlyMirrored', () => {
  it('is true when only mirrored collections change (by reference)', () => {
    const prev = base();
    const next: AppData = { ...prev, clients: [...prev.clients], workload: [...prev.workload] };
    expect(touchesOnlyMirrored(prev, next)).toBe(true);
  });

  it('is false when any non-mirrored collection or scalar changes', () => {
    const prev = base();
    expect(touchesOnlyMirrored(prev, { ...prev, statuses: [...prev.statuses] })).toBe(false);
    expect(touchesOnlyMirrored(prev, { ...prev, people: [...prev.people] })).toBe(false);
    expect(touchesOnlyMirrored(prev, { ...prev, savedFilters: [...prev.savedFilters] })).toBe(false);
    expect(touchesOnlyMirrored(prev, { ...prev, currentUserId: 'x' })).toBe(false);
    // lastFilters jest NON_MIRRORED (lokalne only) — zmiana samych filtrów nie
    // może zostać zaklasyfikowana jako „tylko lustrzane”.
    expect(touchesOnlyMirrored(prev, { ...prev, lastFilters: { ...prev.lastFilters } })).toBe(false);
  });
});

describe('shouldSkipLocalPersist', () => {
  it('skips only when retired + configured + healthy + mirrored-only', () => {
    withLocalStorage(() => {
      configureSupabaseEnv();
      writeCloudRetirementMarker({ enabled: true });
      setCloudMirrorHealthy(true);
      const prev = base();
      const next: AppData = { ...prev, workload: [...prev.workload] };
      expect(shouldSkipLocalPersist(prev, next)).toBe(true);
    });
  });

  it('never skips when the mirror is not healthy', () => {
    withLocalStorage(() => {
      configureSupabaseEnv();
      writeCloudRetirementMarker({ enabled: true });
      setCloudMirrorHealthy(false);
      const prev = base();
      expect(shouldSkipLocalPersist(prev, { ...prev, workload: [] })).toBe(false);
    });
  });

  it('never skips when the marker is disabled', () => {
    withLocalStorage(() => {
      configureSupabaseEnv();
      writeCloudRetirementMarker({ enabled: false });
      setCloudMirrorHealthy(true);
      const prev = base();
      expect(shouldSkipLocalPersist(prev, { ...prev, workload: [] })).toBe(false);
    });
  });

  it('never skips in local mode (env not configured) — stale marker ignored', () => {
    withLocalStorage(() => {
      supabaseConfigured.value = false;
      writeCloudRetirementMarker({ enabled: true });
      setCloudMirrorHealthy(true);
      const prev = base();
      expect(shouldSkipLocalPersist(prev, { ...prev, workload: [] })).toBe(false);
    });
  });

  it('never skips when a non-mirrored collection changed', () => {
    withLocalStorage(() => {
      configureSupabaseEnv();
      writeCloudRetirementMarker({ enabled: true });
      setCloudMirrorHealthy(true);
      const prev = base();
      expect(shouldSkipLocalPersist(prev, { ...prev, statuses: [...prev.statuses] })).toBe(false);
    });
  });

  it('never skips a lastFilters-only transition (its only persistence is local)', () => {
    withLocalStorage(() => {
      configureSupabaseEnv();
      writeCloudRetirementMarker({ enabled: true });
      setCloudMirrorHealthy(true);
      const prev = base();
      const next: AppData = { ...prev, lastFilters: { tasks: {
        criteria: {
          paid: 'all', clientId: '', companyId: '', projectId: '', statusId: '', personId: '',
          priority: '', workCategoryId: '', from: '', to: '',
        },
        personIds: ['x'], departmentId: '', serviceTypeId: '', planning: '',
      } } };
      expect(shouldSkipLocalPersist(prev, next)).toBe(false);
    });
  });
});
