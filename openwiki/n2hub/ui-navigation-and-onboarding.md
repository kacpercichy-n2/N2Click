# UI, navigation and onboarding

## Boundaries

- `src/App.tsx` owns routing, shell-level overlays and current-user navigation.
  `src/main.tsx` hosts the data router (`createBrowserRouter`) that App's
  `useBlocker` dirty-navigation guard requires.
- `src/auth/` owns the login gate. Mode is decided once at startup (local vs
  Supabase). Local mode (no/invalid Supabase config) keeps the demo person-picker
  `src/pages/LoginPage.tsx` and the `currentUserId` gate. Supabase mode gates the
  whole shell behind a real `supabase.auth` session (`SessionProvider` + pure
  `session.ts` state machine): loading → email/password login → forced first-
  password change (`profiles.must_change_password`, pure `passwordChange.ts`,
  fail-open) → local-profile association → shell. Every ready org snapshot is
  merged into the local people list (`buildCloudPeoplePayload` in
  `supabase/referenceData.ts` → `MERGE_CLOUD_PEOPLE` dispatched from App):
  RLS-visible cloud profiles upsert local `Person` rows by email (new rows get
  the cloud profile UUID as id, so planner hydration maps them), cloud is the
  truth for profile fields incl. access role/capacity/work days/supervisor;
  local-only people are never deleted and local departmentId/passwordHash are
  kept. The blocked screen remains only for the edge case of
  a session without a cloud profile row. The `/account` „Ustawienia” panel + nav
  link (gear icon; Administracja uses `ShieldCheck`) is available in BOTH modes —
  it always shows the „Interfejs” section (device-local sidebar menu-order editor,
  `UiPrefs.navOrder`, pure `orderNavPaths` in `src/components/navItems.ts`, reactive
  via the `'n2hub:nav-order-changed'` window event) and, in Supabase mode only, the
  self-service password change. Impersonation („Występuj jako”) was removed
  entirely (UI switcher/banner, `IMPERSONATE`/`STOP_IMPERSONATION`,
  `AppData.impersonatorId`, `users.impersonate`); the sidebar footer avatar now
  links to the user's own profile (`/people/<own id>`). Identity association is by
  email only (planner data references local
  person ids). In Supabase mode the authenticated profile, department, access role
  and team visibility are READ from Supabase (RLS output is authoritative) via
  `src/supabase/OrgDataProvider.tsx` + pure `src/supabase/referenceData.ts`
  (`loadOrgSnapshot`, `effectiveAccessRole`); never from JWT/metadata. While that
  snapshot loads, on error, or in local mode, the local
  `Person` role is the fallback. Cloud statuses/service types/work categories are
  loaded and displayed (TeamPage cloud hierarchy
  — incl. `profiles.supervisor_id` shown as `Przełożony:` and editable inline by
  a cloud administrator (server truth: RLS + profile-privileges trigger) —,
  AdminPage `Słowniki w chmurze`), but the planner still renders/mutates the LOCAL
  localStorage dictionaries until the data-write migration. Local mode is
  byte-for-byte unchanged (no client created). Client-side only; UX gate, not a
  security boundary. `SessionProvider` then `OrgDataProvider` wrap the router in
  `main.tsx`.
- `src/pages/` owns route-specific screens; `src/components/TaskModal.tsx` owns
  task editing and its allocation grid. Powody blokujące zapis zadania są czyste
  i testowane osobno (`src/components/taskSaveBlockers.ts`,
  `collectTaskSaveBlockers` + `taskSaveBlockers.test.ts`): `formValid` = pusta
  lista, a nieudany zapis MUSI dać skutek — skacze do pierwszego złego pola
  (kotwice `t-title`/`t-project`/`t-status`/`t-start`/`t-end`/`t-assignees`),
  wypisuje powody w sticky stopce edytora i udostępnia je klikalnej odznace
  zapisu (`SaveStatus` prop `blocked`). Widoczność błędu podąża za wspólnym
  modelem czasowym (patrz kontrakt pola niżej): pierwsza walidacja na blur albo
  przy próbie zapisu, potem żywa rewalidacja tylko dla pól, które już raz
  pokazały błąd; sekcja „Cykliczność” rządzi się tą samą zasadą względem
  własnej edycji.
