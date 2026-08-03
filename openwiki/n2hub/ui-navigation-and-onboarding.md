# UI, navigation and onboarding

## Boundaries

- `src/App.tsx` owns routing, shell-level overlays and current-user navigation.
  `src/main.tsx` hosts the data router (`createBrowserRouter`) that App's
  `useBlocker` dirty-navigation guard requires. WSZYSTKIE strony tras są LENIWE
  (`React.lazy`): jedyne źródło mapy `ścieżka → () => import(...)` to
  `src/pages/routeChunks.ts`, z którego bierze się i komponent trasy, i
  `prefetchRoute` podgrzewający TEN SAM chunk na `onPointerEnter`/`onFocus`
  pozycji nawigacji (sidebar, dolny pasek, arkusz „Więcej”, „Zasobnik” →
  `/calendar`, awatar profilu → `/people/:id`). Granica `<Suspense>` stoi
  WEWNĄTRZ powłoki i dostawców (zastępnik = istniejący `empty-state` z
  „Wczytywanie…”), więc zawieszenie trasy nie odmontowuje sidebara, dolnego
  paska, modali ani strażnika `useBlocker`. `LoginPage` i `auth/AuthScreens`
  zostają ZWYKŁYMI importami — renderują się przed powłoką i przed tą granicą.
  Silnik animacji ładuje `<LazyMotion features={domAnimation} strict>` w
  `main.tsx` (obok `MotionConfig`); cała aplikacja renderuje `m.*`, `motion.*`
  nie ma nigdzie, a `strict` to wymusza. Dlatego karty Kanbana nie mają już
  propsu `layout` (projekcja FLIP jest poza `domAnimation`; `transition:
  transform` w CSS też NIE, bo tym samym transformem steruje `whileHover`).
  `vite.config.ts` wydziela ręcznie DOKŁADNIE trzy paczki vendorów — `react`
  (razem z `react-dom`/`scheduler`/`react-router*`/`@remix-run/router`, żeby nie
  rozjechać środowiska Reacta), `motion` (+ `framer-motion`/`motion-dom`/
  `motion-utils`) i `supabase` — oraz trzyma `build.cssCodeSplit: false`, bo
  `styles.css` MUSI zostać jednym arkuszem.
- The sidebar nav (`NAV` in `App.tsx`) is a fixed ordered list — Panel, Moja
  praca, Klienci, Projekty, Zadania, Kanban, Kalendarz, Oś czasu, Obciążenie,
  Zespół — ending with two gated entries: Konto (supabase mode only) and
  Ustawienia (renamed from „Administracja”; route stays `/admin`, permission
  `admin.panel`). `/zgloszenia` and `/team` are NOT in this list. Below the nav
  a pinned `.sidebar-footer` row holds the „Zgłoszenia” NavLink (visible to
  every role) next to the round icon-only „Pomoc i samouczki” button, which
  keeps the `.sidebar-help` class and `shell.help` tour anchor (dispatches
  `n2hub:open-tutorials`); the footer lives inside `#app-drawer`, so the mobile
  focus trap covers it. Collapsed rail stacks the footer to two 44px circles.
- `/content-plan` („Content plan", ikona `CalendarRange`, w `NAV` po
  `/wydarzenia`, `src/pages/ContentPlanPage.tsx`) to TRZECIA bramkowana pozycja
  menu. Decyzja operatora 2026-08-03: moduł widzą WYŁĄCZNIE administratorzy.
  Kryterium jest czyste (`src/pages/contentPlanScope.ts`: `contentPlanViewer` +
  `canViewContentPlan(user, moduleAccess)`, stała `CONTENT_PLAN_ROLES`) i
  świadomie NIE używa `effectiveAccessRole` — tamta mapuje chmurowego
  `manager` na `pelne`, a tu menedżer musi odpaść. Rola idzie ze snapshotu
  `OrgDataProvider` (`profile.cloudRole`), w trybie lokalnym/ładowaniu/błędzie
  z lokalnej `accessRole` (`pelne`→administrator, `ograniczone`→worker).
  `moduleAccess` (grant `contentplan.my_access`) jest przyjmowany, ale jeszcze
  nieczytany — zmiana kryterium to zmiana JEDNEJ funkcji. Jedno wyliczenie na
  aplikację daje hook `src/contentplan/useContentPlanAccess.ts`, wpięty w
  CZTERECH miejscach, które muszą mówić to samo: filtr `navPaths` + `<Route>` w
  `App.tsx`, `quickActionCatalog` w palecie (opcja `canContentPlan`, domyślnie
  `false`), `NavOrderEditor` i samo-guard strony (`<Navigate to={HOME_PATH}>`,
  wzorzec `/admin`). Stan strony to sam pager miesięcy w URL (`?m=YYYY-MM`,
  czysty `src/pages/contentPlanRoute.ts` nad `contentplan/domain.ts`); reszta
  (siatka, edytor) wchodzi kolejnymi fazami. Bramka UX, nie granica
  bezpieczeństwa — zakres wymusza RLS schematu `contentplan`.
