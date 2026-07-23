# Raport workflow: 20260723-122307-n2hub-269-notifications-hardening

## Wykonane

Workflow tier: analiza orkiestratora potwierdziła, że wszystkie 4 punkty audytu
262–268 nadal występują w bieżącym buildzie; trasa `developer → reviewer`
(dekompozycja była już zadana przez audyt, testy nierozdzielne od implementacji).
Reviewer po jednej rundzie poprawek (docs) wydał werdykt APPROVED (A–D: pass).

- **Item A (krytyczny)** — `applyCloudOps` (`src/supabase/cloudMirror.ts`):
  op na tabeli `notifications` jest teraz best-effort — KAŻDY błąd (transient
  i permission, w tym `42P01`/`PGRST205` przy niezaaplikowanej migracji)
  porzuca op cicho (debug-log tylko w DEV), nie trafia do listy `dropped`
  (brak banera) i nie zatrzymuje przetwarzania opów pozostałych encji.
  `classifyWriteError` i zachowanie dla encji planera pozostały nietknięte —
  zatrzymanie na transient dla planera działa jak dotąd (regression guard w teście).
- **Item B (poważny)** — `supabase/functions/send-notification-emails/index.ts`:
  odwrócenie na **claim-before-send** — jeden UPDATE stempluje `emailed_at`
  (`.in('id', batchIds).is('emailed_at', null).select(...)`) PRZED jakąkolwiek
  wysyłką; maile idą wyłącznie do skutecznie zaclaimowanych wierszy. Awaria po
  claimie = co najwyżej brak jednego maila, nigdy hurtowe duplikaty; nakładające
  się wywołania crona dostają rozłączne podzbiory. Zaclaimowane wiersze są
  ponownie sortowane wg kolejności `batchIds` (oldest-first w treści maila).
  Czysta logika `claimBatchIds` w `contract.ts` + testy. README funkcji nie
  istnieje w repo (punkt promptu „README funkcji" bezprzedmiotowy).
- **Item C (drobny)** — `loadNotificationsSnapshot` (`src/supabase/plannerData.ts`)
  zwraca teraz unię `{available:true, notifications}` / `{available:false}`:
  brak tabeli (42P01/PGRST205/schema-cache) degraduje do pustej listy (merge
  jedzie), błąd przejściowy zwraca `available:false` i `CloudSyncProvider`
  NIE dispatchuje `MERGE_CLOUD_NOTIFICATIONS` — panel zachowuje poprzedni stan,
  koniec migania do pusta przy blipie sieci.
- **Item D (drobny UX)** — `findFreeStart` (`src/utils/time.ts`): w gałęzi
  `requireNoTouch` doszły kandydaci „krok siatki (15 min) ZA końcem dotykanego
  bloku" oraz symetrycznie przed jego startem (z clampem ≥ 0). Blok 09:00–11:00 +
  „Zaplanuj część" proponuje teraz 11:15 zamiast 00:00. Ścieżki bez `avoidTouch`
  i bez dotyku pozostały bajtowo identyczne; semantyka merge/kolizji z 262 bez zmian.
- **Wiki**: `openwiki/n2hub/cloud-database.md` zaktualizowana (kontrakt
  `{available}` loadera powiadomień + claim-before-send w funkcji mailowej) —
  werdykt reviewera: `wiki updated`.

## Zmiany

- `src/supabase/cloudMirror.ts` — best-effort dla opów `notifications` w `applyCloudOps`
- `src/supabase/plannerData.ts` — `NotificationsSnapshotResult` + `MISSING_TABLE_RE`
- `src/supabase/CloudSyncProvider.tsx` — warunkowy dispatch merge'a powiadomień
- `src/utils/time.ts` — kandydaci za/przed dotykaną krawędzią w `findFreeStart`
- `supabase/functions/send-notification-emails/index.ts` — claim-before-send + sort
- `supabase/functions/send-notification-emails/contract.ts` — `claimBatchIds` + doc
- `openwiki/n2hub/cloud-database.md` — korekta dokumentacji (docs-only)
- Testy: `src/supabase/cloudMirror.test.ts` (3 nowe), `src/supabase/notifications.test.ts`
  (2 nowe + 4 przekształcone), `src/supabase/notificationEmails.test.ts` (claim),
  `src/utils/time.test.ts` (stara asercja `0` zastąpiona — była wadą, nie kontraktem)

Zero nowych migracji, zero zmian RLS/schematu. Brak commitów (kontrakt schedulera).

## Weryfikacja

- `npm test`: 64 pliki, 1492 testy — **zielone** (uruchamiane 3×: developer,
  reviewer w pierwszej rundzie i ponownie po delcie).
- `npm run build`: `tsc --noEmit` + vite — **zielony** (jedyne ostrzeżenie:
  istniejący wcześniej chunk > 500 kB). Późniejsza delta dotknęła wyłącznie
  pliku Deno i wiki (poza zakresem tsc/vite).
- Reviewer (read-only): werdykt **APPROVED**, kryteria A–D pass z dowodami
  plik:linia, brak scope-creep, stringi po polsku.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Edge Function (`index.ts`) to plik Deno — poza zasięgiem tsc/vitest; łańcuch
  PostgREST claima (`.update().in().is().select()`) zweryfikowany review'em
  kodu, nie wykonaniem. Czysta logika (`contract.ts`) jest pokryta testami.
  Po deploy'u funkcji warto raz obejrzeć logi crona.
- `MISSING_TABLE_RE` łapie też ogólne „does not exist" (np. brakująca kolumna) —
  świadoma, akceptowalna degradacja do pustej listy (rodzina PGRST204).
- Item D: kandydat „przed startem" jest w praktyce zdominowany przez kandydatów
  z końców bloków — zaimplementowany dla symetrii wg specyfikacji, nieszkodliwy
  (gałąź wyłącznie pod `requireNoTouch`).

## Podpis schedulera

- Run: `20260723-122307-n2hub-269-notifications-hardening`
- Prompt: `269-notifications-hardening.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `d58d1ac2e1aa7f9c22b8efe7fd3ab30856ea035e`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `d58d1ac2e1aa7f9c22b8efe7fd3ab30856ea035e`
- Gałąź review: `review-integration`
- Run: `20260723-122307-n2hub-269-notifications-hardening`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/cloud-database.md`
- `src/supabase/CloudSyncProvider.tsx`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `src/supabase/notificationEmails.test.ts`
- `src/supabase/notifications.test.ts`
- `src/supabase/plannerData.ts`
- `src/utils/time.test.ts`
- `src/utils/time.ts`
- `supabase/functions/send-notification-emails/contract.ts`
- `supabase/functions/send-notification-emails/index.ts`
- `handoffs/scheduler-reviews/20260723-122307-n2hub-269-notifications-hardening.md`
