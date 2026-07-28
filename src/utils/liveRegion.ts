// Wspólny kanał ogłoszeń dla czytników ekranu. Czysta logika, ZERO Reacta i
// ZERO DOM-u (środowisko `node` w vitest.config.ts) — cienką warstwę dwóch
// trwałych węzłów `.sr-only` trzyma `src/components/LiveRegionHost.tsx`.
//
// Wzorzec jak `dirtyRegistry.ts`: singleton modułowy, bez kontekstu Reacta i
// bez hooka. Komponent importuje `announce` i woła je w efekcie.
//
// Model: DWA niezależne kanały (polite / assertive), a w każdym DOKŁADNIE JEDEN
// najnowszy komunikat. Ogłoszenie tego samego `(id, text, tone)` co bieżąca
// zawartość kanału jest NO-OP-em: zwraca `false`, nie rusza `seq` i zachowuje
// TĘ SAMĄ referencję snapshotu (styl inwariantu 6), więc auto-zapis co ~900 ms
// nie ponawia „Zapisano 20:51” w tej samej minucie i nie budzi subskrybentów.
// Ten sam `id` z NOWYM tekstem podmienia treść kanału zamiast dokładać wpis.

export type LiveTone = 'polite' | 'assertive';

/** Ogłoszenie: `id` nazywa ŹRÓDŁO (np. `save:task-modal`), nie pojedynczy tekst. */
export interface LiveMessage {
  id: string;
  text: string;
  tone: LiveTone;
}

/** Bieżąca zawartość jednego kanału. `seq` rośnie tylko przy realnej zmianie. */
export interface LiveEntry {
  id: string;
  text: string;
  seq: number;
}

export interface LiveSnapshot {
  polite: LiveEntry | null;
  assertive: LiveEntry | null;
}

export interface LiveAnnouncer {
  /** `false` = zdeduplikowany no-op (snapshot i subskrybenci nietknięci). */
  announce(message: LiveMessage): boolean;
  /** Referencyjnie STABILNY snapshot — wymóg `useSyncExternalStore`. */
  snapshot(): LiveSnapshot;
  subscribe(listener: () => void): () => void;
}

const EMPTY: LiveSnapshot = { polite: null, assertive: null };

export function createLiveAnnouncer(): LiveAnnouncer {
  // JEDNO pole trzymane między wywołaniami: `snapshot()` musi zwracać tę samą
  // referencję dopóki nic się nie zmieniło, inaczej React zapętla się na
  // „getSnapshot should be cached”.
  let current: LiveSnapshot = EMPTY;
  let seq = 0;
  const listeners = new Set<() => void>();

  const announce = (message: LiveMessage): boolean => {
    // Pusty tekst nie jest ogłoszeniem — nie ma czego przeczytać, a wyczyszczenie
    // kanału i tak niczego nie komunikuje.
    if (message.text === '') return false;
    const existing = current[message.tone];
    if (existing !== null && existing.id === message.id && existing.text === message.text) {
      return false;
    }
    seq += 1;
    const entry: LiveEntry = { id: message.id, text: message.text, seq };
    current =
      message.tone === 'polite'
        ? { polite: entry, assertive: current.assertive }
        : { polite: current.polite, assertive: entry };
    for (const listener of listeners) listener();
    return true;
  };

  return {
    announce,
    snapshot: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Jedna instancja na aplikację (host montuje się RAZ w `App.tsx`). */
export const liveAnnouncer: LiveAnnouncer = createLiveAnnouncer();

/** Skrót dla komponentów: `announce({ id, text, tone })` w efekcie. */
export const announce = liveAnnouncer.announce;