- `/team` (Struktura zespołu) is reached via the shared `src/pages/TeamTabs.tsx`
  tab bar (Pracownicy → `/people`, Struktura zespołu → `/team`) rendered on both
  the Zespół (`/people`) and `/team` pages, not from its own nav item. Od
  2026-07-22 `canViewTeam` przepuszcza KAŻDEGO zalogowanego (kolaps ról: obszar
  Zespół widoczny dla wszystkich, rola `ograniczone` ogranicza tylko edycję) —
  bramki `canTeam`/`canViewTeam` zostają w kodzie jako strażnik braku
  tożsamości. The „Zespół” nav link stays highlighted on `/people`,
  `/people/:id` and `/team`. Od 2026-07-29 `/team` startuje na widoku
  „Struktura" (`TeamStructureTree`); płaska lista działów jest drugim, jawnie
  wybieranym widokiem i nadal jedynym miejscem edycji przełożonego.
  Schemat rysuje się na płótnie, nie w zagnieżdżonych listach: pozycje kart i
  krawędzie liczy czysty `src/pages/orgChartLayout.ts` (`ORG_METRICS` to jedno
  źródło wymiarów, wchodzą do DOM stylem inline), a łączniki to ścieżki w
  jednym SVG pod kartami. WIERSZ OSOBY WYNIKA Z RANGI STANOWISKA
  (`orgRoleRank` + `titleRow`), nie z głębokości w drzewie: zarząd stoi na
  skrajach tuż pod korzeniem, `Menadżer/Kierownik` wiersz niżej, reszta na
  dole — więc specjalista raportujący wprost do zarządu ma krawędź `skip`
  poprowadzoną pustą kolumną przełożonego. Węzeł `aside` (główna księgowa)
  stoi obok kaskady i świadomie NIE ma krawędzi. Jedyny zapis DOM-owy tego
  widoku to wyśrodkowanie `scrollLeft` kontenera po zamontowaniu — korzeń musi
  być w kadrze na wąskim ekranie.
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
- The nav config (routes, labels, icons, shipped default order) lives in
  `src/components/navItems.ts` (`NAV`), imported by both `App.tsx` and the
  reorder editor. Each user can reorder the sidebar (↑/↓) per user PER BROWSER:
  the order is stored in `uiPrefs` as `navOrderByUser` (device-local
  `n2hub.ui.v1`, keyed by `realUserId`, so impersonation never overwrites it),
  parsed defensively (arrays of strings only). `src/utils/navOrder.ts`
  (`applyNavOrder`/`moveNavPath`, pure + unit-tested) is self-repairing: unknown
  or duplicate stored paths are dropped and missing defaults appended in default
  order, so no migration is ever needed. App applies the order BEFORE the gate
  filter (`canAdmin`, supabase-only Konto), so a stored order can never reveal a
  gated item. `src/components/NavOrderEditor.tsx` (section „Kolejność menu")
  mounts on both the Konto page (`/account`, every cloud user) and Ustawienia
  (`/admin`); it lists the user's VISIBLE items, moves a visible item by swapping
  with its nearest visible neighbour in the FULL stored order (hidden gated items
  keep their positions), persists via `updateNavOrderForUser` and fires a
  `n2hub:nav-order-changed` window event so App re-orders the live sidebar.
- `src/pages/` owns route-specific screens; `src/components/TaskModal.tsx` owns
  task editing and its allocation grid. Nagłówek kontekstu ma dropdown „Klient"
  PRZED „Projekt" (czysta logika: `src/components/taskClientPicker.ts` + test w
  node) — zadanie NIE ma własnego `clientId`, wybór klienta tylko zawęża listę
  projektów („Bez klienta" zbiera projekty bez/z usuniętym klientem, ostatnia
  pozycja), a „przepisanie" klienta = wybór projektu u innego klienta. Wszystkie
  listy i dropdowny nazw (klienci, projekty, osoby) sortuje JEDYNE źródło
  polskiej kolacji `src/utils/collation.ts` (`comparePl`/`sortByNamePl`,
  locale 'pl') — nie dopisuj lokalnych `localeCompare` bez locale. Powody blokujące zapis zadania są czyste
  i testowane osobno (`src/components/taskSaveBlockers.ts`,
  `collectTaskSaveBlockers` + `taskSaveBlockers.test.ts`): `formValid` = pusta
  lista, a nieudany zapis MUSI dać skutek — skacze do pierwszego złego pola
  (kotwice `t-title`/`t-project`/`t-status`/`t-start`/`t-end`/`t-assignees`),
  wypisuje powody w sticky stopce edytora i udostępnia je klikalnej odznace
  zapisu (`SaveStatus` prop `blocked`). Widoczność błędu podąża za wspólnym
  modelem czasowym (patrz kontrakt pola niżej): pierwsza walidacja na blur albo
  przy próbie zapisu, potem żywa rewalidacja tylko dla pól, które już raz
  pokazały błąd; sekcja „Cykliczność” rządzi się tą samą zasadą względem
  własnej edycji. Poniżej 760 px sekcja „Dzienny przydział godzin” renderuje
  BLIŹNIAKA PREZENTACYJNEGO tabeli: `src/components/AllocationDayList.tsx`
  (pionowa lista dni, przełącznik osoby, stepper ±0,25 h) na czystym
  `allocationDayListView.ts` (+ test w node). Wybór formy to jeden warunek w
  TaskModal (`useMediaQuery(MOBILE_NAV_QUERY)`); `AllocationGrid` i jej CSS
  zostają bez zmian, a lista zapisuje WYŁĄCZNIE przez te same
  `setCell`/`setCellStart` — druga ścieżka mutacji nie istnieje (inwariant 1).
