# Raport workflow: 20260723-105540-n2hub-266-notifications-inapp

## Wykonane

### Analiza „czy zadanie wciąż aktualne”
TAK — funkcja nie istniała. W buildzie był tylko PUSTY slot UI z promptu 249:
`dashboardPanels.ts` (`NotificationEntry`/`MAX_NOTIFICATIONS`/`visibleNotifications`,
komentarz „no data source yet”) i `DashboardPage.tsx` z `notifications = []`.
`grep -ri notification` nie znalazł żadnej tabeli, kolekcji, akcji ani syncu.
Zaimplementowałem cały etap 1/2 (BEZ warstwy mailowej — to prompt 267).

### 1. Migracja `supabase/migrations/20260723120000_notifications.sql`
SAMODZIELNA tabela `public.notifications` (rozszerzenie WYŁĄCZNIE addytywne —
zero zmian w istniejących tabelach):
- Kolumny: `id uuid pk default gen_random_uuid()`, `recipient_id uuid not null
  references public.profiles(id) on delete cascade`, `type text not null check
  (char_length 1..100)`, `payload jsonb not null default '{}'`, `read_at
  timestamptz` (null = nieprzeczytane), `created_at timestamptz not null default
  now()`. Indeksy: `(recipient_id)` i `(recipient_id, read_at)`.
- RLS per-użytkownik (wzorzec z tickets), deny-by-default + `revoke all from anon`:
  - `notifications_select`: `using (recipient_id = (select auth.uid()))` —
    odbiorca widzi WYŁĄCZNIE własne wiersze;
  - `notifications_update`: `using/with check (recipient_id = auth.uid())` —
    służy TYLKO oznaczeniu `read_at`, odbiorca się nie zmienia;
  - `notifications_insert`: `with check (true)` — KAŻDY zalogowany może wstawić,
    bo zdarzenia generuje klient działającego użytkownika W IMIENIU odbiorcy
    (wiersz dotyczy zwykle INNEJ osoby); widoczność i tak chroni SELECT;
  - BEZ polityki DELETE (klient nie kasuje powiadomień).
- Idempotentna (`if not exists` / `drop policy if exists`), w publikacji
  `supabase_realtime` (idempotentny blok `do $$ … duplicate_object`) — świeże
  powiadomienie odbiorcy pojawia się live; WALRUS respektuje RLS.
- Rejestr: `migrations.test.ts` — dopisana do listy plików i do `EXPECTED_POLICIES`
  jako `public.notifications: ['select','insert','update']`.

### 2. Model danych (addytywnie, `DATA_VERSION` zostaje 7)
- `src/types.ts`: `NotificationType`, `NotificationPayload`, `Notification`,
  `AppData.notifications`.
- `src/utils/notifications.ts` (czyste): `isNotificationType`,
  `sanitizeNotificationPayload` (na trzech granicach: repair/hydracja/reduktor).
- `storage.ts`: `emptyData().notifications = []`, `coerceArray` na wczytaniu,
  nowy `repairNotifications` (po `repairClients`; drop wiersza bez
  id/recipientId/znanego `type`, sanityzacja payloadu). `seed.ts`: `[]`.

### 3. Generowanie zdarzeń (klienckie, z diffa stanu — warstwa mirror)
`src/supabase/notificationEvents.ts` `notificationInsertsFromDiff(prev, next,
maps, actorProfileId)` — CZYSTE, liczone z różnicy stanu PO reduktorze (odrzucona
komenda = ta sama referencja = zero zdarzeń, inwariant 6). Trzy punkty:
- (a) `task_assigned` — nowa para przypisania do OPUBLIKOWANEGO zadania;
- (b) `project_comment` — nowy komentarz projektu → uczestnicy (osoby przypisane
  do zadań projektu; lokalnie nie ma osobnej listy członków), poza autorem;
- (c) `bin_item` — nowy wiersz ZASOBNIKA (`date === BIN_DATE`) dla osoby.
Zawsze DLA INNYCH (recipient===actor pomijany → brak self-notyfikacji); (a)
dedupuje (c) dla tej samej pary (odbiorca, zadanie). Podpięte w
`CloudSyncProvider` w tym samym efekcie mirror co `diffToCloudOps` (najmniej
inwazyjne — bez przebudowy reducerów); wiersze wchodzą do kolejki jako upsert do
`notifications` (bez id → `gen_random_uuid()`). Efekt tłumi `MERGE_CLOUD_*` /
sample/reset, więc hydracja nigdy nie regeneruje zdarzeń.

### 4. Odbiór + stan (przez cloud-sync, z bezpieczną degradacją)
- `plannerData.ts` `loadNotificationsSnapshot(db, maps)` — OSOBNY loader (NIE w
  atomowym `Promise.all` planera): JAKIKOLWIEK błąd selectu / brak tabeli
  (migracja niezaaplikowana) => PUSTA lista, nigdy nie blokuje reszty syncu.
  Mapuje `recipient_id` i `payload.actorId` przez reverse osób (osoby dopasowane
  po e-mailu trzymają lokalne id ≠ chmurowe), `read_at` null → ''.
- Reduktor (`AppStore.tsx`): `MERGE_CLOUD_NOTIFICATIONS` (reference-preserving
  replace jak eventy; niepoprawny payload / zły wiersz => ta sama referencja,
  inwariant 6), `MARK_NOTIFICATION_READ` / `MARK_ALL_NOTIFICATIONS_READ`
  (nieznane id / brak nieprzeczytanych => ta sama referencja). `read_at` lustruje
  się przez diff (`cloudMirror` sekcja 8d, WYŁĄCZNIE UPDATE). `SUPPRESSED` w
  `CloudSyncProvider` rozszerzone o `MERGE_CLOUD_NOTIFICATIONS`.
