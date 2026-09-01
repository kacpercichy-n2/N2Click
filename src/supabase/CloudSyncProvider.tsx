// Most Reactowy dla lustra danych planera w chmurze (cała logika i mapowanie
// żyją w cloudMirror.ts / plannerData.ts — czyste, testowalne w node).
//
// GRANICA PRZEJŚCIOWA: w trybie supabase siedem grup encji planera (klienci,
// projekty, zadania, przypisania, komentarze, aktywność) jest lustrzane do
// Supabase (zapisy liczone z diff-a stanu PO reduktorze) i hydratowane przy
// logowaniu jedną akcją MERGE_CLOUD_ENTITIES. localStorage pozostaje źródłem
// renderowania i kopią do odzysku — żaden błąd chmury nie gubi pracy. Tryb
// lokalny: zero różnicy (żaden klient Supabase nie powstaje, brak dispatchy).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePersistence, useStore, useStoreApi } from '../store/AppStore';
import { setCloudMirrorHealthy } from '../store/persistGate';
import { anyLiveSyncHold, shouldDeferBackgroundMerge } from '../utils/liveSyncGate';
import { reconnectDelayMs } from '../utils/liveChannel';
import {
  clearCloudOutbox,
  loadData,
  quarantineDataForAccountSwitch,
  readCloudOutbox,
  readDataOwner,
  writeCloudOutbox,
  writeCloudRetirementMarker,
  writeDataOwner,
} from '../store/storage';
import { useAuth } from '../auth/SessionProvider';
import { useOrgData } from './OrgDataProvider';
import { createPinnedRestClient, getSupabaseClient } from './client';
import {
  createSupabaseContentPlanDb,
  createSupabasePlannerDb,
  loadContentPlanSnapshot,
  loadNotificationsSnapshot,
  loadPlannerSnapshot,
  readRetirementSetting,
  type PlannerDb,
} from './plannerData';
import {
  applyCloudOps,
  buildCloudIdMaps,
  diffContentPlanToCloudOps,
  diffToCloudOps,
  CONTENT_PLAN_SCHEMA,
  SYNC_ERROR_MSG,
  type CloudIdMaps,
  type CloudOp,
} from './cloudMirror';
import { notificationInsertsFromDiff } from './notificationEvents';
import { buildCloudPeoplePayload, type OrgSnapshot } from './referenceData';
import { createLiveTracker } from './liveChannelTracker';

export type CloudSyncStatus = 'idle' | 'hydrating' | 'ready' | 'error';

// Ile ms nieprzerwanej utraty statusu kanału traktujemy jako realną utratę
// live (a nie przejściowy flap drop→rejoin). Krótki rejoin w tym oknie =
// ciągłość, więc baner stale-hint nie miga przy cichym syncu.
const LIVE_DROP_GRACE_MS = 5_000;

export interface CloudSyncValue {
  status: CloudSyncStatus;
  pendingCount: number;
  error: string | null;
  /** Czy kanał Realtime jest zasubskrybowany — zmiany w bazie same odświeżają GUI. */
  live: boolean;
  dropped: Array<{ label: string; message: string }>;
  /** Ponawia: hydrację (gdy błąd hydracji) albo kolejkę zapisów (błąd przejściowy). */
  retry: () => void;
  /** Odśwież dane z serwera — dostępne tylko przy pustej kolejce i bez błędu. */
  refresh: () => void;
  dismissDropped: () => void;
  /** Czy per-akcyjne zapisy lokalne są wycofane (zbuforowana decyzja organizacji). */
  retired: boolean;
  /**
   * Ustawia zbuforowany znacznik wycofania (per-przeglądarka) i odświeża stan.
   * Wołane przez panel migracji po udanym handshake (true) lub przywróceniu (false).
   */
  applyRetirement: (enabled: boolean) => void;
}

const CloudSyncContext = createContext<CloudSyncValue | null>(null);

export function useCloudSync(): CloudSyncValue {
  const ctx = useContext(CloudSyncContext);
  if (!ctx) throw new Error('useCloudSync must be used within CloudSyncProvider');
  return ctx;
}

/**
 * Walidacja kształtu operacji odtworzonej z trwałego outboxu (klucz per konto
 * w storage.ts) — dysk jest MODYFIKOWALNY po stronie klienta, więc nic spoza
 * tego kształtu nie wraca do kolejki. Kluczowe: `update`/`remove` MUSZĄ nieść
 * niepusty `match` ze stringowymi wartościami — op bez filtra wykonałby
 * UPDATE/DELETE na całej tabeli w zasięgu RLS użytkownika (drugą, twardą
 * strażą jest applyCloudOps, który odrzuca niefiltrowane operacje także na
 * świeżej ścieżce).
 */
function isCloudOpLike(v: unknown): v is CloudOp {
  if (typeof v !== 'object' || v === null) return false;
  const op = v as { kind?: unknown; table?: unknown; row?: unknown; match?: unknown };
  if (typeof op.table !== 'string' || op.table.length === 0) return false;
  if (op.kind === 'upsert') {
    return typeof op.row === 'object' && op.row !== null && !Array.isArray(op.row);
  }
  if (op.kind === 'update' || op.kind === 'remove') {
    if (typeof op.match !== 'object' || op.match === null || Array.isArray(op.match)) return false;
    const entries = Object.entries(op.match as Record<string, unknown>);
    return (
      entries.length > 0 &&
      entries.every(([, value]) => typeof value === 'string' && value.length > 0)
    );
  }
  return false;
}

