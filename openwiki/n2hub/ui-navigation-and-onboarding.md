# UI, navigation and onboarding

## Boundaries

- `src/App.tsx` owns routing, shell-level overlays and current-user navigation.
  `src/main.tsx` hosts the data router (`createBrowserRouter`) that App's
  `useBlocker` dirty-navigation guard requires. WSZYSTKIE strony tras są LENIWE
  (`React.lazy`): jedyne źródło mapy `ścieżka → () => import(...)` to
  `src/pages/routeChunks.ts`, z którego bierze się i komponent trasy, i
  `prefetchRoute` podgrzewający TEN SAM chunk na `onPointerEnter`/`onFocus`
  pozycji nawigacji (sidebar, dolny pasek, arkusz „Więcej”, „Zasobnik” →
  `/calendar`, awatar profilu → `/account`). Granica `<Suspense>` stoi
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
- MIĘKKA KRAWĘDŹ PRZEWIJANIA (2026-08-03): `main.app-main` ma DWOJE dodatkowych
  dzieci — `.app-scroll-fade-top` jako PIERWSZE i `.app-scroll-fade-bottom` jako
  OSTATNIE (oba `!mobileNav`, `aria-hidden`, `pointer-events: none`). To paski
  `position: sticky` z tłem `--n2-gradient-page`, `background-attachment: fixed`
  i maską alfa, więc rysują dokładnie te piksele tła, które i tak są w tym
  miejscu OKNA, a treść wtapia się w nie zamiast być ucinana. Scrollportem
  zostaje DOKUMENT (`.app-main` się nie przewija — na tym stoi `window.scrollTo`
  w `TaskFullPage` i przywracanie pozycji), dlatego maska na samym `.app-main`
  by nie zadziałała. Ujemne marginesy (`--n2-scroll-fade-h` = 24 px = dopełnienie
  powłoki) sadzają paski w dopełnieniu, więc przy pozycji 0 i na końcu strony nie
  przygaszają niczego; kolejność dzieci jest częścią kontraktu.
  `--n2-z-scroll-fade` = 20 stoi NAD zwykłą treścią widoków (także nad lepkimi
  etykietami osi czasu, `z-index: 3`), ale POD lepkim paskiem akcji edytora
  (`--n2-z-sticky-actions` = 30 na `.editor-actions-sticky`, który na
  `/projects/:id` przykleja się do DOKUMENTU i musi zostać ostry oraz klikalny)
  i POD każdą nakładką, począwszy od popovera (40). Wygaszenie NIGDY nie może
  zakryć kontrolki — nowy element przyklejony do dokumentu w kolumnie treści
  dostaje `--n2-z-sticky-actions`, a nie własną liczbę. Na telefonie pasków nie
  ma — górę zasłania kryjący `.app-topbar`, dół `.app-bottom-nav`.
- KARTA KLIENTA (`/clients`, 2026-08-03) nie ma już chevrona ani klikalnego tła:
  nagłówek to nazwa + pigułka-link `.client-project-chip` („6 projektów" →
  `/projects?client=<id>`) po lewej i akcje po prawej. Rozwinięciem szczegółów
  steruje WYŁĄCZNIE tekstowe CTA „Zobacz szczegóły"/„Zwiń szczegóły", które
  przejęło `aria-expanded` + `aria-controls`; edycja, archiwizacja i usuwanie to
  `IconButton` (`Pencil`, `Archive`/`ArchiveRestore`, czerwony `Trash2`) za
  bramką `clients.manage`. Archiwizacja pyta wspólnym `useConfirm()` i mówi
  PRAWDĘ o skutkach (reduktor tylko przełącza flagę `archived`; czytają ją filtr
  listy Klientów i lista wyboru klienta w formularzu nowego projektu — projekty,
  zadania i godziny zostają), „Przywróć" nie pyta.