- `src/components/ModalFrame.tsx` owns the shared portal, modal stack, Escape,
  body scroll lock and inert root for Task, Event, Ticket, Quick Add and
  Changelog modals. The frosted background is a one-time opaque canvas produced
  by `modalBackdropSnapshot.ts`; the live app is hidden after capture so modal
  scrolling never blends against or filters `#root`. There is one scroller,
  `.task-modal-body`, and the snapshot/card must not use scale animation. Read
  [frontend-performance-and-primitives.md](frontend-performance-and-primitives.md)
  before changing this boundary.
- Profile edit matrix (`src/pages/profileEditPolicy.ts`) gains an ADMIN-ONLY
  „Spółka” field (`companyId` in `ALL_FIELDS` only — nie self, nie manager),
  rendered as a select in PersonProfilePage next to „Dział”; parity with the
  server `app.protect_profile_privileges` trigger (spółka zawęża widoczność
  projektów w chmurze). AdminPage adds a „Spółki” CRUD section after „Działy”.
- `/zgloszenia` („Zgłoszenia”, `src/pages/TicketsPage.tsx`) jest widoczne dla
  KAŻDEJ roli — nie jest bramkowane jak `/admin`. Bez `tickets.manage` strona to
  wyłącznie skrzynka nadawcza (przycisk otwierający modal, ŻADNEJ listy — decyzja
  2026-07-21). Z `tickets.manage` (rola `pelne`): dwa tryby w segmentowanym
  przełączniku — „Zgłoś” (otwiera modal) i „Zgłoszone” (pełna tabela z filtrami
  status + rodzaj, sort od najnowszych, rozwijany opis, inline status, usuwanie
  i eksport CSV; serializer: `src/pages/ticketsExport.ts`). Wiersze `zrobione`
  są podświetlone na zielono (`.ticket-row-done`; decyzja 2026-07-22 — bez
  osobnego taba, wystarcza filtr statusu). `src/components/TicketModal.tsx`
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
- Tablica Kanban (`src/pages/KanbanPage.tsx`) ma TRZY równoprawne ścieżki
  przenoszenia karty, wszystkie kończące się jedyną akcją `SET_TASK_STATUS`
  (żadnego nowego reduktora, pola w `AppData` ani zapisanej kolejności w
  kolumnie): przeciąganie na Pointer Events (natywne HTML5 DnD —
  `draggable`/`dataTransfer` — ZNIKŁO; dotyk/pióro wchodzi przez wspólną bramkę
  `useTouchDragGate`, więc ruch palcem przed przytrzymaniem przewija tablicę),
  tryb przenoszenia z klawiatury na uchwycie karty oraz pozycja „Przenieś do
  statusu” w menu karty (powłoka `useOverlay`, dwa kroki `role="menu"`, bieżący
  status wyłączony). Uchwyt i wyzwalacz menu to absolutnie pozycjonowany klaster
  ujawniany hoverem/fokusem — na `pointer: coarse` widoczny stale, bo bez niego
  dotyk nie ma ścieżki poza przeciąganiem. Automat trybu klawiaturowego jest
  czysty (`src/pages/kanbanMove.ts` + `kanbanMove.test.ts` w node): zdarzenie bez
  skutku zwraca TĘ SAMĄ referencję stanu, `move` NIE zawija się na krawędziach
  pasa kolumn, `drop` na kolumnie źródłowej nie wysyła nic. Tryb wybiera
  KOLUMNĘ, nie pozycję — „pozycja N z M” jest WYLICZANA z wyeksportowanego
  `compareTasks` (`kanbanBoard.ts`), bo kolejność w kolumnie pozostaje pochodna
  z `(orderIndex, startDate, id)`. Cel upuszczenia liczy się ze ZMIERZONYCH
  prostokątów kolumn (`data-status-id` + `getBoundingClientRect`), nigdy z
  `elementFromPoint` (przechwycenie wskaźnika kieruje zdarzenia na kartę);
  kolumna archiwum nie ma `data-status-id`, więc jest źródłem, a nie celem.
  Jeden region `role="status"` na stronie ogłasza podniesienie, zmianę celu,
  upuszczenie i anulowanie; ten sam wskaźnik (`.kanban-col.drag-over` +
  `.kanban-drop-indicator`) obsługuje oba tryby.
