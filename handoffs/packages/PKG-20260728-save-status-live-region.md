# Handoff: Trwały kanał live-region, trzystanowy wskaźnik zapisu i jeden model zapisu

- Package ID: PKG-20260728-save-status-live-region
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium
- Codex review: required — przekrojowa zmiana dostępności (ogłoszenia w ~12 plikach), modyfikacja wspólnej powłoki modali (backdrop) i maszyny stanu zapisu; regresja byłaby cicha (czytniki ekranu), więc drugi przegląd kodu jest tani względem ryzyka.

## Goal

Jeden trwały kanał ogłoszeń dostępności (polite + assertive) zamontowany w App z deduplikacją po id; trzystanowy, nigdy nieznikający wskaźnik zapisu w powierzchniach z auto-zapisem; ujednolicone stopki (auto-zapis => bez słowa „Anuluj”); klik w tło nigdy nie zamyka modala z formularzem. BEZ toastów i bez kolejki powiadomień (decyzja właściciela).

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md` (główny — powłoka modali, SaveStatus, dirtyRegistry)
- `openwiki/n2hub/state-and-persistence.md` (kontrakt `saveData`/banerów; auto-save ~0.9 s w `useAutoSave`)
- `openwiki/n2hub/testing-and-automation.md` (konwencje testów: czysta logika w node)

## Expected touchpoints

- `new: src/utils/liveRegion.ts` — czysty moduł kanału (bez React/DOM)
- `new: src/utils/liveRegion.test.ts` — testy dedup/kanałów (środowisko node)
- `new: src/components/LiveRegionHost.tsx` — cienki host DOM (dwa trwałe węzły)
- `src/App.tsx` (montaż hosta obok `PersistenceBanner`, ~linia 451)
- `src/utils/useSaveStatus.ts` (znacznik czasu „Zapisano HH:mm”)
- `src/components/SaveStatus.tsx` (trzystanowy wskaźnik + ogłoszenia przez kanał)
- `src/components/TaskModal.tsx` (stopka ~1982–2058; nagłówek ~344)
- `src/pages/ProjectDetailPage.tsx` (~340, ~500–509)
- `src/pages/ClientsPage.tsx` (formularz edycji ~372–390)
- `src/components/modalShell.ts` + `src/components/modalShell.test.ts` (parametr `enabled` w `shouldCloseOnBackdrop`)
- `src/components/useModalShell.ts` (opcja `closeOnBackdrop`)
- `src/components/EventModal.tsx`, `src/components/TicketModal.tsx` (tylko `closeOnBackdrop: false`)
- Migracja ogłoszeń (drop `role="status"` + `announce()`): `src/components/PersistenceBanner.tsx:141`, `src/components/CloudSyncBanner.tsx:67,85`, `src/components/SampleBanner.tsx:24`, `src/pages/TeamPage.tsx:447`, `src/pages/AccountPage.tsx:201`, `src/pages/PersonProfilePage.tsx:707,752`, `src/onboarding/OnboardingRoot.tsx:476`

## Invariants

- Nieudany zapis NIGDY nie raportuje „Zapisano”; stan `error` z `useSaveStatus` pozostaje trwały aż do udanego zapisu (obecne zachowanie `persistFailed`, `useSaveStatus.ts:75–79`).
- Konflikty kart w tej samej przeglądarce pozostają jawne — banery `PersistenceBanner` (error/conflict, `role="alert"`) renderują się i działają bez zmian treści/akcji.
- NIE zmieniać, CO auto-zapis utrwala ani KIEDY (bez dotykania `useAutoSave`, reduktorów, `storage.ts`, `persistGate`/retirement — tryb retirement pozostaje wyłączony).
- Escape nadal woła `onRequestClose` modala z istniejącym strażnikiem brudnego stanu (`TaskModal.requestClose`, `EventModal` ~157); zamykanie przyciskami bez zmian.
- `ConfirmProvider` i `ChangelogModal` ZACHOWUJĄ zamykanie tłem (tło = anulowanie pytania — udokumentowane w wiki).
- Zero nowych zależności runtime; wszystkie nowe stringi po polsku; brak widocznych toastów.
- Nie ruszać trwałych regionów stron: `KanbanPage.tsx:793`, `WeekView.tsx:2240` (stability-sensitive, inwariant 7 CLAUDE.md), `CalendarPage.tsx:116–124` (trwała widoczna etykieta), `OnboardingRoot.tsx:700`, `AuthScreens.tsx:26` (ekran logowania poza powłoką App — host tam nie istnieje).
- Warunkowe `role="alert"` ZOSTAJĄ (alert ogłasza się przy wstawieniu do DOM zgodnie z ARIA): banery błędu/konfliktu w PersistenceBanner, `save-blockers` w TaskModal (~1983), podsumowania w Event/TicketModal.

## Scope

### 1. Kanał live-region (decyzje rozstrzygnięte — implementować tak)

`src/utils/liveRegion.ts` — czysty moduł, wzorzec `dirtyRegistry` (singleton modułowy, bez kontekstu Reacta; `useAnnounce` NIE powstaje — komponenty importują `announce` bezpośrednio i wołają w efektach):

```ts
export type LiveTone = 'polite' | 'assertive';
export interface LiveMessage { id: string; text: string; tone: LiveTone }
export interface LiveSnapshot {
  polite: { id: string; text: string; seq: number } | null;
  assertive: { id: string; text: string; seq: number } | null;
}
export function createLiveAnnouncer(): {
  announce(msg: LiveMessage): boolean;   // false = zdeduplikowane no-op
  snapshot(): LiveSnapshot;              // no-op zwraca TĘ SAMĄ referencję
  subscribe(listener: () => void): () => void;
};
export const liveAnnouncer = createLiveAnnouncer();
export const announce = liveAnnouncer.announce;
```

Dedup po id: `announce` z tym samym `(id, text, tone)` co aktualna zawartość kanału ⇒ no-op (zwraca `false`, snapshot zachowuje referencję — styl inwariantu 6). Ten sam `id` z NOWYM tekstem ⇒ podmiana treści kanału (jeden najnowszy komunikat per kanał, `seq++`). Inny `id` ⇒ podmiana. Auto-zapis co ~900 ms aktualizuje więc istniejący wpis zamiast tworzyć nowy; identyczny tekst („Zapisano 20:51” w tej samej minucie) nie jest ponawiany.

`src/components/LiveRegionHost.tsx` — dwa ZAWSZE zamontowane węzły `.sr-only` (klasa istnieje w styles.css): polite `role="status" aria-live="polite" aria-atomic="true"`, assertive `role="alert" aria-live="assertive" aria-atomic="true"`. Subskrypcja przez `useSyncExternalStore(liveAnnouncer.subscribe, liveAnnouncer.snapshot)`. Montaż RAZ w `App.tsx` tuż przed `<PersistenceBanner />` (region istnieje w DOM zanim zmieni się treść).

### 2. Trzystanowy wskaźnik zapisu (S5)

`useSaveStatus`: dodaj `savedAtLabel: string | null` — ustawiane w momencie przejścia transient → `'saved'` przez eksportowany czysty helper `formatSavedAt(now: Date): string` (date-fns `format(now, 'HH:mm')`); NIGDY nie czyszczone do odmontowania. Timery/semantyka stanów bez zmian.

`SaveStatus.tsx`: props `{ status, savedAtLabel?, announceId?, blocked? }`. Rendering (usuń `role="status"` ze wszystkich wariantów — linie 42/50/57/64):
- `dirty` + `blocked`: obecny klikalny przycisk bez zmian;
- `dirty`: ikona + „Niezapisane zmiany”;
- `saving`: „Zapisywanie…”;
- `saved` LUB (`clean` i `savedAtLabel`): Check + „Zapisano 20:51” (wskaźnik po pierwszym zapisie już nie znika);
- `clean` bez `savedAtLabel`: `null`;
- `error`: „Nie zapisano” (trwałe jak dziś).
Ogłoszenia: efekt na `(status, savedAtLabel)` woła `announce({ id: announceId, ... })` — `dirty`/`saving`/`saved` tonem `polite` (tekst „Zapisano HH:mm”), `error` tonem `assertive` („Nie zapisano — zmiany nie zostały utrwalone.”). Bez `announceId` komponent jest czysto wizualny (nie ogłasza).

Konsumenci: TaskModal (`announceId: 'save:task-modal'`, nagłówek ~344), ProjectDetailPage (`'save:project'`, ~340), ClientsPage (nowe użycie, `'save:client'`).

### 3. Jeden model zapisu (SY-15/16)

- TaskModal (edycja, auto-zapis): usuń statyczny hint ~2014–2018; przycisk główny „Zapisz i zamknij” → „Gotowe” (ten sam handler `handleSave`); przycisk zamykający ZAWSZE „Zamknij” w trybie edycji (koniec przełączania na „Anuluj”, linia 2057). Tryb tworzenia (zapis ręczny) zachowuje „Utwórz zadanie”/„Utwórz szkic”/„Opublikuj” + „Anuluj”.
- ProjectDetailPage (auto-zapis): usuń hint ~502–504; „Zapisz teraz” zostaje (jawny flush, nie „Anuluj”); wskaźnik w nagłówku dostaje `savedAtLabel`.
- ClientsPage (edycja, auto-zapis): wepnij `useSaveStatus` (dirty draftu edycji; `persistFailed` z `usePersistence().saveError !== null` jak w TaskModal:252) + `markSaved` w ścieżce udanego zapisu; hint warunkowy ~381–385 zastąp `<SaveStatus>`; komunikat „Auto-zapis wstrzymany…” zostaje widoczny jako zwykły hint BEZ `role="status"` + `announce` polite. Przycisk „Zamknij” (386–388) bez zmian; „Anuluj” formularza TWORZENIA (~346, zapis ręczny) bez zmian.
- Event/TicketModal (zapis ręczny): stopki już zgodne („Zapisz zmiany”/„Anuluj”) — nie ruszać etykiet.
- Backdrop: `shouldCloseOnBackdrop(pointerDown, click, enabled = true)` w `modalShell.ts` (trzeci parametr, domyślnie `true` — zachowanie dotychczasowych wywołań bez zmian); `useModalShell` przyjmuje `closeOnBackdrop?: boolean` (domyślnie `true`) i przy `false` para pointerdown+click w tło jest ignorowana. `TaskModal`, `EventModal`, `TicketModal` przekazują `closeOnBackdrop: false`. Escape/przyciski działają jak dotąd.

### 4. Migracja warunkowych `role="status"` (mechanika ogłaszania, widoczność bez zmian)

Reguła: element montowany warunkowo RAZEM ze swoim komunikatem traci `role="status"`, a jego tekst idzie przez `announce()` (polite) w efekcie montującym/zmieniającym treść. Lista wykonawcza (zweryfikowana): `PersistenceBanner.tsx:141` (id `'persistence'`), `CloudSyncBanner.tsx:67,85` (`'cloud-sync'`), `SampleBanner.tsx:24` (`'sample-banner'`), `TeamPage.tsx:447` (`'team-provision'`), `AccountPage.tsx:201` (`'account'`), `PersonProfilePage.tsx:707,752` (`'person-profile'`), `OnboardingRoot.tsx:476` (`'onboarding'`; widoczny toast zostaje, traci `role`/`aria-live`). Punkt 4 zadania (trwała ścieżka „Nie zapisano” + akcja ponowienia) jest JUŻ zrealizowany: `PersistenceBanner.tsx:72–92` („Spróbuj ponownie” = `retryPersist` + eksport kopii, `role="alert"`); etykiety NIE zmieniamy.

## Out of scope

- Toasty, kolejka powiadomień, jakiekolwiek nowe widoczne powierzchnie.
- Zmiany w `useAutoSave`, reduktorach, `storage.ts`, `persistGate`, cloud mirror; zmiana treści/akcji banerów error/conflict.
- `KanbanPage`/`WeekView`/`CalendarPage`/`OnboardingRoot:700`/`AuthScreens` regiony wymienione w niezmiennikach.
- `ConfirmProvider`, `ChangelogModal`, `GlobalSearch`, `OnboardingRoot` — zachowanie zamykania bez zmian.
- Zmiana etykiety „Spróbuj ponownie” na „Ponów”.

## Acceptance

- [ ] Dwa trwałe węzły live-region istnieją w DOM powłoki od pierwszego renderu App (przed jakąkolwiek zmianą treści) i są jedynym kanałem ogłoszeń dla zmigrowanych komunikatów.
- [ ] `liveRegion.test.ts`: no-op dedup `(id, text, tone)` zwraca `false` i TĘ SAMĄ referencję snapshotu; ten sam id z nowym tekstem podmienia wpis (jeden komunikat per kanał); kanały polite/assertive niezależne; subscribe powiadamia tylko przy realnej zmianie.
- [ ] Edytor zadania (edycja): wskaźnik przechodzi „Niezapisane zmiany” → „Zapisywanie…” → „Zapisano HH:mm” i po pierwszym zapisie nigdy nie znika; przycisk główny to „Gotowe”, obok wyłącznie „Zamknij”; słowo „Anuluj” nie występuje w żadnej powierzchni z auto-zapisem (TaskModal-edycja, ProjectDetailPage-edytor, ClientsPage-edycja).
- [ ] Nieudany zapis: wskaźnik trwale „Nie zapisano” (ton assertive), baner błędu z „Spróbuj ponownie” bez regresu; żadna ścieżka nie pokazuje „Zapisano” po nieudanym zapisie.
- [ ] Klik (pointerdown+click) w tło TaskModal/EventModal/TicketModal NIE zamyka modala niezależnie od brudności; Escape nadal pyta o niezapisane zmiany; ConfirmProvider nadal anuluje tłem (`modalShell.test.ts` pokrywa parametr `enabled`).
- [ ] W zmigrowanych plikach nie ma warunkowo montowanego `role="status"`; widoczne bannery pozostają widoczne; `grep 'role="status"' src` zwraca tylko trwałe regiony z listy niezmienników + host.
- [ ] Wszystkie nowe stringi po polsku; zero nowych zależności w `package.json`.

## Verification

- Worker: `npx vitest run src/utils/liveRegion.test.ts src/components/modalShell.test.ts src/utils/useSaveStatus* 2>/dev/null || npx vitest run src/utils/liveRegion.test.ts src/components/modalShell.test.ts` (plus każdy istniejący test dotkniętego pliku, który vitest wykryje po nazwie).
- Browser: none — żaden z pięciu release-checków nie pokrywa zamykania tłem ani wskaźnika zapisu; `browser-check-date-hardening.mjs` steruje polami TaskModala, nie tłem (uruchomić tylko, gdyby zmiana naruszyła jego selektory).
- Scheduler owns final `npm test && npm run build`.

## Prior decisions

- Właściciel: BRAK toastów i kolejki powiadomień — wyłącznie live regions + istniejące trwałe bannery.
- API kanału: singleton modułowy (wzorzec `dirtyRegistry`), bez kontekstu Reacta i bez hooka `useAnnounce`; jeden najnowszy komunikat per kanał; dedup po `(id, text, tone)`.
- Znacznik czasu: date-fns `format(now, 'HH:mm')` w eksportowanym `formatSavedAt` (czysty, testowalny w node).
- „Ponów” = istniejące `retryPersist` („Spróbuj ponownie”) w PersistenceBanner — już zrealizowane, bez zmian.
- Warunkowe `role="alert"` pozostają (ogłaszają się przy wstawieniu do DOM); migrujemy wyłącznie warunkowe `role="status"`.
- Domyślna wartość `closeOnBackdrop` to `true` (Confirm/Changelog bez zmian); formularzowe modale jawnie wyłączają.
- Wiki: po zielonym wyniku strona `ui-navigation-and-onboarding.md` będzie nieaktualna w punktach „zamknięcie tłem przy parze pointerdown+click” (powłoka modali) i opisie `SaveStatus`/hintu auto-zapisu — decyzję o aktualizacji podejmuje finalny reviewer.