- Profile edit matrix (`src/pages/profileEditPolicy.ts`) gains an ADMIN-ONLY
  „Spółka” field (`companyId` in `ALL_FIELDS` only — nie self, nie manager),
  rendered as a select in PersonProfilePage next to „Dział”; parity with the
  server `app.protect_profile_privileges` trigger (spółka zawęża widoczność
  projektów w chmurze). AdminPage adds a „Spółki” CRUD section after „Działy”.
- `/zgloszenia` („Zgłoszenia”, `src/pages/TicketsPage.tsx`) jest widoczne dla
  KAŻDEJ roli — nie jest bramkowane jak `/admin`. Dwa tryby w segmentowanym
  przełączniku: „Zgłoś” (otwiera modal) i „Zgłoszone” (tabela z filtrami status +
  rodzaj, sort od najnowszych, rozwijany opis). Bez `tickets.manage` widać
  wyłącznie własne wiersze; z nim dochodzi inline status, usuwanie i eksport CSV
  (serializer: `src/pages/ticketsExport.ts`). `src/components/TicketModal.tsx`
  powiela wzorzec TaskModal: `?zgloszenie=new|<id>`, `useOpenTicket()`, montaż raz
  w App, klasy `.task-modal-*` i własny zakres strażnika nawigacji
  (`'ticket-modal'` w `dirtyRegistry.ts`).
- `/wydarzenia` („Wydarzenia”, ikona `CalendarClock`, w NAV po `/calendar`,
  `src/pages/EventsPage.tsx`) jest widoczne dla KAŻDEJ roli. Segmentowany
  przełącznik „Nadchodzące” (domyślny; `date >= dziś`) / „Minione”, sort po
  `(date, startMinutes)`; wiersz pokazuje datę, zakres godzin, tytuł, uczestników
  (albo „Ogólnofirmowe”), lokalizację, badge „Cykliczne: …" oraz link „Dołącz"
  renderowany jako `href` WYŁĄCZNIE gdy `normalizeProjectDocumentUrl` przepuści.
  Klik wiersza otwiera modal; „+ Dodaj wydarzenie" przy `events.manage`.
  `src/components/EventModal.tsx` powiela wzorzec TaskModal: `?wydarzenie=new|<id>`,
  `useOpenEvent()`, montaż raz w App, prefill rozłącznymi parametrami
  (`wydarzenieData`/`wydarzenieStart`/`wydarzenieOsoba` — celowo różne od
  `date`/`assignee` TaskModala), własny zakres strażnika nawigacji
  (`'event-modal'`, warunek `wydarzenieChanged` w `navGuardBlocks`). Zapis ręczny
  przyciskiem (bez auto-save). Prawy klik w pustą kolumnę WeekView oferuje
  „+ Dodaj spotkanie (HH:mm)" przy `events.manage` (obok „+ Dodaj zadanie").
- Badge karty przeglądarki (favicon + `document.title` z licznikiem
  nieprzeczytanych powiadomień): czysta logika w `src/utils/tabBadge.ts`
  (etykiety `1–9`/`9+`, licznik, applier apply/restore — testowane w node),
  cienka warstwa DOM/canvas tamże, hook `src/utils/useTabBadge.ts` wpięty RAZ w
  `App()` przed bramkami logowania. Licznik = te same dane co karta
  „Powiadomienia” (`readAt === ''`, odbiorca = zalogowany); 0 => przywrócenie
  oryginalnej karty. `index.html` nie deklaruje `<link rel="icon">` — host
  tworzy własny link i usuwa go przy zeru.
