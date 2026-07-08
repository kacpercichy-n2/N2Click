// Shared save-status state machine + unsaved-changes guard.
//
// Persistence in this app is synchronous localStorage (a useEffect in AppStore
// saves after every action), so "Zapisywanie…" is a purely visual minimum of
// 350 ms after a save dispatch, then flips to "Zapisano ✓" for 2 s, then clears.
// The hook also registers a `beforeunload` prompt while `dirty` is true.
import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'clean' | 'dirty' | 'saving' | 'saved';

const SAVING_MS = 350;
const SAVED_MS = 2000;

export function useSaveStatus(dirty: boolean): {
  status: SaveState;
  markSaved: () => void;
} {
  // A transient override ('saving' | 'saved') sits on top of the rest state
  // ('dirty' | 'clean') for the duration of the post-save feedback window.
  const [transient, setTransient] = useState<'saving' | 'saved' | null>(null);
  const savingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      savedTimer.current = setTimeout(() => setTransient(null), SAVED_MS);
    }, SAVING_MS);
  }, [clearTimers]);

  // Clean up any pending timers on unmount.
  useEffect(() => clearTimers, [clearTimers]);

  // Native unsaved-changes prompt on tab close / reload while dirty.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const status: SaveState = transient ?? (dirty ? 'dirty' : 'clean');
  return { status, markSaved };
}
