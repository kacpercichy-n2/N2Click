// Per-page dismissal of first-time context hints. The dismissal is keyed by the
// tutorial module id a route maps to (see OnboardingRoot's routeModule), so
// pressing "Nie teraz" on one page never suppresses another page's first-time
// hint. This state is intentionally in-memory only (session-scoped); the durable
// "Nie pokazuj ponownie" choice still persists per module via uiPrefs.

/** Add `moduleId` to the in-memory dismissed set (returns a new set). */
export function dismissHintFor(
  dismissed: ReadonlySet<string>,
  moduleId: string,
): Set<string> {
  const next = new Set(dismissed);
  next.add(moduleId);
  return next;
}

/** True when this page's hint has been dismissed in-memory for this session. */
export function isHintDismissed(
  dismissed: ReadonlySet<string>,
  moduleId: string | undefined,
): boolean {
  return moduleId !== undefined && dismissed.has(moduleId);
}