- `src/onboarding/catalog.ts` owns copy, roles and route mapping; components
  expose stable `data-tour` anchors only.
- Powłoka modali (TaskModal, TicketModal, EventModal, ChangelogModal) jest
  WSPÓLNA: czysta logika w `src/components/modalShell.ts`
  (`resolveInitialFocusIndex` / `resolveTrapAction` / `shouldCloseOnBackdrop` /
  `scrollbarCompensation` / `createScrollLockCounter` + `modalShell.test.ts` w
  node), cienka warstwa DOM w hooku `src/components/useModalShell.ts`. Hook daje
  fokus startowy (`data-autofocus` → pierwszy w cyklu Tab → karta), pułapkę Tab,
  POWRÓT fokusa na element sprzed otwarcia (każda ścieżka zamknięcia), Escape
  wołający `onRequestClose` modala (pytanie o niezapisane zmiany zostaje w
  modalu), blokadę scrolla ze WSPÓLNYM licznikiem + kompensacją paska oraz
  zamknięcie tłem dopiero przy parze `pointerdown` + `click` na tle (zaznaczanie
  tekstu wyprowadzone z karty nie kasuje edycji). Nazwa dialogu idzie z
  `aria-labelledby` na widoczny `<h1 class="task-modal-title">` (`useId`).
  `OnboardingRoot` i `GlobalSearch` mają własną obsługę i NIE korzystają z hooka.
- Potwierdzenia są WSPÓLNE i NIE używają `window.confirm`: czysta logika w
  `src/components/confirmDialog.ts` (kolejka FIFO `enqueueConfirm` /
  `resolveConfirm` — drugie pytanie czeka na rozstrzygnięcie pierwszego,
  nieznane `id` zwraca TĘ SAMĄ referencję, więc obietnica nie rozstrzyga się
  dwa razy; `drainConfirms` na odmontowaniu; bramka `confirmIsBlocked`
  (`requireAck`); budowniczy treści skutków `buildDeleteConsequence` —
  „To usunie 3 przypisania i 24,5 zaplanowanej godziny.”, forma „To usunie …”
  celowo omija uzgodnienie rodzaju/liczby czasownika; wspólna odmiana w
  `src/utils/polishPlural.ts` — `polishCount`/`polishAmount`, ułamek bierze
  dopełniacz l. poj.; testy `confirmDialog.test.ts` w node). Cienka warstwa
  React/DOM w `src/components/ConfirmProvider.tsx`: `useConfirm()` zwraca
  `(opcje) => Promise<boolean>`, dostawca montuje się RAZ w `main.tsx` PONAD
  `AppStoreProvider` (niczego nie czyta) i renderuje DOKŁADNIE jeden
  `role="alertdialog"` przez `useModalShell` — fokus startowy na „Anuluj”
  (`data-autofocus`), Escape i tło = anulowanie, `aria-describedby` na zdaniu o
  skutkach, czerwień (`.btn.danger`) TYLKO na przycisku niszczącym, `--n2-z-confirm`
  = 1200 (ponad banerem 1050 i samouczkami 1100). `useModalShell` zyskało dwie
  opcje: `role` oraz `stacked` (nasłuch klawiatury w fazie CAPTURE +
  `stopPropagation` na Escape/Tab), dzięki czemu dialog nad TaskModalem/
  EventModalem nie zamyka modala pod spodem i nie oddaje mu fokusa; licznik
  blokady scrolla jest wspólny, więc nałożenie nie odblokowuje strony.
  `requireAck` (checkbox) tylko tam, gdzie NAPRAWDĘ giną dane (kaskada klienta/
  projektu, usunięcie zadania lub osoby z godzinami) — NIGDY przy „porzucić
  niezapisane zmiany”. JEDYNY świadomy wyjątek to
  `src/components/ErrorBoundary.tsx`: ekran awarii zostaje przy natywnym
  `window.confirm`, bo renderuje się dopiero po wysypce drzewa, a ta sama klasa
  jest zamontowana także PONAD dostawcą (`browser-check-date-hardening.mjs`
  nadal steruje tam natywnym dialogiem).
