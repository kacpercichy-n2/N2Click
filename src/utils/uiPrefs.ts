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
const ONBOARDING_LOGIN_KEY = 'n2hub.onboarding.login.v1';

export const ONBOARDING_VERSION = 1;

export type TutorialModuleId =
  | 'shell'
  | 'home'
  | 'projects'
  | 'kanban'
  | 'timeline'
  | 'tasks'
  | 'calendar-basics'
  | 'calendar-advanced'
  | 'workload'
  | 'people'
  | 'admin';

export type TutorialModuleProgress = {
  status: 'not-started' | 'in-progress' | 'completed' | 'dismissed';
  lastStep: number;
  completedVersion: number | null;
};

export type UserOnboardingProgress = {
  introVersionSeen: number;
  autoTourHandled: boolean;
  modules: Partial<Record<TutorialModuleId, TutorialModuleProgress>>;
};

export type UiPrefs = {
  sidebarCollapsed: boolean;
  onboardingByUser: Record<string, UserOnboardingProgress>;
  // Device-local sidebar menu order (nav paths). Absent = default order; see
  // src/components/navItems.ts `orderNavPaths`.
  navOrder?: string[];
};

const DEFAULT_PREFS: UiPrefs = {
  sidebarCollapsed: false,
  onboardingByUser: {},
};

const DEFAULT_USER_PROGRESS: UserOnboardingProgress = {
  introVersionSeen: 0,
  autoTourHandled: false,
  modules: {},
};

function readModuleProgress(value: unknown): TutorialModuleProgress | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Partial<TutorialModuleProgress>;
  const status = raw.status;
  if (
    status !== 'not-started' &&
    status !== 'in-progress' &&
    status !== 'completed' &&
    status !== 'dismissed'
  ) {
    return undefined;
  }
  return {
    status,
    lastStep: Number.isInteger(raw.lastStep) && (raw.lastStep ?? 0) >= 0 ? raw.lastStep ?? 0 : 0,
    completedVersion:
      typeof raw.completedVersion === 'number' && Number.isFinite(raw.completedVersion)
        ? raw.completedVersion
        : null,
  };
}

function readUserProgress(value: unknown): UserOnboardingProgress {
  if (!value || typeof value !== 'object') return { ...DEFAULT_USER_PROGRESS };
  const raw = value as Partial<UserOnboardingProgress>;
  const modules: UserOnboardingProgress['modules'] = {};
  if (raw.modules && typeof raw.modules === 'object') {
    for (const [key, module] of Object.entries(raw.modules)) {
      const parsed = readModuleProgress(module);
      if (parsed) modules[key as TutorialModuleId] = parsed;
    }
  }
  return {
    introVersionSeen:
      typeof raw.introVersionSeen === 'number' && Number.isFinite(raw.introVersionSeen)
        ? raw.introVersionSeen
        : 0,
    autoTourHandled: raw.autoTourHandled === true,
    modules,
  };
}

export function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<UiPrefs> | null;
    const prefs: UiPrefs = {
      sidebarCollapsed:
        typeof parsed?.sidebarCollapsed === 'boolean'
          ? parsed.sidebarCollapsed
          : DEFAULT_PREFS.sidebarCollapsed,
      onboardingByUser:
        parsed?.onboardingByUser && typeof parsed.onboardingByUser === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.onboardingByUser).map(([userId, value]) => [
                userId,
                readUserProgress(value),
              ]),
            )
          : {},
    };
    // navOrder: keep the key only when the raw value is an array; drop any
    // non-string entries. A missing/malformed value omits the key entirely.
    if (Array.isArray(parsed?.navOrder)) {
      prefs.navOrder = parsed.navOrder.filter((p): p is string => typeof p === 'string');
    }
    return prefs;
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

/** Merge a device-local UI preference without erasing another UI feature's state. */
export function updateUiPrefs(
  patch: Partial<UiPrefs> | ((current: UiPrefs) => UiPrefs),
): UiPrefs {
  const current = loadUiPrefs();
  const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
  saveUiPrefs(next);
  return next;
}

export function onboardingForUser(prefs: UiPrefs, userId: string): UserOnboardingProgress {
  return prefs.onboardingByUser[userId] ?? { ...DEFAULT_USER_PROGRESS };
}

export function updateOnboardingForUser(
  userId: string,
  update: (current: UserOnboardingProgress) => UserOnboardingProgress,
): UiPrefs {
  return updateUiPrefs((prefs) => ({
    ...prefs,
    onboardingByUser: {
      ...prefs.onboardingByUser,
      [userId]: update(onboardingForUser(prefs, userId)),
    },
  }));
}

/** Marks a real login so the first-run intro is not triggered by test/sample seeding. */
export function markOnboardingLogin(userId: string): void {
  try {
    sessionStorage.setItem(ONBOARDING_LOGIN_KEY, userId);
  } catch {
    // A session-only marker is a convenience. The help centre remains available.
  }
}

export function hasPendingOnboardingLogin(userId: string): boolean {
  try {
    return sessionStorage.getItem(ONBOARDING_LOGIN_KEY) === userId;
  } catch {
    return false;
  }
}

export function clearPendingOnboardingLogin(): void {
  try {
    sessionStorage.removeItem(ONBOARDING_LOGIN_KEY);
  } catch {
    // Ignore unavailable session storage.
  }
}
