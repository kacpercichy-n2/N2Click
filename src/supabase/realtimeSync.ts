// Czyste decyzje synchronizacji na żywo (Supabase Realtime), testowalne w node —
// wzorzec opQueue.ts / mirrorGate.ts / hydrationOutcome.ts. CloudSyncProvider jest
// tylko cienkim adapterem: cała logika (które tabele nasłuchujemy, mapowanie
// statusu kanału na `live`, maszyna debounce/coalesce z limitem oraz predykat
// baneru „nieaktualne dane”) żyje TU, aby vitest nie wymagał Reacta, jsdom ani
// prawdziwych timerów.
//
// GRANICA: zdarzenie postgres_changes NIE niesie tożsamości klienta-nadawcy, więc
// nie da się filtrować własnych ech per-zdarzenie. Zamiast łatać wiersze do stanu,
// harmonogram odpala PONOWNY odczyt całego snapshotu przez istniejącą ścieżkę
// loadPlannerSnapshot -> planHydrationOutcome -> MERGE_CLOUD_ENTITIES (ta ścieżka
// już posiada walidację, inwariant 6, filtrowanie kaskadowe i tłumaczenie map id).
// Tłumienie ech = (a) odroczenie odświeżenia gdy własne operacje są w kolejce /
// drenażu lub trwa hydracja, (b) koalescencja debounce, (c) idempotentne scalenie
// tej samej treści z `origin: 'cloud'` (mirrorGate tłumi re-lustrzenie).

// ---- Tabele nasłuchiwane ----------------------------------------------------

/**
 * Osiem grup encji planera lustrzanych przez MERGE_CLOUD_ENTITIES. Zmiana w
 * którejkolwiek => zaplanuj odświeżenie snapshotu (debounce/coalesce).
 */
export const PLANNER_REALTIME_TABLES = [
  'clients',
  'projects',
  'milestones',
  'tasks',
  'task_assignments',
  'workload_entries',
  'comments',
  'activity_events',
] as const;

/**
 * Tabele słownikowe/referencyjne (mapy id wywodzą się ze snapshotu organizacji,
 * a NIE ze scalania planera). Zmiana => `org.reload()`, a zmiana referencji
 * snapshotu wyzwala jedną hydrację w tle po świeże mapy.
 */
export const DICTIONARY_REALTIME_TABLES = [
  'profiles',
  'departments',
  'statuses',
  'service_types',
  'work_categories',
] as const;

export type PlannerRealtimeTable = (typeof PLANNER_REALTIME_TABLES)[number];
export type DictionaryRealtimeTable = (typeof DICTIONARY_REALTIME_TABLES)[number];

/** Wszystkie 13 tabel obserwowanych na jednym kanale. */
export const ALL_REALTIME_TABLES: readonly string[] = [
  ...PLANNER_REALTIME_TABLES,
  ...DICTIONARY_REALTIME_TABLES,
];

// ---- Cienki adapter subskrypcji (testowalny z mockiem kanału) ---------------

/**
 * Minimalny kształt kanału Realtime, którego używamy: rejestracja nasłuchów
 * postgres_changes i subskrypcja statusu. Prawdziwy `RealtimeChannel` z
 * @supabase/supabase-js jest strukturalnie zgodny; w testach wstrzykujemy mock.
 */
export interface RealtimeChannelLike {
  on(
    type: 'postgres_changes',
    filter: { event: '*'; schema: string; table: string },
    callback: (payload: unknown) => void,
  ): RealtimeChannelLike;
  subscribe(callback: (status: string) => void): RealtimeChannelLike;
}

/** Wywołania zwrotne adaptera: routing zdarzeń i statusu do prowidera. */
export interface RealtimeWiringHandlers {
  /** Zmiana w tabeli planera => zaplanuj zdebouncowane odświeżenie snapshotu. */
  onPlannerChange: (table: string) => void;
  /** Zmiana w tabeli słownikowej => przeładuj snapshot organizacji. */
  onDictionaryChange: (table: string) => void;
  /** Zmiana statusu subskrypcji kanału (SUBSCRIBED / błąd / zamknięcie). */
  onStatus: (status: string) => void;
}