- Powłoka nakładek (popover / menu kontekstowe) jest WSPÓLNA i równoległa do
  powłoki modali: czysta logika w `src/components/overlayShell.ts`
  (`resolveOverlayPosition` — flip/shift + `availableHeight`;
  `createOverlayStack` — Escape tylko dla wierzchniej warstwy;
  `createDismissState` / `resolveDismissEvent` — zamknięcie dopiero przy PARZE
  `pointerdown` + `click` poza nakładką, a `contextmenu` poza nakładką zamyka od
  razu, bo prawy klik nie daje `click`; `resolveMenuNavKey` / `matchTypeahead` +
  `overlayShell.test.ts` w node), cienka warstwa DOM w `src/components/useOverlay.ts`
  z komponentem `OverlayLayer` portalującym do leniwie tworzonego
  `#n2hub-overlay-root`. Stos Escape stoi PONAD modalami: nasłuch jest w fazie
  capture i woła `stopPropagation` tylko wtedy, gdy wierzchnia nakładka
  konsumuje klawisz, więc pierwszy Escape zamyka popover, a dopiero drugi modal.
  Konsumenci: trzy menu kontekstowe `WeekView` (portalowane, mierzone,
  REPOZYCJONOWANE przy scrollu zamiast zamykania, klawiatura menu — roving
  tabindex / strzałki / Home/End / typeahead — tylko w krokach `role="menu"`)
  oraz `FilterPanel`, który świadomie NIE jest portalowany (kotwiczenie CSS i
  mobilny breakpoint `position: static` zostają) i bierze z hooka wyłącznie
  stos, zamykanie i powrót fokusa, z przyciskiem „Filtry” jako triggerem.
  Drabina `z-index` jest stokenizowana jako `--n2-z-*` w `:root`; na `var()`
  przeszły tylko `.context-menu` i `.filter-popover`.
- Kontrakt pola formularza jest WSPÓLNY i równoległy do powłoki modali/nakładek:
  czysta logika w `src/components/fieldContract.ts` (`fieldIds` / `fieldAria` /
  `firstInvalidKey` / `saveErrorSummary` + `fieldContract.test.ts` w node),
  cienka warstwa DOM w `src/components/Field.tsx` (`.field` > `<label htmlFor>`
  > kontrolka > `.field-hint` > `.field-error`, spięte przez
  `aria-describedby`/`aria-invalid`; eksportuje też `focusFieldById`). Przyjęty
  przez TaskModal/EventModal/TicketModal: na modal przypada JEDNO ogłaszane
  `role="alert"` z liczonym polskim podsumowaniem („Nie można zapisać zadania —
  popraw 2 pola: Tytuł, Okres.”) — błędy per-pole go NIE mają. W TaskModal
  `SaveBlocker.fieldLabel` (`src/components/taskSaveBlockers.ts`) jest jedynym
  źródłem etykiet podsumowania, a `periodInvalidTargets` oznacza OBA pola daty
  przy błędzie zakresu (`reversed`/`too-long`) i jedno przy błędzie pojedynczej
  daty. Pola TaskModala siedzą w
  `<form className="task-editor-form" onSubmit>` obejmującym sekcje OD
  „Szczegóły” DO „Zasobnik” WYŁĄCZNIE — „Dyskusja” (własny `<form>` w
  `CommentsPanel`, zagnieżdżenie byłoby nielegalnym HTML-em) i sticky pasek
  akcji zostają POZA formularzem.
