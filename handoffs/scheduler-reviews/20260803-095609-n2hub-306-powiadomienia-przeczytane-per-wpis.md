# Raport workflow: 20260803-095609-n2hub-306-powiadomienia-przeczytane-per-wpis

## Wykonane

Analiza wstępna potwierdziła, że model watermarka nadal był w buildzie
(`MARK_NOTIFICATIONS_SEEN` ustawiał `Person.notificationsSeenAt`, feed oznaczał
się w całości), więc zadanie zrealizowano. Trasa tier: architect → developer →
reviewer (werdykt: approve, bez blokerów).

Zmiana modelu „przeczytane" na stan per-wpis, z watermarkiem zachowanym jako
kompatybilność wsteczna (wpis jest przeczytany, gdy `createdAt <=
notificationsSeenAt` LUB jego id jest w zbiorze):

1. **Model danych**: nowe addytywne pole `Person.notificationsReadIds?: string[]`
   (klucz kanonicznie obecny tylko gdy zbiór niepusty; `DATA_VERSION` zostaje 7).
   Id wpisów to istniejące stabilne id pochodnego feedu
   (`mention:<commentId>` / `assignment:<assignmentId>`).
2. **Reduktor**: nowa akcja `MARK_NOTIFICATION_ENTRY_READ` z guardami
   inwariantu 6 (brak usera, puste/nieznane id, wpis już przeczytany => ta sama
   referencja stanu). Przycisk zbiorczy `MARK_NOTIFICATIONS_SEEN` zostaje i
   dodatkowo czyści zbiór (pruning — watermark pokrywa wszystko).
3. **Persystencja**: sanityzacja w `migratePerson` (niepuste stringi, dedupe,
   cap 500, bez echo-write); merge chmurowy `applyCloudPeople` robi monotoniczną
   unię zbiorów z fail-closed walidacją wiersza i zachowaniem referencji osoby
   przy wartościowej równości; hydracja/push przez `referenceData.ts`
   (`notifications_read_ids` w select i payloadzie) i `cloudMirror.ts`.
4. **Migracja SQL (NIE zaaplikowana)**:
   `supabase/migrations/20260803100000_profiles_notifications_read_ids.sql` —
   addytywna, idempotentna kolumna `core.profiles.notifications_read_ids text[]
   not null default '{}'` + odtworzenie widoku-mostka `n2click.profiles`
   (`security_invoker = on`, zgodnie z definicją z migracji 20260731082129).
5. **UI (DashboardPage)**: tick `Check` „Oznacz jako przeczytane" przy każdym
   nieprzeczytanym wpisie (rodzeństwo przycisku rozwijania, aria-label,
   powiększona hit-area ~36 px); przeczytany wpis nie znika — zostaje wyszarzony
   (istniejące reguły `is-unread`); otwarcie encji z podglądu oznacza tylko ten
   wpis; przycisk zbiorczy bez zmian wizualnych.
6. **Licznik**: kafelek i badge karty (tab title) liczą z jednego źródła —
   nowego selektora `unreadNotificationCountForPerson` na feedzie pochodnym.
   Badge liczył dotąd z uśpionej kolekcji `state.notifications` (rozjazd
   źródeł) — przełączony; sama uśpiona kolekcja i jej reduktory nietknięte.

Wiki zaktualizowane: `openwiki/n2hub/state-and-persistence.md` (dwa systemy
powiadomień, model watermark OR zbiór, pruning, guardy) i
`openwiki/n2hub/cloud-database.md` (kolumna `notifications_read_ids`,
odtworzenie widoku). Werdykt reviewera: `wiki updated`.

## Zmiany

- `src/types.ts`, `src/store/AppStore.tsx`, `src/store/selectors.ts`,
  `src/store/storage.ts` — model, akcja, merge, sanityzacja.
- `src/supabase/referenceData.ts`, `src/supabase/cloudMirror.ts` — hydracja/push.
- `src/pages/DashboardPage.tsx`, `src/styles.css`, `src/App.tsx`,
  `src/utils/tabBadge.ts` — UI ticka, wyszarzenie, jedno źródło licznika.
- `supabase/migrations/20260803100000_profiles_notifications_read_ids.sql` — nowy.
- Testy: `notifications.test.ts`, `storage.test.ts`, `cloudMerge.test.ts`,
  `tabBadge.test.ts`, `referenceData.test.ts`, `cloudMirror.test.ts`,
  `migrations.test.ts`.
- Wiki: `state-and-persistence.md`, `cloud-database.md`; log `handoffs/RUN-STATE.md`.

## Weryfikacja

- Focused (7 plików testowych pakietu): 378 passed, 0 failed.
- Pełne `npm test`: 107 plików, **2243/2243 passed** (developer; potwierdzone
  niezależnie przez reviewera).
- `npm run build` (`tsc --noEmit && vite build`): zielony.
- Gate (`npm test && npm run build`): oczekuje na scheduler.

## Ryzyka / rzeczy do sprawdzenia

- **Kolejność wdrożenia (operacyjne)**: migrację `20260803100000` trzeba
  zaaplikować do bazy PRZED wdrożeniem tego klienta — select w
  `referenceData.ts` nazywa kolumnę `notifications_read_ids` wprost (42703 na
  starej bazie). Migracja NIE została zaaplikowana (zgodnie z zadaniem).
- Push profilu nadpisuje całą tablicę (LWW na wierszu chmurowym): wyścig dwóch
  urządzeń może przejściowo zgubić id na serwerze do czasu ponownego pusha po
  unii przy załadowaniu; klasa ryzyka identyczna jak istniejące pola profilu,
  merge klienta pozostaje monotoniczny — bez regresu lokalnego.
- Unia w merge (in-memory) nie ma capu 500 (cap jest w storage i hydracji) —
  wrogi payload mógłby przejściowo przekroczyć limit do następnego load;
  kosmetyczne, ograniczone walidacją.
- Wyszarzenie przeczytanych korzysta z istniejącej reguły (waga 700→500 +
  `--text-muted`); ewentualne wzmocnienie kontrastu zostawiono do przeglądu
  wizualnego na urządzeniu.

## Podpis schedulera

- Run: `20260803-095609-n2hub-306-powiadomienia-przeczytane-per-wpis`
- Prompt: `306-powiadomienia-przeczytane-per-wpis.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `4c8059e16e16d22504d87a6dbf1c9fdcda321eb1`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `4c8059e16e16d22504d87a6dbf1c9fdcda321eb1`
- Gałąź review: `review-integration`
- Run: `20260803-095609-n2hub-306-powiadomienia-przeczytane-per-wpis`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/cloud-database.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/App.tsx`
- `src/pages/DashboardPage.tsx`
- `src/store/AppStore.tsx`
- `src/store/cloudMerge.test.ts`
- `src/store/notifications.test.ts`
- `src/store/selectors.ts`
- `src/store/storage.test.ts`
- `src/store/storage.ts`
- `src/styles.css`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `src/supabase/migrations.test.ts`
- `src/supabase/referenceData.test.ts`
- `src/supabase/referenceData.ts`
- `src/types.ts`
- `src/utils/tabBadge.test.ts`
- `src/utils/tabBadge.ts`
- `handoffs/scheduler-reviews/20260803-095609-n2hub-306-powiadomienia-przeczytane-per-wpis.md`
- `supabase/migrations/20260803100000_profiles_notifications_read_ids.sql`
