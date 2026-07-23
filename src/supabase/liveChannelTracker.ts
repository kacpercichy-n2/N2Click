// Histereza flagi `live` kanału Realtime. Czysta i testowalna (bez Reacta,
// bez klienta Supabase, z wstrzykiwanym zegarem).
//
// Powód: `RealtimeChannel.subscribe` woła zwrotkę statusu na KAŻDEJ zmianie
// stanu socketu (SUBSCRIBED → CHANNEL_ERROR/TIMED_OUT → SUBSCRIBED) — także
// przy przejściowym flapie (drop + natychmiastowy rejoin), który zdarza się w
// normalnej pracy (np. co ~30 s przy heartbeacie / re-joinie publikacji).
// Gdyby każdy taki drop natychmiast zbijał `live` na false, baner stale-hint
// („Dane mogą być nieaktualne…”) migałby cyklicznie mimo działającego live.
//
// Zasada: SUBSCRIBED podnosi `live` natychmiast; utrata statusu NIE zbija
// `live` od razu — dopiero gdy przerwa trwa nieprzerwanie ≥ graceMs (realna
// utrata kanału). Rejoin w oknie grace = ciągłość, zero migotania banera.
// Utrata już-martwego kanału (nigdy nie było SUBSCRIBED, np. offline od startu)
// nie planuje nic — `live` zostaje false i baner-fallback działa od razu.

export type ChannelStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED' | string;

export interface LiveTrackerOptions {
  /** Ile ms nieprzerwanej utraty statusu traktujemy jako realną utratę kanału. */
  graceMs: number;
  /** Raportuje zmianę flagi (wołane TYLKO przy faktycznej zmianie wartości). */
  setLive: (live: boolean) => void;
  /** Wstrzykiwany planer (setTimeout w produkcji, fałszywy zegar w testach). */
  schedule: (fn: () => void, ms: number) => unknown;
  /** Wstrzykiwane anulowanie (clearTimeout w produkcji). */
  cancel: (handle: unknown) => void;
}

export interface LiveTracker {
  /** Konsumuje status z `channel.subscribe(...)`. */
  onStatus: (status: ChannelStatus) => void;
  /** Sprzątanie przy odmontowaniu / zmianie użytkownika: kasuje timer, zbija live. */
  dispose: () => void;
}

export function createLiveTracker(opts: LiveTrackerOptions): LiveTracker {
  const { graceMs, setLive, schedule, cancel } = opts;
  let live = false;
  let dropHandle: unknown = null;

  const clearDrop = (): void => {
    if (dropHandle !== null) {
      cancel(dropHandle);
      dropHandle = null;
    }
  };

  const report = (next: boolean): void => {
    if (live === next) return;
    live = next;
    setLive(next);
  };

  return {
    onStatus(status: ChannelStatus): void {
      if (status === 'SUBSCRIBED') {
        clearDrop();
        report(true);
        return;
      }
      // Utrata statusu przy martwym kanale (live już false): baner-fallback ma
      // działać natychmiast — nic nie planujemy.
      if (!live || dropHandle !== null) return;
      dropHandle = schedule(() => {
        dropHandle = null;
        report(false);
      }, graceMs);
    },
    dispose(): void {
      clearDrop();
      report(false);
    },
  };
}