- Dymki podpowiedzi są WSPÓLNE i zastąpiły natywny `title` w CAŁEJ aplikacji —
  łącznie z kalendarzem i osią czasu (warunki brzegowe powierzchni przeciągania
  opisuje `scheduling-and-calendar.md`); w `src` nie ma już ANI JEDNEGO atrybutu
  `title`:
  czysta logika w `src/components/tooltipShell.ts` (zwłoka GRUPOWA 500 ms /
  0 ms dla ciepłej grupy z oknem łaski 500 ms, `resolveTooltipTrigger` — dotyk
  i rysik NIGDY nie pokazują, `:focus-visible` pokazuje natychmiast,
  `pointerdown`/Escape chowają, `tooltipDescribes` + `buildTooltipText` +
  `mergeDescribedBy`; testy `tooltipShell.test.ts` w node), cienka warstwa DOM
  w `src/components/Tooltip.tsx`: `cloneElement` BEZ opakowania dziecka,
  obserwatorzy nigdy nie wołają `preventDefault`/`stopPropagation` (doktryna
  `useOverlay.ts`), karta portalowana przez `OverlayLayer` +
  `resolveOverlayPosition` (`bottom-start`, offset 6, `--n2-z-tooltip` = 1300),
  chowana przy scrollu/resize/Escape (bez konsumowania klawisza). Karta jest
  `aria-hidden`; `aria-describedby` dostaje ZAWSZE zamontowany `.sr-only` w
  portalu i TYLKO wtedy, gdy tekst nie zawiera się w nazwie dostępnej (`visualOnly`
  wymusza wariant czysto wizualny). `DisabledHint` (tamże) obsługuje kontrolki
  wyłączone NATYWNIE — te połykają zdarzenia wskaźnika, więc dymek wisi na
  `.tooltip-holder`, a powód idzie osobnym ukrytym opisem. Blokady pól
  (TaskModal, PersonProfilePage, ProjectDetailPage, AllocationGrid) mają JEDEN
  ukryty powód na widok + `aria-describedby`, bez dymka. `IconButton` nie ma już
  propsu `title`: `tooltip` (domyślnie = `label`, `null` = brak), `shortcut`,
  `size` = `sm|md` (`data-size`), `pressed`/`expanded`, oraz MIĘKKIE
  `disabled`/`busy` (`aria-disabled`/`aria-busy`, przycisk zostaje w cyklu Tab,
  klik pomijany) i pole trafienia ≥ 44 px przez `.icon-btn::after`.
- `src/utils/dirtyRegistry.ts` and `src/utils/useSaveStatus.ts` support shared
  unsaved-edit and save-state behavior. The registry also holds the opt-in
  router navigation guard (scopes `task-modal`/`project-detail` plus a one-shot
  bypass) that App's `DirtyNavigationGuard` consults; only those two surfaces
  register, so other routes and forms never gain a global blocker.

## Rules that change work

- UI strings are Polish.
- Informational onboarding must not mutate business data. The explicitly named
  advanced calendar exercise is a live-plan exception: disclose that it changes
  real data and require confirmation before starting it. Do not change calendar
  pointer lifecycle while adding tours.
- Keep permission checks in `src/store/permissions.ts` / `useCan`; local-only
  permissions are UX, not a backend security boundary.
- Task/project editor changes must preserve save-state and persistence banners.
- For navigation work, distinguish clean navigation from discarding a dirty edit.
- There is one home for every role: „Panel" (`/dashboard`, `HOME_PATH` in
  `src/pages/homeRoute.ts`). The former per-role „Moja praca" page was merged
  into it — its Zasobnik and Alerty cards are now Panel tiles (grid areas `bin`
  and `alerts`), keeping `data-tour="home.bin"`/`home.alerts`. Legacy `/my-work`
  redirects to `HOME_PATH`; login, `/` and the onboarding `@home` token all
  resolve there. On mobile, a closed drawer is inert, and an open drawer contains
  keyboard focus until it closes and restores focus to its trigger.

## Start here for

Routes, modals, dirty-edit protection, accessibility, roles, onboarding,
global shell UI and view-specific UI changes.