- `CloudSyncProvider.runHydration`: po `MERGE_CLOUD_ENTITIES` woła loader i
  `dispatch(MERGE_CLOUD_NOTIFICATIONS)` (działa też przy live-sync w tle).

### 5. UI (slot Panelu z 249, realne dane)
- Selektor `unreadNotificationsForPerson` (nieprzeczytane, najnowsze najpierw).
- `dashboardPanels.ts`: czysty builder `notificationEntry` (polska treść
  kto/co/gdzie + cel klika; braki nazw degradują się miękko — „Ktoś”/„—”).
- `DashboardPage.tsx`: karta „Powiadomienia” pokazuje max 3 nieprzeczytane
  (`visibleNotifications`); klik w wiersz otwiera obiekt (zadanie → modal,
  projekt → `/projects/:id`) i oznacza jako przeczytane; „✓” oznacza bez
  otwierania; nagłówek ma „Oznacz wszystkie”. Zachowany layout karty; drobne CSS.

### Wiki
Zaktualizowane `openwiki/n2hub/cloud-database.md` (tabela `notifications` + RLS +
rejestr) i `state-and-persistence.md` (kolekcja + akcje + generowanie + testy).

## Zmiany

- Nowe: `supabase/migrations/20260723120000_notifications.sql`,
  `src/utils/notifications.ts`, `src/supabase/notificationEvents.ts`,
  `src/utils/notifications.test.ts`, `src/supabase/notifications.test.ts`,
  `src/store/notifications.test.ts`.
- Zmienione: `src/types.ts`, `src/store/storage.ts`, `src/store/seed.ts`,
  `src/store/AppStore.tsx`, `src/store/selectors.ts`, `src/supabase/cloudMirror.ts`,
  `src/supabase/plannerData.ts`, `src/supabase/CloudSyncProvider.tsx`,
  `src/pages/dashboardPanels.ts`, `src/pages/DashboardPage.tsx`, `src/styles.css`,
  `src/supabase/migrations.test.ts`, `src/pages/dashboardPanels.test.ts`,
  `openwiki/n2hub/cloud-database.md`, `openwiki/n2hub/state-and-persistence.md`.

## Weryfikacja

- `npm test` — **1458 przeszło (62 pliki), 0 błędów**.
- `npm run build` (`tsc --noEmit && vite build`) — **zielony** (tylko istniejące
  ostrzeżenie o rozmiarze chunku, nie błąd).
- `tsc --noEmit` osobno — czysty.
- Pokrycie nowych testów: generowanie (przypisanie/komentarz/zasobnik, brak
  self-notyfikacji, szkic pomijany, dedupe), loader graceful degradation
  (błąd/wyjątek) + mapowanie recipient/actor, mirror `read_at`, reduktor MARK_*
  + MERGE (invariant 6), repair storage, builder treści (kto/co/gdzie).

## Ryzyka / rzeczy do sprawdzenia

- **NOTA DLA OPERATORA:** migrację `20260723120000_notifications.sql` trzeba
  ZAAPLIKOWAĆ w Supabase (SQL editor lub `db push`). Do czasu aplikacji aplikacja
  działa bez regresji — loader degraduje się do pustej listy, a wstawienia
  zdarzeń są porzucane jak zwykły błąd zapisu (praca zostaje lokalnie). W ramach
  tego zadania NIE zastosowano żadnej migracji na hostowanym projekcie.
- Warstwa mailowa jest POZA zakresem (prompt 267) — celowo nie ruszona.
- „Uczestnicy projektu” = osoby przypisane do zadań projektu (brak lokalnej
  encji `project_members`); komentarz w projekcie bez zadań nikogo nie powiadomi.
- Publikacja szkicu wcześniej przypisanego: leci `bin_item` (gdy zmaterializują
  się godziny), a `task_assigned` nie (para przypisania istniała już w szkicu) —
  świadomy, minimalny wybór.
- Wstawienia są at-least-once (retry po błędzie przejściowym może zdublować
  wiersz) — akceptowalne dla powiadomień; brak deduplikacji po stronie serwera.

## Podpis schedulera

- Run: `20260723-105540-n2hub-266-notifications-inapp`
- Prompt: `266-notifications-inapp.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `f81e5197d7c18ae1630c6974ee45e33c1a1a7cb1`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `f81e5197d7c18ae1630c6974ee45e33c1a1a7cb1`
- Gałąź review: `review-integration`
- Run: `20260723-105540-n2hub-266-notifications-inapp`

### Pliki zgłoszone do review

- `openwiki/n2hub/cloud-database.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/pages/DashboardPage.tsx`
- `src/pages/dashboardPanels.test.ts`
- `src/pages/dashboardPanels.ts`
- `src/store/AppStore.tsx`
- `src/store/seed.ts`
- `src/store/selectors.ts`
- `src/store/storage.ts`
- `src/styles.css`
- `src/supabase/CloudSyncProvider.tsx`
- `src/supabase/cloudMirror.ts`
- `src/supabase/migrations.test.ts`
- `src/supabase/plannerData.ts`
- `src/types.ts`
- `handoffs/scheduler-reviews/20260723-105540-n2hub-266-notifications-inapp.md`
- `src/store/notifications.test.ts`
- `src/supabase/notificationEvents.ts`
- `src/supabase/notifications.test.ts`
- `src/utils/notifications.test.ts`
- `src/utils/notifications.ts`
- `supabase/migrations/20260723120000_notifications.sql`