export interface RealtimeSubscription {
  /** Usuwa kanał (best-effort) — woła przekazany `removeChannel`. */
  teardown: () => void;
}

/**
 * Tworzy JEDEN kanał, rejestruje 13 nasłuchów postgres_changes (`event: '*'`,
 * `schema: 'public'`) — po jednym na tabelę planera i słownikową — i subskrybuje
 * status. Zwraca teardown usuwający kanał. Czyste: bez Reacta i bez prawdziwego
 * klienta; prowider dostarcza fabryki kanału/usuwania i wywołania zwrotne.
 */
export function subscribePlannerChannel<C extends RealtimeChannelLike>(
  createChannel: () => C,
  removeChannel: (channel: C) => void,
  handlers: RealtimeWiringHandlers,
): RealtimeSubscription {
  const channel = createChannel();
  for (const table of PLANNER_REALTIME_TABLES) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () =>
      handlers.onPlannerChange(table),
    );
  }
  for (const table of DICTIONARY_REALTIME_TABLES) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () =>
      handlers.onDictionaryChange(table),
    );
  }
  channel.subscribe((status) => handlers.onStatus(status));
  return {
    teardown: () => removeChannel(channel),
  };
}

// ---- Mapowanie statusu kanału na `live` -------------------------------------

/**
 * Status subskrypcji kanału Supabase (przekazywany przez `channel.subscribe`).
 * `SUBSCRIBED` => kanał żyje; `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` (oraz
 * demontaż) => nie żyje.
 */
export type RealtimeChannelStatus =
  | 'SUBSCRIBED'
  | 'CHANNEL_ERROR'
  | 'TIMED_OUT'
  | 'CLOSED';

/** Kanał jest „na żywo” wtedy i tylko wtedy, gdy status to SUBSCRIBED. */
export function isLiveChannelStatus(status: string): boolean {
  return status === 'SUBSCRIBED';
}

// ---- Predykat baneru „nieaktualne dane” -------------------------------------

/**
 * Czy pokazać podpowiedź o ręcznym odświeżeniu (last-write-wins). Prawda TYLKO
 * gdy hydracja gotowa, kolejka pusta i kanał NIE jest na żywo — gdy kanał żyje,
 * zmiany dopływają same, więc podpowiedź znika (ręczne odświeżenie zostaje jako
 * fallback przy błędzie/zamknięciu kanału).
 */
export function showStaleHint(input: {
  status: string;
  pendingCount: number;
  live: boolean;
}): boolean {
  return input.status === 'ready' && input.pendingCount === 0 && !input.live;
}

// ---- Bramka drenażu lustra podczas hydracji ---------------------------------

/**
 * Czy efekt lustra ma OD RAZU drenować kolejkę zapisów po lokalnej edycji.
 * Prawda tylko w statusie 'ready' i gdy NIE trwa hydracja. Odświeżenie w tle
 * (tryb cichy) zostawia status 'ready', więc bez tej bramki drenaż lustra
 * ścigałby się z pętlą runHydration: processQueue opróżnia queueRef na starcie
 * drenażu, przez co po restarcie pętla mogłaby scalić snapshot sprzed trwającego
 * zapisu. Gdy hydracja trwa, jej krok 'drain' jest JEDYNĄ ścieżką drenaż-przed-
 * scaleniem — edycja jest kolejkowana i utrwalana, a wypłukana przez tę pętlę.
 */
export function shouldMirrorProcessQueue(input: {
  phase: string;
  hydrationInFlight: boolean;
}): boolean {
  return input.phase === 'ready' && !input.hydrationInFlight;
}

// ---- Maszyna debounce / coalesce (z limitem max-wait) -----------------------