- The sidebar nav (`NAV` in `App.tsx`) is a fixed ordered list — Panel, Moja
  praca, Klienci, Projekty, Zadania, Kanban, Kalendarz, Oś czasu, Obciążenie,
  Zespół, Konto (BOTH modes since 2026-08-03) — ending with one gated entry:
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
  wzorzec `/admin`). W URL stoi WYŁĄCZNIE pager miesięcy (`?m=YYYY-MM`, czysty
  `src/pages/contentPlanRoute.ts` nad `contentplan/domain.ts`); wybór marki,
  zaznaczona karta i schowek kopiuj/wklej to stan SESJI widoku. Kalendarz
  miesiąca (port `CalendarGrid`/`PostCard`/`MonthStats` z aplikacji źródłowej,
  zero Mantine) stoi na czystym `src/pages/contentPlanCalendar.ts` (+ test w
  node): rozłożenie publikacji na dni, liczniki nagłówka, model karty i DRAFTY
  kopiuj/wklej. Zapis idzie WYŁĄCZNIE przez reduktor (`SAVE_CP_POST` z
  `postId: null` — także wklejenie, a kopia zawsze startuje jako szkic w
  statusie roboczym i ze świeżymi id kanałów), usuwanie przez wspólny
  `useConfirm()`. WYGLĄD (od 2026-08-04, decyzja operatora): skórka „Glass"
  przeniesiona 1:1 z aplikacji źródłowej `Content plan/planner` — scena
  `.cp-scene` z aurorą, pozioma tablica tygodni ze scroll-snapem i paging
  kółkiem, pasek osi czasu, chipy marek („Wszystkie marki" + per marka),
  legenda statusów, tryb „Rejestr" (tabela z tygodniami-separatorami,
  `src/components/ContentPlanRegister.tsx`) i wysuwany panel szczegółów
  (`ContentPlanPostDetail.tsx`). Czysta logika osi/statusów:
  `src/contentplan/glassView.ts`; prymitywy (glify platform inline SVG,
  miniatura Drive, pigułka statusu): `components/ContentPlanGlass.tsx`.
  ŚWIADOMY WYJĄTEK od zasady „jeden właściciel przewijania": tablica ma
  scroller poziomy, a kolumny dni własne pionowe — to rdzeń układu źródłowego
  (zapisane też przy stylach `.cp-scene`). Klik w KARTĘ otwiera panel
  szczegółów; edytor publikacji otwiera się z panelu i z rejestru
  (`src/components/ContentPlanPostModal.tsx`, `?publikacja=<id>`), a marki i ich słowniki mają
  własny modal (`ContentPlanBrandModal.tsx`, `?marka=new|<id>`, wejścia z
  toolbaru i z pustego stanu). Oba modale są montowane WEWNĄTRZ strony, nie na
  poziomie App (moduł jest bramkowany rolą i jednostronicowy, więc reużywa jej
  samo-guard zamiast dokładać czwarty globalny mount), stoją na wspólnej
  powłoce `useModalShell` z `closeOnBackdrop: false`, a zamknięcie usuwa
  WYŁĄCZNIE własny parametr — pager `?m=` zostaje nietknięty. Model edycji to
  DRAFT + JAWNY zapis: cała logika draftu i słowników siedzi w czystych
  `components/contentPlanPostEditor.ts` i `components/contentPlanBrandEditor.ts`
  (+ testy w node), zapis to JEDEN `SAVE_CP_POST` z etykietą historii z
  `saveHistoryLabel`, a przed dispatchem stoi LUSTRO bramki reduktora
  (`normalize*Draft`) — odrzucony draft nie zamyka modala i nie czyści dirty.
  Komentarze i decyzja klienta działają na ŻYWEJ encji (`ADD_CP_COMMENT` /
  `REVIEW_CP_POST`, tylko `visibility: 'published'`; na szkicu sekcje pokazują
  hint, nigdy martwy przycisk dispatchujący no-op), a guard integralności
  słowników (`dictionaryIntegrityIssue`) blokuje
  usunięcie pozycji używanej przez publikacje marki (reduktor celowo zostaje
  liberalny). Strażnik nawigacji ma dwa własne zakresy —
  `contentplan-post-modal` i `contentplan-brand-modal` — blokujące zmianę
  własnego parametru ALBO ścieżki; sam pager `?m=` nigdy nie pyta.
  MEDIA (od 2026-08-03) wskazuje Google Picker: edytor ma WŁASNĄ sekcję „Media
  z Dysku Google" (jeden wiersz na KANAŁ, nie na grupę opisu) z wyborem pliku,
  podmianą, usunięciem, linkiem na Dysk i miniaturą `driveThumbUrl`. Integracja
  siedzi w `src/contentplan/google.ts` (GIS token flow z cache 60 s przed
  wygaśnięciem, `pickFromDrive`/`pickFolderFromDrive`, best-effort
  `shareFilePublic`; skrypty `gsi/client` i `api.js` ładowane LENIWIE, więc żyją
  wyłącznie w chunku trasy), a pamięć folderu marki i miesiąca w
  `src/contentplan/driveFolders.ts` (`contentplan.drive_folders` przez
  `client.schema('contentplan')`, fallback localStorage
  `n2click.contentplan.driveFolders`, brak tabeli/błąd degraduje się CICHO).
  Konfiguracja jest MIĘKKA: bez `VITE_GOOGLE_CLIENT_ID`/`VITE_GOOGLE_API_KEY`
  przyciski są `disabled` z `DisabledHint` i polskim powodem, reszta modułu
  działa. Do draftu wchodzi WYŁĄCZNIE referencja `{ source: 'gdrive', fileId }`
  przez czysty `setChannelMedia` (zapis nadal tylko `SAVE_CP_POST`; zmiana pliku
  ma własną pozycję „media" w etykiecie historii). Testy w node:
  `src/contentplan/google.test.ts`, `src/contentplan/driveFolders.test.ts`.
  `PUBLISH_CP_MONTH` nadal nie ma UI. Encje modułu NIE są zarejestrowane w
  `searchAll`/palecie (paleta ma tylko szybką akcję nawigacyjną za
  `canContentPlan`). Bramka UX, nie granica bezpieczeństwa — zakres wymusza RLS
  schematu `contentplan`.
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
  a session without a cloud profile row. Od 2026-08-03 `/account` („Konto”,
  ikona `CircleUser`, OBA tryby) to profil zalogowanego użytkownika w formie
  DASHBOARDU tylko do odczytu (`AccountPage`): kafelki `.account-grid`
  (2×2 od 900px; karty to zwykłe `.editor-section`) — Dane kontaktowe, Czas
  pracy, Organizacja, Konto i bezpieczeństwo (status powiadomień + „Zmień
  hasło” jako rozwinięcie `aria-expanded` z osadzonym formularzem: w trybie
  Supabase `CloudPasswordSection` — realne konto przez `changePassword` z
  sesji — w lokalnym `PasswordSection embedded`; oba komponenty mają wariant
  `embedded` bez karty, bo kart się nie zagnieżdża) — oraz zamarkowana
  „Strefa HR” (pigułka „W przygotowaniu”): kafelek Urlop (pozostałe dni z
  DOMYŚLNEGO limitu 26, zużycie liczone z realnych wydarzeń `kind: 'urlop'`
  przez czysty `src/pages/accountHr.ts` + test — dni robocze osoby wewnątrz
  roku; lista nadchodzących urlopów) i kafelek Dokumenty i wnioski (stała
  lista, pigułki „Wkrótce”); przyciski „Złóż wniosek urlopowy” / „Złóż
  zapotrzebowanie” są `disabled` z powodem przez `DisabledHint`. Edycja to
  JAWNY stan: przycisk „Edytuj dane” przełącza na `PersonProfile`
  (eksport z `PersonProfilePage`) z propsem `accountView` — bez „Wróć”, BEZ
  sekcji Hasło/Ten tydzień/Projekty/Zadania (są ukryte w accountView), z
  przyciskiem „Anuluj” i wyjściem po udanym zapisie (`onExit`). Cudze profile
  na `/people/:id` renderują się jak dotąd w całości (z tygodniem, projektami,
  zadaniami i sekcją lokalnego hasła). Własny profil ma JEDEN adres:
  `PersonProfilePage` przekierowuje `/people/<własne id>` → `/account`
  (`Navigate replace`), więc lista zespołu, wyszukiwarka i stare linki lądują w
  zakładce Konto. Dawne sekcje Konta — link „Mój profil”, „Profil w chmurze”
  (duplikat danych profilu) i „Kolejność menu” — nie istnieją; edytor
  kolejności żyje wyłącznie w Ustawieniach. Impersonation („Występuj jako”) was
  removed entirely (UI switcher/banner, `IMPERSONATE`/`STOP_IMPERSONATION`,
  `AppData.impersonatorId`, `users.impersonate`); the sidebar footer avatar
  („Moje konto: …”) links to `/account`, and the mobile „Więcej” sheet has no
  separate „Mój profil” row (the „Konto” nav item covers it). Identity
  association is by email only (planner data references local
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
  filter (`canAdmin`; Konto is ungated since 2026-08-03), so a stored order can
  never reveal a gated item. `src/components/NavOrderEditor.tsx` (section
  „Kolejność menu") mounts ONLY on Ustawienia (`/admin`) — moved off the Konto
  page 2026-08-03; it lists the user's VISIBLE items, moves a visible item by swapping
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
  test w node; `PROGRESS_EPS` = 1e-9 zdejmuje dryf 0,1 + 0,2). Od 2026-08-03
  komponent NIE RYSUJE już cienkiego paska postępu — w CAŁEJ aplikacji (lista
  zadań, karta projektu, Panel, arkusz szczegółów) zostaje sam tekst
  „zaplanowano X / szac. Y" (`showHours`) plus etykieta `.sr-only`. Tor miał
  stałą szerokość 56 px, więc na każdej karcie wyglądał tak samo i nie niósł
  nic ponad liczby stojące obok; razem z nim zniknęły klasy toru/wypełnienia i
  jedyna kolorowa reguła `over`. `percent`/`tone` zostają w module TS (jest
  jednostkowo testowany, tony to nadal semantyka), po prostu nie mają dziś
  konsumenta w DOM-ie; przy `showHours={false}` komponent renderuje WYŁĄCZNIE
  treść dla czytnika ekranu i celowo nie jest usuwany z wierszy.
  To WARSTWA PREZENTACJI — `planningStatusForTotals` /
  `taskPlanningStatus` zostają jedynym źródłem stanu i idą osobnym propsem
  `status`, żeby niuans zasobnika został w `.sr-only`.
  KARTY LISTY `.task-card` — i na `/tasks`, i na `/projects` — nie mają już
  strzałki `.card-chevron`: cała karta jest klikalna i podświetlana hoverem.
  Razem z JSX-em znikło z `styles.css` przypięcie i rezerwa `padding-right`
  dla `.task-card-main`, więc chevron NIE MOŻE tam wrócić bez własnych reguł.
  Ikona żyje dalej na wierszach zadań w karcie projektu
  (`.project-task-main`, przypięta absolutnie) i na wierszach osób
  (`.person-row`, w zwykłym przepływie, sam efekt hoveru).
  Usuwanie zadania idzie wspólnym wzorcem aplikacji: czerwony
  `Trash2` w `IconButton variant="danger"` — jak na Klientach i w Content
  planie — w OBU wariantach karty (desktop i telefon). Pigułka
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
  router navigation guard (scopes `task-modal`, `project-detail`,
  `ticket-modal`, `event-modal`, `task-page`, `contentplan-post-modal`,
  `contentplan-brand-modal`, plus a one-shot bypass) that App's
  `DirtyNavigationGuard` consults; only those surfaces register, so other routes
  and forms never gain a global blocker. Each scope reacts to the navigation
  that would actually discard it: its own search param, the pathname, or (for
  the page-mounted Content Plan modals) either one.

## Rules that change work

- UI strings are Polish.
- UTAJNIONA TREŚĆ (2026-08-05). Checkbox „Utajnij treść" (wzorzec
  `.checkbox-field`) widzi WYŁĄCZNIE zarząd (`isBoardMember`,
  `src/store/confidentiality.ts`): TaskModal (sekcja `details`), EventModal
  (pod uczestnikami; ukryty w trybie urlopu), formularz tworzenia w
  ProjectsPage i karta ProjectDetailPage. Wariant maskowany dla widza bez
  wglądu: bursztynowa plansza `.confidential-notice` (tokeny `--n2-warning*`,
  informacja — nie czerwień) + WYŁĄCZNIE fakty planistyczne. TaskModal:
  `SectionFlags.contentMasked` w `taskModalSections.ts` zostawia
  `period`/`people-hours`/`summary`/`allocation`/`done-blocks` (zakładka
  „Dyskusja" znika), nagłówek = etykieta „Zadanie #N", wymuszony read-only,
  usuwanie ukryte. EventModal: data/godziny/uczestnicy read-only, bez
  tytułu/opisu/lokalizacji/linku, bez „Usuń" (maska WYGRYWA z
  `events.manage` — dotyczy też adminów). ProjectDetailPage: wczesny return
  maskowanego wariantu strony (nagłówek „Projekt #N", plansza, okres i lista
  zadań z maskowanymi tytułami; bez opisu, dokumentów, dyskusji i edycji).
  Wszystkie powierzchnie list/kart (Zadania, Kanban, Projekty, Timeline,
  Obciążenie, Panel, Wydarzenia, wyszukiwarka) renderują tytuły przez
  display-helpery — nigdy surowe `task.title`/`project.name`/`event.title`.
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
  elementem treści. Pusty kafelek Powiadomień nie znika, tylko kurczy
  się do belki ~40 px (`dashTileView` + `.dash-card-bar`, `align-self: start`)
  i ZACHOWUJE swoją kotwicę `data-tour`. Alerty są wyjątkiem od tej reguły
  (`empty: null` w `dashTileView`): dzielą rząd z „Zasobnikiem", więc puste
  zostają PEŁNĄ kartą z wyśrodkowanym pustym stanem
  (`.dash-alerts-empty-card`), żeby rząd nie miał dziury. Nad siatką stoi
  najwyżej jedna linia dziennika zmian z jednym CTA („Nowości 20–21.07 →"),
  widoczna tylko dopóki `changelogUnread`; ten sam urządzeniowy
  `changelogSeenId` (`utils/uiPrefs.ts`, nie stan aplikacji) karmi licznik
  nieprzeczytanych paczek na stałym przycisku „Zobacz zmiany"
  (`changelogUnreadCount` + `.dash-changelog-badge`), zerowany otwarciem
  popoutu. Pasek tygodnia ma pięć kolumn dni
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