// Transitions the mirror must NEVER propagate to the cloud: our own hydration,
// another tab's already-mirrored write, and the local-only sample/reset ops.
const SUPPRESSED = new Set([
  'MERGE_CLOUD_ENTITIES',
  'MERGE_CLOUD_PEOPLE',
  'MERGE_CLOUD_DICTIONARIES',
  // Hydracja powiadomień odbiorcy jest autorytatywna (cloud->local): `read_at`
  // z chmury nie może wracać jako mirror-update, więc tłumimy to przejście.
  'MERGE_CLOUD_NOTIFICATIONS',
  // Hydracja modułu Content Plan (schemat `contentplan`) jest autorytatywna —
  // scalone wiersze nie mogą wrócić do chmury jako świeży diff.
  'MERGE_CLOUD_CONTENT_PLAN',
  'REPLACE_FROM_STORAGE',
  'LOAD_SAMPLE',
  'RESET_ALL',
]);

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { state, dispatch, lastActionRef } = useStore();
  // `actionFor` — akcja, która wytworzyła KONKRETNĄ referencję stanu, oraz
  // `getState` — stan zatwierdzony teraz (obie stałe referencyjnie).
  const { actionFor, getState } = useStoreApi();
  const { retryPersist } = usePersistence();
  const auth = useAuth();
  const org = useOrgData();

  const [status, setStatus] = useState<CloudSyncStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<Array<{ label: string; message: string }>>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [retired, setRetired] = useState(false);

  // Live refs for the mount-once listeners / queue callbacks.
  const retiredRef = useRef(retired);
  retiredRef.current = retired;
  const pendingRef = useRef(0);
  const retryPersistRef = useRef(retryPersist);
  retryPersistRef.current = retryPersist;

  const stateRef = useRef(state);
  stateRef.current = state;
  const prevRef = useRef(state); // ostatni zlustrzany stan
  const queueRef = useRef<CloudOp[]>([]);
  const processingRef = useRef(false);
  const hydratedUserRef = useRef<string | null>(null);
  // Żywy identyfikator konta dla persystencji outboxu (patrz persistOutbox).
  const userIdRef = useRef<string | null>(null);
  // EPOKA SESJI: podbijana przy każdej tranzycji konta (wylogowanie, zmiana
  // konta). Drenaż łapie epokę na starcie i porównuje po każdym `await` oraz
  // przed każdą operacją wsadu (sonda `shouldAbort` w applyCloudOps) —
  // w odróżnieniu od porównania po userId zamyka też relogin TEGO SAMEGO
  // konta w trakcie wiszącego batcha (userId równy, ale kolejka i outbox
  // zostały świadomie skasowane przy wylogowaniu — batch nie ma prawa ich
  // wskrzesić przez requeue).
  //
  // ŹRÓDŁEM bumpa jest nasłuch SDK (`onAuthStateChange` niżej), nie efekty
  // Reacta: sesja singletona klienta zmienia się na poziomie SDK ZANIM React
  // wyrenderuje i odpali efekty, więc bump w efekcie przychodziłby za późno —
  // wsad zdążyłby wysłać kolejne operacje tokenem nowej sesji. Efekty nadal
  // bumpują dodatkowo (pas i szelki; wielokrotny bump jest nieszkodliwy —
  // każda różnica epok znaczy abort).
  const sessionEpochRef = useRef(0);
  // Ostatnia tożsamość widziana na poziomie SDK — bump tylko przy REALNEJ
  // zmianie użytkownika (TOKEN_REFRESHED tego samego konta nie może przerywać
  // wsadu: abort jest bez requeue, a operacje czekałyby na dysku do
  // następnego logowania).
  const sdkUserRef = useRef<string | null>(null);
  const dbRef = useRef<PlannerDb | null>(null);
  const contentPlanDbRef = useRef<PlannerDb | null>(null);
  const mapsRef = useRef<CloudIdMaps | null>(null);
  const statusRef = useRef<CloudSyncStatus>('idle');
  statusRef.current = status;
  const mountedRef = useRef(true);
  // StrictMode symuluje odmontowanie i ponowny montaż: ciało efektu MUSI
  // przywrócić `true`, inaczej po remoncie każda hydracja przerywa się na
  // strażniku `!mountedRef.current` i synchronizacja nigdy nie startuje w dev.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Żywa synchronizacja (Realtime): stan subskrypcji + debounce pełnej
  // hydracji. Zdarzenie postgres_changes to wyłącznie sygnał „coś się
  // zmieniło” — prawdą pozostaje autorytatywny snapshot (org + planer).
  const [live, setLive] = useState(false);
  const refreshingFromReadyRef = useRef(false);
  const pendingLiveSyncRef = useRef(false);
  const liveSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveSyncRef = useRef<() => void>(() => {});
  // Odświeżenie w tle omija krawędź statusu, więc dosynchronizowanie znacznika
  // wycofania wołamy przez ref (wzorzec jak liveSyncRef — definicja niżej).
  const syncRetirementRef = useRef<() => void>(() => {});
  const orgRefreshRef = useRef(org.refreshSilently);
  orgRefreshRef.current = org.refreshSilently;

  const userId =
    auth.mode === 'supabase' && auth.state.status === 'signedIn'
      ? auth.state.session?.user?.id ?? null
      : null;
  userIdRef.current = userId;
  // Token dostępu Z RENDERU (spójny z userIdRef i właścicielem kolejki z tego
  // samego commitu): drenaż przypina go do całego przebiegu — patrz
  // createPinnedAuthClient. W oknie TOCTOU (SDK ma już sesję B, React jeszcze
  // renderuje A) ref trzyma token A — dokładnie ten, którym operacje A mają
  // prawo wyjść.
  const accessTokenRef = useRef<string | null>(null);
  accessTokenRef.current =
    auth.mode === 'supabase' && auth.state.status === 'signedIn'
      ? auth.state.session?.access_token ?? null
      : null;
  const snapshot = org.state.status === 'ready' ? org.state.snapshot : null;
  const active = auth.mode === 'supabase' && userId !== null && snapshot !== null;

  const getDb = useCallback((): PlannerDb => {
    if (!dbRef.current) dbRef.current = createSupabasePlannerDb(getSupabaseClient());
    return dbRef.current;
  }, []);

  // Ten sam KLIENT, inny schemat: moduł Content Plan mieszka w `contentplan`,
  // więc jego odczyty i zapisy idą przez osobny adapter (żadnego drugiego
  // `createClient` — patrz `createSupabaseContentPlanDb`).
  const getContentPlanDb = useCallback((): PlannerDb => {
    if (!contentPlanDbRef.current) {
      contentPlanDbRef.current = createSupabaseContentPlanDb(getSupabaseClient());
    }
    return contentPlanDbRef.current;
  }, []);

  const setPending = useCallback((n: number) => {
    pendingRef.current = n;
    setPendingCount(n);
  }, []);

  // DATA-01: trwały outbox. Każda mutacja kolejki jest odbijana na dysk (per
  // konto), żeby reload po błędzie przejściowym nie gubił niedopchniętych
  // operacji. Zapis pustej kolejki usuwa klucz. Refy zamiast domknięć — funkcja
  // jest wołana z processQueue i efektów o różnych zależnościach.
  //
  // Wsad W LOCIE (inFlightRef): processQueue zdejmuje operacje z queueRef na
  // czas `await applyCloudOps`. Gdyby persistOutbox odpalił się w tym oknie
  // (świeży push z lustra podczas await), zapisałby dysk BEZ wsadu w locie —
  // crash w trakcie apply straciłby go bezpowrotnie. Dlatego dysk zawsze
  // dostaje sumę: wsad w locie + kolejka. Replay potwierdzonego wsadu jest
  // bezpieczny (upserty/idempotencja).
  // WŁAŚCICIEL kolejki: konto, dla którego operacje zostały zakolejkowane.
  // Zapis na dysk następuje WYŁĄCZNIE, gdy właściciel == bieżące konto — wsad
  // w locie konta A po wylogowaniu / zmianie na B nie może zostać dopisany do
  // outboxu B (replay wykonałby cudze operacje) ani wskrzesić klucza, który
  // logout właśnie wyczyścił.
  const inFlightRef = useRef<CloudOp[]>([]);
  const queueOwnerRef = useRef<string | null>(null);
  const persistOutbox = useCallback(() => {
    const owner = queueOwnerRef.current;
    if (owner === null || owner !== userIdRef.current) return;
    writeCloudOutbox(owner, [...inFlightRef.current, ...queueRef.current] as unknown[]);
  }, []);


  // Wykonuje kolejkę operacji sekwencyjnie (serializacja jedną pętlą). Na błędzie
  // przejściowym zatrzymuje się i zostawia resztę w kolejce (retry wznawia).
  // W trybie wycofanym: świeży zapis lokalny (kopia do odzysku) przy DRENAŻU
  // kolejki do zera (stan potwierdzony w chmurze) oraz NATYCHMIAST przy błędzie
  // przejściowym (praca zagrożona trafia na dysk, zanim można ją zgubić).
  // Pinowane adaptery CACHE'OWANE per token (nie per przebieg drenażu).
  // Pin to goły PostgREST bez GoTrue (patrz createPinnedRestClient — pełny
  // klient wieszał globalnego słuchacza i wyciekał po rotacji/wylogowaniu),
  // więc porzucona para adapterów jest zwykłym obiektem do GC. Cache i tak
  // trzyma jedną żywą parę (token rotuje ~co godzinę); logout/zmiana konta
  // zeruje referencję.
  const pinnedRef = useRef<{ token: string; db: PlannerDb; contentPlan: PlannerDb } | null>(
    null,
  );
  const getPinnedAdapters = useCallback((accessToken: string) => {
    const cached = pinnedRef.current;
    if (cached !== null && cached.token === accessToken) return cached;
    const client = createPinnedRestClient(accessToken);
    const next = {
      token: accessToken,
      db: createSupabasePlannerDb(client),
      contentPlan: createSupabaseContentPlanDb(client),
    };
    pinnedRef.current = next;
    return next;
  }, []);

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    // Strażnik WŁASNOŚCI na wejściu: nigdy nie drenuj kolejki, która nie
    // należy do bieżącego konta (okno między zmianą konta a efektem izolacji,
    // który ją wyczyści) — dotyczy każdego miejsca wywołania, obecnego
    // i przyszłego.
    if (queueRef.current.length > 0 && queueOwnerRef.current !== userIdRef.current) return;
    // Strażnik tokenu PRZED wzięciem flagi przetwarzania — wyjście po jej
    // ustawieniu, a przed `try/finally`, zostawiłoby `processingRef = true`
    // na zawsze i zakleszczyło każdą przyszłą synchronizację.
    const accessToken = accessTokenRef.current;
    if (accessToken === null) return;
    processingRef.current = true;
    // Epoka sesji, w której drenujemy. Każda tranzycja konta w oknie `await`
    // (wylogowanie, zmiana konta, relogin tego samego konta) = przerwij bez
    // requeue i bez zapisu — logout/switch już wyczyścił kolejkę i dysk,
    // a batch nie ma prawa niczego wskrzesić.
    const epoch = sessionEpochRef.current;
    // PIN TOKENU: cały przebieg drenażu wysyła operacje klientem z zamrożonym
    // nagłówkiem Authorization (token z tego samego commitu renderu, co
    // właściciel kolejki). Singleton czyta bieżącą sesję wewnątrz każdego
    // wywołania SDK — już PO sondzie epoki — więc bez pinu podmiana konta
    // w tym oknie wysłałaby operacje konta A tokenem konta B. Z pinem
    // najgorszy przypadek to operacja właściciela jego własnym, jeszcze
    // ważnym tokenem; wygasły token = zwykły błąd przejściowy i retry.
    const { db: pinnedDb, contentPlan: pinnedContentPlanDb } = getPinnedAdapters(accessToken);
    try {
      while (queueRef.current.length > 0) {
        const ops = queueRef.current;
        queueRef.current = [];
        inFlightRef.current = ops;
        let result;
        try {
          result = await applyCloudOps(
            pinnedDb,
            ops,
            { [CONTENT_PLAN_SCHEMA]: pinnedContentPlanDb },
            // Tranzycja sesji w TRAKCIE wsadu przerywa wysyłkę między
            // operacjami (pin tokenu domyka resztę okna wewnątrz operacji).
            { shouldAbort: () => sessionEpochRef.current !== epoch },
          );
        } catch {
          inFlightRef.current = [];
          if (sessionEpochRef.current !== epoch) return;
          // Nieoczekiwany wyjątek adaptera (poza kontraktem result.error):
          // wsad wraca do kolejki i na dysk — nigdy nie znika z pamięci
          // z pustym queueRef.
          queueRef.current = [...ops, ...queueRef.current];
          setPending(queueRef.current.length);
          persistOutbox();
          setError(SYNC_ERROR_MSG);
          if (retiredRef.current) retryPersistRef.current();
          return;
        }
        inFlightRef.current = [];
        // Wsad przerwany tranzycją sesji: pozostałe operacje należały do
        // poprzedniej sesji — bez requeue, bez zapisu, bez błędu.
        if (result.aborted === true) return;
        if (!mountedRef.current) return;
        if (sessionEpochRef.current !== epoch) return;
        if (result.dropped.length > 0) {
          setDropped((prev) => [...prev, ...result.dropped]);
        }
        if (result.error) {
          queueRef.current = [...result.remaining, ...queueRef.current];
          setPending(queueRef.current.length);
          persistOutbox();
          setError(result.error);
          // Błąd przejściowy: flaga zdrowia opadnie (efekt), zapisy per-akcyjne
          // wznawiają się; zagrożoną pracę zapisujemy TERAZ lokalnie.
          if (retiredRef.current) retryPersistRef.current();
          return; // zatrzymaj — retry() wznowi
        }
        setError(null);
        setPending(queueRef.current.length);
        // Wsad potwierdzony w chmurze: dysk odbija pozostałą kolejkę (zero =>
        // klucz znika). Zapis DOPIERO po potwierdzeniu — awaria w trakcie
        // apply zostawia wsad na dysku, a replay jest bezpieczny (upserty).
        persistOutbox();
      }
      // Kolejka opróżniona bez błędu: kopia do odzysku = stan potwierdzony chmurą.
      if (retiredRef.current) retryPersistRef.current();
      // Zdarzenie Realtime odłożone na czas drenażu kolejki => dosynchronizuj.
      if (pendingLiveSyncRef.current) {
        pendingLiveSyncRef.current = false;
        liveSyncRef.current();
      }
    } finally {
      processingRef.current = false;
      // W `finally`, bo strażniki zmiany konta wychodzą z pętli przez `return`
      // — kod ZA blokiem try/finally nie wykonuje się na tych ścieżkach, a to
      // właśnie one zostawiają kolejkę z operacjami NOWEGO użytkownika (jego
      // push odbił się od `processingRef` bez drenażu). Przeprocesuj od nowa
      // pod właściwym właścicielem; rekurencja kończy się, bo nowy przebieg
      // czyta bieżące konto (processingRef jest już false).
      //
      // Warunek WŁASNOŚCI kolejki (`queueOwnerRef === userIdRef`) jest tu
      // krytyczny: kontynuacja wiszącego `await` to mikrotask, który potrafi
      // wykonać się PO renderze ze zmienionym kontem, ale PRZED efektem
      // izolacji kont czyszczącym kolejkę — bez tego warunku re-trigger
      // wysłałby nieopróżnioną kolejkę konta A w sesji konta B. Kolejka
      // z ownerem == bieżące konto to z konstrukcji operacje tego konta.
      if (
        sessionEpochRef.current !== epoch &&
        queueRef.current.length > 0 &&
        queueOwnerRef.current === userIdRef.current
      ) {
        void processQueue();
      }
    }
  }, [setPending, persistOutbox, getPinnedAdapters]);

  // Migawka „czy wolno TERAZ zastosować scalenie w tle”. Czyta wyłącznie żywe
  // refy, więc każde wywołanie widzi bieżący świat — wołana ponownie po każdym
  // `await` w ścieżce żywej synchronizacji, bo szybki gest przeciągania mieści
  // się w całości w oknie fetcha snapshotu (patrz shouldDeferBackgroundMerge).
  const backgroundMergeDeferred = useCallback(
    () =>
      shouldDeferBackgroundMerge({
        held: anyLiveSyncHold(),
        processing: processingRef.current,
        queuedOps: queueRef.current.length,
        mirrorPending: prevRef.current !== stateRef.current,
      }),
    [],
  );

  const runHydration = useCallback(
    async (overrideSnap?: OrgSnapshot, opts?: { background?: boolean }) => {
      const snap =
        overrideSnap ?? (org.state.status === 'ready' ? org.state.snapshot : null);
      if (auth.mode !== 'supabase' || !userId || !snap) return;
      // Odświeżenie ze stanu 'ready' (ręczne lub Realtime): lustro ma już mapy,
      // więc edycje wykonane w oknie hydracji dalej trafiają do kolejki zamiast
      // być pochłaniane i nadpisywane autorytatywnym scaleniem.
      const fromReady = statusRef.current === 'ready';
      refreshingFromReadyRef.current = fromReady;
      // BEZSZWOWO: odświeżenie w tle (Realtime) NIE zrzuca statusu do
      // 'hydrating' — inaczej baner „Wczytywanie danych z serwera…” pojawiał
      // się i znikał przy każdym zdarzeniu, przesuwając układ nad kalendarzem/
      // mapą. Wskaźnik ładowania zostaje wyłącznie dla hydracji startowej,
      // ręcznego odświeżenia i ponowienia po błędzie. Błąd i tak jest widoczny
      // (setStatus('error') niżej) — jawny baner konfliktu nie regresuje.
      const background = opts?.background === true && fromReady;
      if (!background) setStatus('hydrating');
      setError(null);
      const maps = buildCloudIdMaps(stateRef.current, snap);
      mapsRef.current = maps;
      try {
        const result = await loadPlannerSnapshot(getDb(), maps, stateRef.current);
        if (!mountedRef.current) return;
        if (!result.ok) {
          setStatus('error');
          setError(result.error);
          return;
        }
        if (import.meta.env.DEV && result.diagnostics.length > 0) {
          console.warn('[cloud] Hydracja pominęła wiersze:', result.diagnostics);
        }
        // Ostatnia bramka przed scaleniem W TLE: fetch snapshotu trwał setki ms
        // i świat mógł się zmienić — nowy gest przeciągania, świeża lokalna
        // edycja (jeszcze przed diffem lustra) albo drenaż kolejki. Snapshot
        // jest wtedy STARSZY od stanu lokalnego; jego dispatch cofnąłby
        // upuszczoną przed chwilą kartę na bazową pozycję. Odraczamy tym samym
        // debounce'em — kolejny przebieg zobaczy już wypchnięte zmiany.
        // Hydracja startowa, ręczny „Odśwież” i ponowienie po błędzie
        // (background=false) świadomie NIE pytają — jak przy blokadach.
        if (background && backgroundMergeDeferred()) {
          liveSyncRef.current();
          return;
        }
        // Autorytatywna hydracja: profile chmury jadą w TYM SAMYM ładunku, żeby
        // reduktor scalił zespół PRZED walidacją encji (osoby bez lokalnej pary
        // e-mailowej dostają wiersz o id profilu chmury w jednej atomowej akcji).
        // Pas i szelki do tłumienia po `actionFor`: baza diffa rusza do przodu
        // OD RAZU po scaleniu (synchronicznie, zanim jakikolwiek efekt zdąży
        // diffować), więc delta hydracji nie może wrócić do chmury jako echo
        // nawet przy egzotycznym sklejeniu commitów. WARUNKOWO: tylko gdy przed
        // dispatchem nic niezmirrowanego nie wisiało (prevRef == stan sprzed
        // scalenia) — wiszącą edycję rozliczy efekt lustra po `actionFor`,
        // a jej diff nie ma prawa zostać połknięty.
        const advanceDiffBase = (merge: () => void): void => {
          const before = getState();
          merge();
          if (prevRef.current === before) prevRef.current = getState();
        };
        advanceDiffBase(() =>
          dispatch({
            type: 'MERGE_CLOUD_ENTITIES',
            payload: { ...result.payload, people: buildCloudPeoplePayload(snap.profiles) },
          }),
        );
        // Powiadomienia in-app: OSOBNY loader — nie blokuje reszty syncu ani
        // statusu. Brak tabeli (migracja niezaaplikowana) => `available` z []
        // (podmiana autorytatywna). Błąd PRZEJŚCIOWY => `available: false`:
        // NIE dispatchujemy scalenia, zostawiamy poprzedni stan (panel nie miga
        // pustką na chwilowym błędzie sieci).
        const notifResult = await loadNotificationsSnapshot(getDb(), maps);
        if (mountedRef.current && notifResult.available) {
          advanceDiffBase(() =>
            dispatch({
              type: 'MERGE_CLOUD_NOTIFICATIONS',
              payload: { notifications: notifResult.notifications },
            }),
          );
        }
        // Content Plan: OSOBNY schemat i osobny, degradujący się loader — brak
        // schematu/tabel (migracja niezaaplikowana) => `available` z pustymi
        // kolekcjami, błąd PRZEJŚCIOWY => brak dispatchu (zostaje poprzedni stan).
        // Nie wpływa na status ani na resztę syncu.
        const contentPlanResult = await loadContentPlanSnapshot(getContentPlanDb());
        if (mountedRef.current && contentPlanResult.available) {
          advanceDiffBase(() =>
            dispatch({
              type: 'MERGE_CLOUD_CONTENT_PLAN',
              payload: { brands: contentPlanResult.brands, posts: contentPlanResult.posts },
            }),
          );
        }
        setStatus('ready');
        // Odświeżenie w tle nie przechodzi przez krawędź 'hydrating'→'ready',
        // więc efekt na krawędzi statusu nie odpali: świeżą kopię do odzysku
        // odświeżamy tu wprost (parytet z poprzednim zachowaniem).
        if (background) {
          retryPersistRef.current();
          syncRetirementRef.current();
        }
        // Edycje zakolejkowane w oknie hydracji: wypchnij od razu — pętla
        // Realtime (nasz własny zapis => zdarzenie => hydracja) je uzgodni.
        if (queueRef.current.length > 0) {
          void processQueue();
        } else if (pendingLiveSyncRef.current) {
          // Zdarzenie Realtime nadeszło w trakcie tej hydracji => po commitcie
          // (statusRef juz 'ready') dosynchronizuj z debounce.
          pendingLiveSyncRef.current = false;
          liveSyncRef.current();
        }
      } finally {
        refreshingFromReadyRef.current = false;
      }
    },
    [
      auth.mode,
      userId,
      org.state,
      dispatch,
      getState,
      getDb,
      getContentPlanDb,
      processQueue,
      backgroundMergeDeferred,
    ],
  );

  // Pełna żywa synchronizacja: cichy refetch snapshotu organizacji (zespół,
  // słowniki, avatary) + autorytatywna hydracja planera. Odraczana, gdy trwa
  // drenaż kolejki / hydracja — dokańczana z ogonów processQueue/runHydration.
  const performLiveSync = useCallback(async () => {
    if (!mountedRef.current || !active) return;
    if (
      processingRef.current ||
      queueRef.current.length > 0 ||
      statusRef.current !== 'ready'
    ) {
      pendingLiveSyncRef.current = true;
      return;
    }
    // Trwa interakcja wrażliwa na stabilność (przeciąganie bloku kalendarza lub
    // zasobnika) albo stan wyprzedza lustro: scalenie podmieniłoby wiersz pod
    // kursorem, odmontowało komponent trzymający pointer capture albo cofnęło
    // niezmirrorowaną edycję. Odraczamy przez PRZEPLANOWANIE tym samym
    // debounce'em — nic nie ginie, dosynchronizuje się po puszczeniu.
    if (backgroundMergeDeferred()) {
      liveSyncRef.current();
      return;
    }
    const snap = await orgRefreshRef.current();
    if (!mountedRef.current) return;
    // Fetch organizacji trwał — bramka raz jeszcze, zanim ruszy hydracja
    // planera (drugi, dłuższy fetch). Szybkie chwyć–puść karty zasobnika
    // potrafi zacząć się i skończyć w tym oknie.
    if (backgroundMergeDeferred()) {
      liveSyncRef.current();
      return;
    }
    await runHydration(snap ?? undefined, { background: true });
  }, [active, runHydration, backgroundMergeDeferred]);

  const scheduleLiveSync = useCallback(() => {
    if (liveSyncTimerRef.current !== null) clearTimeout(liveSyncTimerRef.current);
    liveSyncTimerRef.current = setTimeout(() => {
      liveSyncTimerRef.current = null;
      void performLiveSync();
    }, 1200);
  }, [performLiveSync]);
  liveSyncRef.current = scheduleLiveSync;

  // Subskrypcja Realtime: jedno źródło zdarzeń postgres_changes dla wszystkich
  // opublikowanych tabel (publikacja supabase_realtime; RLS obowiązuje).
  // Zdarzenie => zaplanuj pełną synchronizację (debounce zlewa serie zmian).
  // Kanał POTRAFI paść (uśpienie laptopa, zmiana sieci, odświeżenie tokena):
  // na CHANNEL_ERROR/TIMED_OUT/CLOSED przebudowujemy go z wykładniczym
  // backoffem, a po każdym POWROCIE do SUBSCRIBED dociągamy pełną
  // synchronizację — zdarzenia z okresu martwego kanału nie mają prawa
  // przepaść po cichu (wcześniej jedynym „ratunkiem” był ręczny baner).
  //
  // Flaga `live` przechodzi przez histerezę (createLiveTracker): zwrotka
  // `subscribe` woła się na KAŻDYM przejściu socketu, więc przejściowy flap
  // (drop → natychmiastowy rejoin) NIE zbija `live` — dopiero utrata dłuższa
  // niż LIVE_DROP_GRACE_MS. Dzięki temu udany cichy sync = zero banera, a realna
  // utrata kanału nadal odsłania baner stale-hint (fallback).
  useEffect(() => {
    if (!active || !userId) {
      setLive(false);
      return;
    }
    const client = getSupabaseClient();
    let disposed = false;
    let current: ReturnType<typeof client.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let hadSubscription = false;
    const tracker = createLiveTracker({
      graceMs: LIVE_DROP_GRACE_MS,
      setLive: (next) => {
        if (mountedRef.current) setLive(next);
      },
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });

    const scheduleReconnect = (): void => {
      if (disposed || reconnectTimer !== null) return;
      const delay = reconnectDelayMs(attempt);
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        const stale = current;
        current = null;
        if (stale) void client.removeChannel(stale);
        connect();
      }, delay);
    };

    const connect = (): void => {
      if (disposed) return;
      const channel = client
        .channel(`planner-live-${userId}`)
        .on('postgres_changes', { event: '*', schema: 'n2click' }, () => {
          liveSyncRef.current();
        })
        // Tożsamość (profiles/companies) żyje w schemacie `core` — publikacja
        // realtime wskazuje tabele bazowe, nie widoki-mostki, więc bez tego
        // drugiego filtra zmiany profili/spółek nie wyzwalałyby live-syncu.
        .on('postgres_changes', { event: '*', schema: 'core' }, () => {
          liveSyncRef.current();
        });
      current = channel;
      channel.subscribe((subscribeStatus: string) => {
        // Zdarzenia porzuconego kanału (w trakcie przebudowy) ignorujemy —
        // spóźniony CLOSED starego kanału nie może zerwać świeżego, zdrowego.
        if (disposed || !mountedRef.current || current !== channel) return;
        // Histereza `live`: flap nie zbija flagi, przebudowa kanału i tak rusza.
        tracker.onStatus(subscribeStatus);
        if (subscribeStatus === 'SUBSCRIBED') {
          attempt = 0;
          // Powrót po przerwie: dociągnij zmiany z martwego okna kanału.
          if (hadSubscription) liveSyncRef.current();
          hadSubscription = true;
          return;
        }
        if (
          subscribeStatus === 'CHANNEL_ERROR' ||
          subscribeStatus === 'TIMED_OUT' ||
          subscribeStatus === 'CLOSED'
        ) {
          scheduleReconnect();
        }
      });
    };

    connect();
    return () => {
      disposed = true;
      tracker.dispose();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (liveSyncTimerRef.current !== null) {
        clearTimeout(liveSyncTimerRef.current);
        liveSyncTimerRef.current = null;
      }
      if (current) void client.removeChannel(current);
    };
  }, [active, userId]);

  // Zbieżność zbuforowanego znacznika wycofania z decyzją organizacji
  // (app_settings). Błąd odczytu => zachowaj poprzednią zbuforowaną wartość.
  const syncRetirementMarker = useCallback(async () => {
    const res = await readRetirementSetting(getDb());
    if (!mountedRef.current || !res.ok) return;
    writeCloudRetirementMarker({ enabled: res.enabled });
    setRetired(res.enabled);
  }, [getDb]);
  syncRetirementRef.current = () => void syncRetirementMarker();

  // Nasłuch SDK — jedyne miejsce, które widzi tranzycję tożsamości
  // SYNCHRONICZNIE z podmianą sesji w singletonie klienta (bez czekania na
  // render/efekty Reacta). Bump epoki natychmiast unieważnia trwający drenaż:
  // sonda `shouldAbort` zatrzyma wsad przed następną operacją.
  useEffect(() => {
    if (auth.mode !== 'supabase') return;
    const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null;
      if (sdkUserRef.current !== uid) {
        sdkUserRef.current = uid;
        sessionEpochRef.current += 1;
      }
    });
    return () => data.subscription.unsubscribe();
  }, [auth.mode]);

  // IZOLACJA KONT (SEC): raz na zalogowany identyfikator, ZANIM cokolwiek
  // wyrenderuje się z cudzych danych (ten provider jest dzieckiem
  // SessionProvider, więc jego efekty biegną PRZED asocjacją tożsamości w
  // rodzicu). Gdy zapisany cache należy do INNEGO konta Auth: payload idzie do
  // kwarantanny, a stan w pamięci wraca do pustego baseline'u (RESET_ALL jest
  // na liście SUPPRESSED — lustro nie generuje z tego diffu). Autorytatywna
  // hydracja niżej zaraz zapełni stan danymi właściwego konta. Pierwsze
  // logowanie po aktualizacji (brak markera) adoptuje istniejący cache.
  const ownerCheckedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (auth.mode !== 'supabase' || userId === null) return;
    if (ownerCheckedForRef.current === userId) return;
    const previousChecked = ownerCheckedForRef.current;
    ownerCheckedForRef.current = userId;
    // BEZPOŚREDNIA zmiana konta w tej karcie (bez przejścia przez signedOut —
    // czyszczenie kolejki w efekcie hydracji wisi na `userId === null` i tu
    // nie zadziała): kolejka i wsad w locie należą do POPRZEDNIEGO konta i nie
    // mogą zostać wysłane w sesji nowego (re-trigger drenażu po przerwaniu
    // zrobiłby to automatycznie z operacjami, które nigdy nie weszły w apply).
    if (previousChecked !== null && previousChecked !== userId) {
      sessionEpochRef.current += 1;
      queueRef.current = [];
      inFlightRef.current = [];
      queueOwnerRef.current = null;
      pinnedRef.current = null;
      setPending(0);
    }
    const owner = readDataOwner();
    if (owner !== null && owner !== userId) {
      quarantineDataForAccountSwitch();
      // Outbox poprzedniego konta nie może zostać odtworzony ani dopchnięty
      // w imieniu nowego użytkownika (klucz i tak jest per konto — to pas
      // i szelki przy zmianie tożsamości). Wsad w locie poprzedniego konta
      // też znika — persistOutbox pisze sumę in-flight + kolejka.
      clearCloudOutbox();
      inFlightRef.current = [];
      dispatch({ type: 'RESET_ALL', data: loadData() });
    }
    writeDataOwner(userId);
  }, [auth.mode, userId, dispatch, setPending]);

  // Hydracja: raz na zalogowany identyfikator, gdy snapshot organizacji jest
  // gotowy. Reset przy wylogowaniu / trybie lokalnym (żaden klient nie powstaje).
  useEffect(() => {
    if (!active) {
      hydratedUserRef.current = null;
      prevRef.current = stateRef.current;
      // Kolejkę kasujemy TYLKO przy braku sesji (wylogowanie / zmiana konta).
      // Chwilowy brak snapshotu przy tym samym użytkowniku (reload organizacji)
      // nie może wyrzucić niezlustrzanych zapisów — zostają i wypchną się po
      // ponownej aktywacji.
      if (userId === null && queueRef.current.length > 0) {
        queueRef.current = [];
      }
      // Wylogowanie kasuje też trwały outbox — parytet z kolejką w pamięci
      // (przetrwanie przeładowania tak, przeżycie jawnego wylogowania nie).
      // Zerowany właściciel odcina spóźniony persist z drenażu, a czyszczony
      // wsad w locie nie może zostać doklejony do outboxu następnego konta
      // (persistOutbox zapisuje sumę in-flight + kolejka).
      if (userId === null) {
        sessionEpochRef.current += 1;
        queueOwnerRef.current = null;
        inFlightRef.current = [];
        pinnedRef.current = null;
        clearCloudOutbox();
      }
      if (statusRef.current !== 'idle') {
        setStatus('idle');
        setError(null);
        setDropped([]);
        setPending(userId === null ? 0 : queueRef.current.length);
      }
      return;
    }
    if (hydratedUserRef.current === userId) return;
    hydratedUserRef.current = userId;
    // DATA-01: przed autorytatywną hydracją odtwórz i WYPCHNIJ trwały outbox
    // tej samej osoby (niedopchnięte operacje z poprzedniej sesji). Dzięki temu
    // założenie scalenia „raz na login z pustą kolejką push" znów jest
    // prawdziwe: lokalnie nowsza praca jest w chmurze, ZANIM chmura nadpisze
    // stan. Błąd drenażu nie blokuje hydracji — operacje zostają na dysku,
    // retry() wznowi, a wiersze wrócą do stanu przy kolejnym scaleniu.
    if (queueRef.current.length === 0) {
      const restored = readCloudOutbox(userId).filter(isCloudOpLike);
      if (restored.length > 0) {
        queueRef.current = restored;
        queueOwnerRef.current = userId;
        setPending(restored.length);
      }
    }
    void (async () => {
      if (queueRef.current.length > 0) await processQueue();
      await runHydration();
    })();
  }, [active, userId, runHydration, setPending, processQueue]);

  // Flaga zdrowia lustra dla bramki zapisu lokalnego: prawdziwa TYLKO gdy aktywne,
  // status 'ready' i brak błędu (przejściowego/hydracji). Każda degradacja => false
  // => per-akcyjne zapisy lokalne wznawiają się automatycznie.
  useEffect(() => {
    setCloudMirrorHealthy(active && status === 'ready' && error === null);
  }, [active, status, error]);
  useEffect(() => () => setCloudMirrorHealthy(false), []);

  // Po udanej hydracji (status -> 'ready'): świeży zapis lokalny (kopia = prawda
  // chmury) i synchronizacja znacznika wycofania. Efekt biegnie po commitcie, gdy
  // scalony stan jest już w stateRef.
  const prevStatusRef = useRef<CloudSyncStatus>('idle');
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev !== 'ready' && status === 'ready') {
      retryPersistRef.current();
      void syncRetirementMarker();
    }
  }, [status, syncRetirementMarker]);

  // Mount-once: strażnik przeładowania w locie — przy `pagehide` z niepustą
  // kolejką w trybie wycofanym zapisujemy stan lokalnie, zanim karta zniknie.
  useEffect(() => {
    const onPageHide = (): void => {
      if (retiredRef.current && pendingRef.current > 0) retryPersistRef.current();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  // Lustro: diff prevRef -> state, kolejkowanie i wykonanie. Suppresja własnej
  // hydracji i operacji lokalnych (sample/reset/replace).
  useEffect(() => {
    const mirroring =
      statusRef.current === 'ready' ||
      // Okno odświeżania ze stanu 'ready': mapy istnieją, edycje użytkownika
      // muszą trafić do kolejki, inaczej scalenie autorytatywne je nadpisze.
      (statusRef.current === 'hydrating' && refreshingFromReadyRef.current);
    if (!active || hydratedUserRef.current !== userId || !mirroring) {
      prevRef.current = state;
      return;
    }
    // Tłumienie po AKCJI, KTÓRA WYTWORZYŁA ten stan (parowanie po referencji),
    // nie po ostatnim dispatchu: efekty dzieci biegną PRZED efektem tego
    // providera, więc np. no-op `SETTLE_TRACKED_DAY` z trackera potrafił
    // nadpisać `lastActionRef` między commitem scalenia a tym efektem — diff
    // przypisywał wtedy deltę hydracji lokalnej akcji i odsyłał do chmury
    // wiersze, które właśnie z niej przyszły. Trigger `set_updated_at` bumpował
    // datę, Realtime budził hydrację i pętla echa kręciła się bez końca
    // (sztorm upsertów `tasks`, 2026-09-01). `lastActionRef` zostaje wyłącznie
    // zapasem dla stanów spoza mapy (stan początkowy).
    const produced = actionFor(state);
    const last = produced !== undefined ? produced.type : lastActionRef.current;
    if (last !== null && SUPPRESSED.has(last)) {
      prevRef.current = state;
      return;
    }
    if (prevRef.current === state) return;
    const maps = mapsRef.current;
    if (!maps) {
      prevRef.current = state;
      return;
    }
    const { ops } = diffToCloudOps(prevRef.current, state, maps);
    // Content Plan: rodzina diff w OSOBNYM schemacie. Operacje jadą tą samą
    // kolejką (kolejność bez znaczenia — moduł nie ma FK do tabel planera),
    // a `applyCloudOps` kieruje je do adaptera `contentplan` po polu `schema`.
    const contentPlanOps = diffContentPlanToCloudOps(prevRef.current, state).ops;
    // Zdarzenia powiadomień: liczone z TEGO SAMEGO diffa, wstawiane W IMIENIU
    // działającego użytkownika DLA innych odbiorców (recipient===self pomijany).
    // Kolejność bez znaczenia — `notifications` nie ma FK do zadań/projektów.
    const notifRows = userId ? notificationInsertsFromDiff(prevRef.current, state, maps, userId) : [];
    prevRef.current = state;
    if (ops.length === 0 && contentPlanOps.length === 0 && notifRows.length === 0) return;
    const notifOps: CloudOp[] = notifRows.map((row, i) => ({
      kind: 'upsert',
      table: 'notifications',
      row: row as unknown as Record<string, unknown>,
      sourceId: `notif:${row.recipient_id}:${row.type}:${i}`,
      label: 'Powiadomienie',
    }));
    queueRef.current.push(...ops, ...contentPlanOps, ...notifOps);
    queueOwnerRef.current = userId;
    setPending(queueRef.current.length);
    persistOutbox();
    void processQueue();
  }, [state, active, userId, lastActionRef, actionFor, processQueue, setPending]);

  const retry = useCallback(() => {
    if (statusRef.current === 'error') {
      void runHydration();
      return;
    }
    setError(null);
    void processQueue();
  }, [runHydration, processQueue]);

  const refresh = useCallback(() => {
    if (queueRef.current.length > 0 || error !== null) return;
    // Ręczne odświeżenie = pełna żywa synchronizacja: najpierw cichy refetch
    // organizacji (zespół/słowniki/avatary), potem hydracja planera na świeżym
    // snapshocie — bez zrzucania org do 'loading' (kolejka i aktywność zostają).
    void (async () => {
      const snap = await orgRefreshRef.current();
      if (!mountedRef.current) return;
      await runHydration(snap ?? undefined);
    })();
  }, [runHydration, error]);

  const dismissDropped = useCallback(() => setDropped([]), []);

  const applyRetirement = useCallback((enabled: boolean) => {
    writeCloudRetirementMarker({ enabled });
    setRetired(enabled);
  }, []);

  const value = useMemo<CloudSyncValue>(
    () => ({
      status,
      pendingCount,
      error,
      live,
      dropped,
      retry,
      refresh,
      dismissDropped,
      retired,
      applyRetirement,
    }),
    [status, pendingCount, error, live, dropped, retry, refresh, dismissDropped, retired, applyRetirement],
  );

  return <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>;
}