- DIETA PIGUŁEK W WIERSZU LISTY (SY-03/SY-06, 2026-07-28): jeden typ danych =
  jeden kształt. OBRYSOWANA pigułka to WYŁĄCZNIE edytowalny status
  (`StatusBadge`); atrybut stały niesie akcent niekolorowy, a wartość wyliczona
  jest zwykłym tekstem albo paskiem. Dlatego w wierszach list (`TasksPage`,
  `ProjectDetailPage`, `DashboardPage`) NIE MA już `PlanningBadge` ani
  `PriorityBadge`: priorytet to `data-priority` na `.task-card` + pasek 3 px
  (`::before`, malowany tylko dla `high`/`urgent`; etykietę niesie `.sr-only`),
  a stan rozplanowania to `src/components/PlanningProgress.tsx` na czystym
  `src/utils/planningProgress.ts` (`planningProgress`/`planningProgressLabel` +
  test w node: brak szacunku ⇒ `ratio: null` i BRAK paska, szerokość przycięta
  do 100 %, `PROGRESS_EPS` = 1e-9 zdejmuje dryf 0,1 + 0,2). Pasek NIE MA koloru
  poniżej 100 %: tony `none`/`under`/`full` zostają neutralne (`--text-muted`),
  a JEDYNY stan kolorowy w CSS to `over` (`--n2-danger` + `--n2-danger-soft` na
  torze) — zielony pasek na każdym rozplanowanym zadaniu byłby tym samym
  szumem, co pigułka „częściowo”. Tony `under`/`full` żyją dalej w module TS i
  w atrybucie `data-tone` jako semantyka, nie jako farba.
  To WARSTWA PREZENTACJI — `planningStatusForTotals` /
  `taskPlanningStatus` zostają jedynym źródłem stanu i idą do paska osobnym
  propsem `status`, żeby niuans zasobnika został w `.sr-only`. Pigułka
  `.planning-badge` żyje dalej WYŁĄCZNIE w TaskModalu (tam są szczegóły).
  Postęp listy kontrolnej to wzór glifów (`src/utils/checklistGlyphs.ts`,
  `◍◍◌ 2/3`, limit 5 glifów, glify `aria-hidden`). Ścieżka adresowa ma JEDNO
  źródło prawdy — `clientProjectPath` w `src/utils/entityPath.ts` (dawne
  `taskCardPath`): kolejność Klient → Projekt, separator `›`, klasa
  `.entity-path` (12 px, bez wersalików, bez monospace, bez ramki/tła) w liście
  zadań, arkuszu szczegółów i na Kanbanie (tam zmienia się TYLKO treść i
  kolejność tekstu `.kanban-card-client` — wymiary kart i awatary bez zmian).
  `.project-badge` zostaje przy typach usług, działach, dokumentach i szkicach.
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
  Na TELEFONIE hook dokłada wcięcie klawiatury ekranowej: czysta arytmetyka w
  `src/components/keyboardInset.ts` (`resolveKeyboardInset` — próg
  `KEYBOARD_INSET_MIN_PX` = 80 px odsiewa drganie paska adresu od klawiatury;
  `shouldScrollFieldIntoView` + `keyboardInset.test.ts` w node), nasłuch
  `visualViewport` (`resize`/`scroll`) i `focusin` karty w hooku. Wysokość
  klawiatury idzie w zmienną `--n2-kb-inset` na karcie, konsumowaną WYŁĄCZNIE
  przez `max-height: calc(94dvh - var(--n2-kb-inset, 0px))` w bloku
  `@media (max-width: 760px)` — lepki pasek zapisu zostaje nad klawiaturą.
  Efekt nie startuje bez `visualViewport` ani powyżej breakpointu
  (`MOBILE_NAV_QUERY`), więc desktop renderuje się bit w bit tak samo.
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
  razu, bo prawy klik nie daje `click`; `isAnchorOutOfView` — kotwica całkiem
  poza oknem, opcja `closeOnAnchorOutOfView` (domyślnie WYŁĄCZONA, żeby menu
  kontekstowe dalej się repozycjonowały); `resolveMenuNavKey` / `matchTypeahead` +
  `overlayShell.test.ts` w node), cienka warstwa DOM w `src/components/useOverlay.ts`
  z komponentem `OverlayLayer` portalującym do leniwie tworzonego
  `#n2hub-overlay-root`. Stos Escape stoi PONAD modalami: nasłuch jest w fazie
  capture i woła `stopPropagation` tylko wtedy, gdy wierzchnia nakładka
  konsumuje klawisz, więc pierwszy Escape zamyka popover, a dopiero drugi modal.
  Konsumenci: trzy menu kontekstowe `WeekView` (portalowane, mierzone,
  REPOZYCJONOWANE przy scrollu zamiast zamykania, klawiatura menu — roving
  tabindex / strzałki / Home/End / typeahead — tylko w krokach `role="menu"`),
  dwukrokowe menu karty Kanban (patrz niżej)
  oraz `FilterPanel` (`src/components/FilterPanel.tsx`), portalowany w OBU
  wariantach, z przyciskiem „Filtry” jako triggerem: na desktopie mierzony
  popover (`bottom-start`, offset 6, `closeOnAnchorOutOfView`, minimalna
  szerokość z `--anchor-width`), a poniżej 760 px (`useMediaQuery`) arkusz od
  dołu ze scrimem, lepką stopką „Wyczyść · Pokaż N” (opcjonalny `resultCount`,
  podpięty na Projektach i Zadaniach) i blokadą scrolla tła ze WSPÓLNEGO
  licznika modali (`useBodyScrollLock`). Fokus wchodzi do panelu i krąży w nim —
  decyzje bierze `modalShell.ts` (`focusInitialIn` / `tabbableElementsIn` +
  `resolveTrapAction`), powrót fokusa robi `useOverlay`. Na telefonie na tej
  samej powłoce (wariant niepozycjonowany, bez
  `getAnchorRect`) stoją też cztery arkusze od dołu: „Więcej” w `App.tsx`
  (`role="menu"`), szybki skok kalendarza w `CalendarPage` (`role="dialog"`),
  arkusz szczegółów zadania w `TasksPage` (`role="dialog"`, JEDNA instancja na
  stronę, `triggerRef` wskazuje przycisk WYBRANEJ karty) oraz
  arkusz zasobnika w `WeekView`; ten ostatni jest ROZBRAJANY na czas
  przeciągania (`open: … && !dragActive`), bo capture'owy Escape powłoki
  zjadłby anulowanie przeciągania (inwariant 7).
  Drabina `z-index` jest stokenizowana jako `--n2-z-*` w `:root`; na `var()`
  przeszły m.in. `.context-menu`, `.filter-popover` i arkusze od dołu
  (`--n2-z-drawer`, w tym `.filter-sheet`).
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
- PALETA WYSZUKIWANIA (2026-07-28): `GlobalSearch.tsx` renderuje JEDNĄ płaską
  listę wierszy (`role="option"` + `aria-activedescendant`, input
  `role="combobox"` + `aria-autocomplete="list"` — wolne wyszukiwanie, NIE
  zamknięta lista wyboru), złożoną z grup: „Szybkie akcje” (prefiks `>` =
  wyłącznie akcje; bez prefiksu od 2 znaków, `QUICK_ACTIONS_MIN_TERM`),
  „Ostatnio otwarte” przy pustej frazie, wyniki `searchAll` i wiersz „Pokaż
  więcej” per grupa. Czysta logika mieszka w
  `src/components/globalSearchModel.ts` (`quickActionCatalog` — WYŁĄCZNIE
  istniejące czynności: nowe zadanie + nawigacja z `NAV_ITEMS`, bramki
  `/admin`/`/team` jak w menu; `filterQuickActions`/`inlineQuickActions`,
  `highlightSegments` — podświetlenie liczone na tekście znormalizowanym tym
  samym `normalizeSearchText` co selektor, `resultsAnnouncement` — „12 wyników
  w 3 grupach” przez `announce` (kanał polite), `recentPaletteRefs` — pamięć
  SESJI palety (moduł, zero nowej trwałości) + dziennik `state.activity`);
  testy `globalSearchModel.test.ts` w node. `searchAll` dostaje JAWNY limit per
  grupa (`SearchLimits`, `DEFAULT_SEARCH_LIMIT` = 8, rozwinięta grupa 40) i
  przerywa skan po przekroczeniu limitu, a `SearchResults.hasMore` mówi, czy
  grupa została ucięta. Klawiatura przewija aktywny wiersz
  (`scrollIntoView({ block: 'nearest' })`) i BLOKUJE `onMouseEnter` do
  pierwszego realnego `mousemove` (mysz nie kradnie zaznaczenia).
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
  resolve there. Poniżej `MOBILE_NAV_QUERY` Panel renderuje ZAMIAST siatki stos
  `.dash-m-stack`: kolejność i pustka kafelków pochodzą z czystego
  `mobileDashboardOrder` (`src/pages/dashboardPanels.ts`), kafelek, którego cała
  treść byłaby pustym stanem, NIE istnieje w DOM-ie — więc kotwica `data-tour`
  takiego kafelka też nie (Obciążenie jako jedna linia i Tydzień jako siedem
  pigułek są zawsze). Na desktopie rzędy siatki to kolejno `today workload`,
  `notifications team`, `week`, `bin alerts` — „Zadania na dziś" są PIERWSZYM
  elementem treści. Pusty kafelek Powiadomień/Alertów nie znika, tylko kurczy
  się do belki ~40 px (`dashTileView` + `.dash-card-bar`, `align-self: start`)
  i ZACHOWUJE swoją kotwicę `data-tour`. Nad siatką stoi najwyżej jedna linia
  dziennika zmian z jednym CTA („Nowości 20–21.07 →"), widoczna tylko dopóki
  `changelogUnread` (potwierdzenie trzyma urządzeniowe `changelogSeenId` w
  `utils/uiPrefs.ts`, nie stan aplikacji). Pasek tygodnia ma pięć kolumn dni
  roboczych i wąską kolumnę weekendu (dwie belki 24 px); „+N więcej" oraz belki
  weekendu prowadzą do dnia przez `calendarDayTarget` → `/calendar?dzien=…`,
  który `CalendarPage` konsumuje i czyści (`replace`). Poniżej 760 px powłoka nie
  ma szuflady ani hamburgera:
  nawigację niesie `.app-bottom-nav` — pięć zakładek (Panel, Kalendarz,
  Zadania, Zasobnik jako deep-link `/calendar?zasobnik=1`, „Więcej”) o
  wysokości `--n2-bottom-nav-h` + `env(safe-area-inset-bottom)`, ze stanem
  aktywnym z czystej reguły `activeTabPath` (`src/components/bottomNav.ts`).
  Sidebar renderuje się WYŁĄCZNIE powyżej tego breakpointu (wspólny hook
  `src/utils/useMediaQuery.ts`), a górny pasek telefonu niesie tytuł trasy
  (`topBarTitle`) i JEDYNY zamontowany `GlobalSearch`. Arkusz „Więcej” to
  nakładka `useOverlay` (`role="menu"`): bez pułapki fokusa i bez `inert` w
  tle — Escape i klik poza zamykają, fokus wraca na wyzwalacz.
  keyboard focus until it closes and restores focus to its trigger.

## Start here for

Routes, modals, dirty-edit protection, accessibility, roles, onboarding,
global shell UI and view-specific UI changes. Rendering-sensitive primitive
work additionally starts with
[frontend-performance-and-primitives.md](frontend-performance-and-primitives.md).
