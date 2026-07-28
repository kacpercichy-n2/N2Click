// Shared save-status state machine + unsaved-changes guard.
//
// Persistence in this app is localStorage (a useEffect in AppStore saves after
// every action). It is NO LONGER treated as fire-and-forget: the hook reflects
// the real write outcome. "Zapisywanie…" is still a purely visual minimum of
// 350 ms after a save dispatch, then flips to "Zapisano ✓" for 2 s, then clears
// — but a failed write (`persistFailed`) durably overrides that theater with an
// 'error' state ("Nie zapisano") that only clears when a later write succeeds.
// The hook also registers a `beforeunload` prompt while `dirty` is true, and
// feeds each open form's dirtiness into the shared tab-conflict registry so an
// external same-browser tab write can tell a clean tab from a dirty one.
import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { setDirtyFlag, clearDirtyFlag } from './dirtyRegistry';

export type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

const SAVING_MS = 350;
const SAVED_MS = 2000;

/** Etykieta ostatniego udanego zapisu („20:51”). Czysta — testowalna w node. */
export function formatSavedAt(now: Date): string {
  return format(now, 'HH:mm');
}

export function useSaveStatus(
  dirty: boolean,
  persistFailed = false,
): {
  status: SaveState;
  /** Godzina OSTATNIEGO udanego zapisu; `null` dopóki żaden nie zaszedł. */
  savedAtLabel: string | null;
  markSaved: () => void;
} {
  // A transient override ('saving' | 'saved') sits on top of the rest state
  // ('dirty' | 'clean') for the duration of the post-save feedback window.
  const [transient, setTransient] = useState<'saving' | 'saved' | null>(null);
  const savingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Znacznik „Zapisano HH:mm” — stawiany w momencie przejścia na 'saved' i już
  // NIGDY nie czyszczony (wskaźnik po pierwszym zapisie przestaje znikać).
  const [savedAtLabel, setSavedAtLabel] = useState<string | null>(null);
  // Nieudany zapis NIGDY nie może wyprodukować „Zapisano”: `markSaved` biegnie
  // optymistycznie przy dispatchu, więc etykietę stawiamy dopiero po 350 ms i
  // tylko wtedy, gdy zapis do pamięci NAPRAWDĘ nie zgłosił błędu.
  const persistFailedRef = useRef(persistFailed);
  useEffect(() => {
    persistFailedRef.current = persistFailed;
  }, [persistFailed]);

  const clearTimers = useCallback(() => {
    if (savingTimer.current !== null) clearTimeout(savingTimer.current);
    if (savedTimer.current !== null) clearTimeout(savedTimer.current);
    savingTimer.current = null;
    savedTimer.current = null;
  }, []);

  const markSaved = useCallback(() => {
    clearTimers();
    setTransient('saving');
    savingTimer.current = setTimeout(() => {
      setTransient('saved');
      if (!persistFailedRef.current) setSavedAtLabel(formatSavedAt(new Date()));
      savedTimer.current = setTimeout(() => setTransient(null), SAVED_MS);
    }, SAVING_MS);
  }, [clearTimers]);

  // Clean up any pending timers on unmount.
  useEffect(() => clearTimers, [clearTimers]);

  // Register this form's dirtiness in the shared tab-conflict registry, keyed
  // by a stable per-form object identity. Forgotten entirely on unmount so a
  // closed form can never read as dirty.
  const dirtyKey = useRef<object>({});
  useEffect(() => {
    const key = dirtyKey.current;
    setDirtyFlag(key, dirty);
    return () => clearDirtyFlag(key);
  }, [dirty]);

  // Native unsaved-changes prompt on tab close / reload while dirty. (The
  // saveError beforeunload prompt lives in PersistenceBanner — single source —
  // so this stays keyed on `dirty` alone.)
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // A failed write is a DURABLE override: it beats the transient theater and
  // only clears when a later write succeeds (persistFailed goes false).
  const status: SaveState = persistFailed
    ? 'error'
    : transient ?? (dirty ? 'dirty' : 'clean');
  return { status, savedAtLabel, markSaved };
}
