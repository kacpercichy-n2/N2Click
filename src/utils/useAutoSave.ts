// Debounce'owany auto-zapis formularzy (klienci / projekty / zadania).
//
// Kontrakt: gdy `enabled` (edycja istniejącej encji + uprawnienia), draft jest
// `dirty` i `valid` (te same warunki, które przechodzi reduktor — patrz
// commandValidation.ts), po `delayMs` ciszy wywołuje `save()`. Zapis jest
// optymistyczny: reduktor aktualizuje stan natychmiast, lustro chmury pcha w
// tle. Niepoprawny draft NIGDY nie jest zapisywany — czeka, aż użytkownik go
// naprawi (walidacja inline pokazuje dlaczego).
//
// `signature` to serializacja draftu: każda zmiana restartuje odliczanie, więc
// zapis pada dopiero po pauzie w pisaniu, nie per klawisz.
import { useEffect, useRef } from 'react';

export const AUTO_SAVE_DELAY_MS = 900;

export function useAutoSave({
  enabled,
  dirty,
  valid,
  signature,
  save,
  delayMs = AUTO_SAVE_DELAY_MS,
}: {
  enabled: boolean;
  dirty: boolean;
  valid: boolean;
  signature: string;
  save: () => void;
  delayMs?: number;
}): void {
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!enabled || !dirty || !valid) return;
    const timer = setTimeout(() => saveRef.current(), delayMs);
    return () => clearTimeout(timer);
    // signature w zależnościach restartuje debounce przy każdej zmianie draftu.
  }, [enabled, dirty, valid, signature, delayMs]);
}
