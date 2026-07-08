/**
 * Device-local UI preferences (sidebar collapsed state, …).
 *
 * Deliberately separate from `src/store/storage.ts`: UI prefs are per-device
 * chrome, not shared app data, so they must NOT ride along when `storage.ts`
 * becomes an API. This is the ONLY other module allowed to touch localStorage.
 * Both functions are try/catch-safe (private browsing / quota / SSR) and never
 * throw, mirroring the storage.ts contract.
 */

const UI_PREFS_KEY = 'n2hub.ui.v1';

export type UiPrefs = {
  sidebarCollapsed: boolean;
};

const DEFAULT_PREFS: UiPrefs = {
  sidebarCollapsed: false,
};

export function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<UiPrefs> | null;
    return {
      sidebarCollapsed:
        typeof parsed?.sidebarCollapsed === 'boolean'
          ? parsed.sidebarCollapsed
          : DEFAULT_PREFS.sidebarCollapsed,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveUiPrefs(prefs: UiPrefs): void {
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore — persistence is best-effort for device-local prefs.
  }
}
