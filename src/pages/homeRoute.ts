// Single landing/home destination for the app. „Panel" (`/dashboard`) is now
// the only home: the former per-role „Moja praca" (`/my-work`) surface was
// merged into it (Zasobnik + Alerty are now Panel tiles), so every role — and
// every legacy `/my-work` deep link — lands here. Pure, no React/store, so the
// routing constant stays unit-testable (mirrors the dashboardPanels.ts pattern).

/** The one and only home path. Used by the `/` and catch-all redirects, the
 *  login navigation and the onboarding `@home` route token. */
export const HOME_PATH = '/dashboard';

/** Legacy path kept alive as a redirect so old links/bookmarks don't break. */
export const LEGACY_MY_WORK_PATH = '/my-work';

/**
 * Where a given app path should resolve at the router. The legacy `/my-work`
 * path folds into `HOME_PATH`; every other path returns `null` (no redirect).
 */
export function redirectTargetForPath(path: string): string | null {
  return path === LEGACY_MY_WORK_PATH ? HOME_PATH : null;
}