/** Trailing debounce: seria zdarzeń zbiega się do jednego odświeżenia po ciszy. */
export const REALTIME_DEBOUNCE_MS = 1000;
/** Twardy limit: ciągły sztorm zdarzeń i tak zbiega się co tyle ms. */
export const REALTIME_MAX_WAIT_MS = 5000;

/**
 * Stan harmonogramu odświeżeń. `firstEventAt` kotwiczy limit max-wait dla całej
 * serii; `lastEventAt` przesuwa okno trailing-debounce. `firstEventAt === null`
 * oznacza brak oczekującego odświeżenia.
 */
export interface RefreshSchedulerState {
  firstEventAt: number | null;
  lastEventAt: number | null;
}

/** Pusty harmonogram (brak oczekujących zdarzeń). */
export function emptyRefreshScheduler(): RefreshSchedulerState {
  return { firstEventAt: null, lastEventAt: null };
}

/** Czy jakieś zdarzenie czeka na spłukanie. */
export function isRefreshPending(state: RefreshSchedulerState): boolean {
  return state.firstEventAt !== null;
}

/** Po spłukaniu odświeżenia: wyczyść serię (nowe zdarzenia zaczną kolejną). */
export function afterFlush(): RefreshSchedulerState {
  return emptyRefreshScheduler();
}

/**
 * Zapisuje zdarzenie realtime. Pierwsze zdarzenie serii kotwiczy `firstEventAt`
 * (limit max-wait); każde kolejne przesuwa `lastEventAt` (okno debounce).
 */
export function recordRealtimeEvent(
  state: RefreshSchedulerState,
  now: number,
): RefreshSchedulerState {
  if (state.firstEventAt === null) {
    return { firstEventAt: now, lastEventAt: now };
  }
  return { firstEventAt: state.firstEventAt, lastEventAt: now };
}

/**
 * Czas, w którym odświeżenie powinno się odpalić: wcześniejszy z
 * (ostatnie_zdarzenie + debounce) i (pierwsze_zdarzenie + max-wait). `null`, gdy
 * nic nie czeka.
 */
export function refreshDueAt(state: RefreshSchedulerState): number | null {
  if (state.firstEventAt === null || state.lastEventAt === null) return null;
  const trailing = state.lastEventAt + REALTIME_DEBOUNCE_MS;
  const cap = state.firstEventAt + REALTIME_MAX_WAIT_MS;
  return Math.min(trailing, cap);
}

/**
 * Decyzja harmonogramu dla adaptera (CloudSyncProvider):
 * - `idle`   — nic nie czeka;
 * - `defer`  — czeka, ale własne operacje są w kolejce/drenażu lub trwa
 *              hydracja: nie odpalaj; ponów po drenażu/zakończeniu hydracji;
 * - `wait`   — ustaw timer na `delayMs` i ponów decyzję;
 * - `flush`  — odpal jedno odświeżenie w tle TERAZ.
 */
export type RefreshDecision =
  | { kind: 'idle' }
  | { kind: 'defer' }
  | { kind: 'wait'; delayMs: number }
  | { kind: 'flush' };

/**
 * Liczy decyzję harmonogramu. Czysta: adapter podaje `now` i czy jest zajęty
 * (własne operacje pending/drenaż albo hydracja w toku). Gdy zajęty — odracza
 * (żeby echo własnych zapisów nie wywołało zbędnego fetcha i nie ścigało się z
 * drenażem/hydracją). Inaczej porównuje `now` z terminem: spłucz albo czekaj.
 */
export function planRefresh(
  state: RefreshSchedulerState,
  now: number,
  opts: { busy: boolean },
): RefreshDecision {
  const due = refreshDueAt(state);
  if (due === null) return { kind: 'idle' };
  if (opts.busy) return { kind: 'defer' };
  if (now >= due) return { kind: 'flush' };
  return { kind: 'wait', delayMs: due - now };
}
