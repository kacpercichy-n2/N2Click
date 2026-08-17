# Run state — 20260803-185957-n2hub-315 Content Plan: edytor i marki (R5)

## Goal

Edytor publikacji jako modal na `useModalShell` (draft + jawny zapis, walidacja
publikacji przy polach, komentarze wątkowane, historia, akcept klienta przez
`REVIEW_CP_POST`, media tylko odczyt fileId) oraz zarządzanie markami i
słownikami z guardem integralności referencyjnej. Zero nowych akcji reduktora,
zero nowych bibliotek, CSS tylko `cp-`.

## Packages

1. `handoffs/packages/PKG-20260803-contentplan-editor-brands.md` — tier
   developer, ready, risk medium, Codex required. Jeden pakiet (modale dzielą
   powłokę, stronę i scope'y strażnika).

## Changed boundaries (planned)

`ContentPlanPage.tsx` (parametry `?publikacja=`/`?marka=`, klik karty otwiera
edytor, toolbar/pusty stan), nowe `components/ContentPlanPostModal.tsx`,
`components/ContentPlanBrandModal.tsx`, czyste
`components/contentPlanPostEditor.ts` i `components/contentPlanBrandEditor.ts`
(+ testy node), `utils/dirtyRegistry.ts` (+test; scope'y
`contentplan-post-modal`/`contentplan-brand-modal`), `styles.css` (blok `cp-`),
`components/icons.ts`. Reduktor, domena, selektory, kalendarz — bez zmian.

## Verification

Focused vitest z pakietu (postEditor, brandEditor, dirtyRegistry,
contentPlanActions, contentPlanCalendar), potem pełne `npm test` +
`npm run build` (scheduler-owned). Browser: none (Playwright niezainstalowany;
powłoka modali już zweryfikowana).

## Open questions

Brak blokujących. Świadome decyzje D1–D10 w pakiecie; D10 (port przepływów RTL
jako testy node — repo nie ma RTL/jsdom) do potwierdzenia w werdykcie
recenzenta. Wiki: akapit `/content-plan` w `ui-navigation-and-onboarding.md`
stanie się nieaktualny (karta ma otwierać edytor) — aktualizacja po zielonym
runie.

## Developer result (R5)

Zmienione granice: `ContentPlanPage` (modale montowane w stronie,
`?publikacja=`/`?marka=`), nowe `ContentPlanPostModal`/`ContentPlanBrandModal`
+ czyste `contentPlanPostEditor.ts`/`contentPlanBrandEditor.ts` (+ testy node),
dwa scope'y w `dirtyRegistry`, blok `cp-` w `styles.css`, cztery ikony.
Reduktor, domena i selektory nietknięte. `npm test`: 116 plików / 2567 testów
zielone; `npm run build` zielony. Wiki `/content-plan` zaktualizowane.
Blokad brak.

## Developer result (R6, 20260803-193729-n2hub-316)

Import live TWS: nowy mapper `scripts/contentplan-seed-tws-mapper.mjs` (+`.d.mts`),
skrypt I/O `scripts/contentplan-seed-tws.mjs`, test
`src/contentplan/twsSeedImport.test.ts`, migracja
`supabase/migrations/20260803170000_contentplan_seed_tws.sql` (1 marka / 23 posty
/ 55 kanałów) i wpis w `migrations.test.ts`. Dwa uruchomienia = identyczny plik.
`npm test` 117/2591 zielone, `npm run build` zielony. Nic nie aplikowano do bazy.
Wiki bez zmian.

## Developer result (R7, 20260803-195851-n2hub-317)

Nowe granice: `src/contentplan/google.ts` (GIS + Picker, leniwe skrypty tylko w
chunku `/content-plan`) i `src/contentplan/driveFolders.ts` (schemat
`contentplan` + fallback localStorage, cicha degradacja missing-table). Edytor
posta dostał sekcję mediów (`setChannelMedia`), `.env.example` dwie zmienne
Google. `npm test` 119 plików / 2634 testy zielone, `npm run build` zielony.
Wiki `/content-plan` zaktualizowane. Blokad brak.

## Developer result (R8, 20260803-202156-n2hub-318)

Nowe granice: `diffContentPlanToCloudOps` + routing `CloudOp.schema` w
`applyCloudOps` (cloudMirror), `createSupabaseContentPlanDb` +
`loadContentPlanSnapshot` (plannerData), akcja `MERGE_CLOUD_CONTENT_PLAN`
(AppStore), podpięcie w `CloudSyncProvider`, wiersz modułu w `exportDryRun`.
Realtime ŚWIADOMIE pominięty. `npm test` 119 plików / 2663 testy zielone,
`npm run build` zielony. Wiki: cloud-database + state-and-persistence.
Ograniczenie: marka o id-slugu (utworzona lokalnie) nie jedzie do chmury.

## Test-writer result (R9, 20260803-204922-n2hub-319)

Zweryfikowano 8 case'ów defects: wszystkie przeportowane albo N/A (login mock,
readAssetFile, uid-kolizja) dla obecnej architektury. Brak luk, brak zmian w
testach. Sweep a-g: PASS wszystkie (RLS 6/6, brak Mantine/nowych libów, brak
base64, brak dashy). `npm test` 119/2663 zielone, build zielony. Wiki
unchanged (oba źródła aktualne).

## Developer result (20260803-210302-n2hub-321)

Tylko `src/styles.css`. Nowy token `--n2-control-h: 36px` scala wysokości
kontrolek belki (`.toggle-btn`, `.nav-btn`, `.cal-toolbar .btn`, chip osoby,
plakietka zegara). `.nav-btn` centruje glif flexem plus korekta 1,5 px,
zerowana przy strzałkach i ikonach. `.cal-view-toggle` odłączone od `.cal-nav`
i sklejone wspólnie z `.ticket-mode-toggle`. Bez zmian w JSX. `npm test`
119/2663 zielone, `npm run build` zielony. Wiki unchanged.

## Developer result (20260803-212145-n2hub-322)

`PlanningProgress.tsx` bez paska (zostaje tekst godzin + `.sr-only`, util
nietknięty), `TasksPage.tsx` usuwanie na `Trash2`, bez `.card-chevron` (po
werdykcie także `ProjectsPage.tsx` — dzieliła `.task-card-main`),
`styles.css`: martwe reguły toru i chevronu karty (z rezerwą 40 px) oraz
`background-attachment: fixed` osobną deklaracją (skrót przyklejał tylko
ostatnią warstwę). `npm test` 119/2663 zielone, build zielony. Wiki: UI +
frontend-performance.

## Developer result (20260803-213841-n2hub-323)

`ClientsPage.tsx`: nagłówek karty bez chevrona (nazwa + pigułka-link projektów,
CTA „Zobacz szczegóły" z `aria-expanded`/`aria-controls`, `IconButton` edycja/
archiwum/usuwanie, archiwizacja przez `useConfirm()`), `icons.ts`
`ArchiveRestore`, `App.tsx` + `styles.css`: dwa paski `sticky` w `.app-main`
(tło strony + maska, `--n2-z-scroll-fade`) miękko wygaszające krawędzie
przewijania; dokument zostaje scrollportem. Po recenzji: `.editor-actions-sticky`
na `--n2-z-sticky-actions` (30) — na `/projects/:id` przykleja się do dokumentu,
więc wygaszenie (20) kryło mu krawędź i „Zapisz teraz". `npm test` 119/2663
zielone, build zielony. Wiki: UI.

## Developer result (20260803-221312-n2hub-324)

`changelog.ts` + testy: `changelogUnreadCount`. `DashboardPage.tsx`: przycisk
„Zobacz zmiany" z ikoną `History` i plakietką licznika (ten sam
`changelogSeenId`), puste Alerty jako pełna karta z pustym stanem.
`dashboardPanels.ts`: alerts `empty: null` (nigdy belka) — test zwijania
zaktualizowany świadomie. `styles.css`: badge + `.dash-alerts-empty-card`.
`npm test` 119/2669 zielone, build zielony. Wiki: UI.

## Developer result (20260803-222602-n2hub-325)

`AccountPage.tsx`: karty owinięte w `.account-grid` (sam wrapper, warunki i
logika bez zmian). `styles.css`: siatka 2 kolumn z zerowanym `margin-bottom`
kart i zwinięciem do 1 kolumny w `max-width: 760px` (breakpoint z pliku),
`.cloud-profile` dt/dd z `overflow-wrap: anywhere` (długi e-mail zawija się),
`.page > .people-form-hint` z odstępem nad listą osób. `npm test` 119/2669
zielone, build zielony. Wiki: bez zmian (brak nowej granicy ani inwariantu).

## Developer result (20260813 — migracja czatu)

Nowa `supabase/migrations/20260813180000_chat.sql`:
`n2click.conversations/conversation_members/messages`, trzy helpery `app.*`,
triggery Broadcast/bump, RPC `chat_overview`. Tabele świadomie poza
`supabase_realtime`; polityki `chat_*` na `realtime.messages`.
`migrations.test.ts`: lista, cztery wpisy `EXPECTED_POLICIES`, regex tabel
z cyframi, revoke-anon dla naszych schematów. `npm test` 2831/2832 — jedyna
porażka `contentplan/google.test.ts` (lokalny `.env.local`). Nic nie
aplikowano na bazę.

## Developer result (20260813 — rdzeń czatu)

Nowy `src/chat/`: `types`, `chatData` (wstrzykiwany `ChatDb`, kursor
`(created_at,id)`, fallback 23505), `chatState` (dedup/unread/resort),
`ChatProvider` (`useChat`, prywatne kanały broadcast + presence,
`realtime.setAuth`), dwa testy. `npx vitest run src/chat` 53/53; `npm test`
2883/2884 (porażka `contentplan/google` — `.env.local`); build zielony.
Provider niezamontowany, zero UI. Kontekst +migracja czatu (RLS członków).
Wiki bez zmian.

## Developer result (20260813 — UI czatu „bąbelki")

Nowe `src/chat/ui/`: 4 czyste modele widoku z testami + 5 cienkich komponentów.
`Avatar.tsx` wystawia `AvatarBase`, `icons.ts` +3 ikony, `styles.css` sekcja
czatu i token `--n2-z-chat: 890`, montaż w `main.tsx` (ChatProvider w
AvatarUrlsProvider, ChatDock obok routera). `npx vitest run src/chat` 106/106;
`npm test` 2937/2938 (znana porażka `contentplan/google`); build zielony.
Przeglądarka niesprawdzona (brak playwrighta). Wiki bez zmian.

## Developer result (chat A — PKG-20260817-chat-fixes, pakiet A)

Zmienione granice: `ChatDock.tsx` (zero stanu `collapsed`; klik w AKTYWNY
bąbelek woła `chat.closeConversation()`, bąbelek zostaje przez `recentIds`;
efekt dokłada klasę `n2chat-on` na `<html>` — powłoka NIE czyta `useChat()`;
ikona bąbelka-listy to `MessagesSquare`), `ChatWindow.tsx` (bez propsów
`collapsed`/`onToggleCollapse`, bez chevronów, nagłówek to blok
`.n2chat-window-titles`, X i Escape zamykają, lista+kompozytor zawsze
renderowane, `enterKeyHint="send"`), nowy `src/chat/ui/useChatKeyboardInset.ts`
(nasłuch `visualViewport` na `resolveKeyboardInset`, tylko `MOBILE_NAV_QUERY`;
`useModalShell` NIETKNIĘTY), `ChatSearchPopover.tsx` (ten sam hook na panelu),
`icons.ts` (`ChevronDown`/`ChevronUp` usunięte — nie miały innych importerów,
`MessagesSquare` dodany), `styles.css` (reguła rynny `.n2chat-on .app-shell`
przy `.app-shell`, zdjęte `.is-collapsed` i `.n2chat-window-title-btn`, hovery
bąbelka i Send pod `@media (hover: hover)`, `70vh`→`70dvh`, telefon: 16 px na
polach, `--n2-kb-inset` w `bottom` i pułapie wysokości okna/popovera,
`env(safe-area-inset-right)` na kolumnie). `chatDockView.test.ts` +1 test
(zamknięta rozmowa zostaje w kolumnie). Reduktor, storage, `chatData.ts`,
`ChatProvider.tsx`, `useModalShell.ts`, migracje: bez zmian.

Testy/build: `npx vitest run src/chat` 112/112; `npm test` 2943/2944 — jedyna
porażka to znana środowiskowa `contentplan/google.test.ts` (`.env.local` ma
`VITE_GOOGLE_API_KEY`, więc „brak konfiguracji" nie zachodzi); `npm run build`
zielony; `npm run check:openwiki` — 6 plików OK.

Przeglądarka (Chrome, dev server w trybie lokalnym, pomiar w iframe'ach o
zadanym viewporcie): rynna 24→88 px przy 1440/1181/1000/761 px, sidebar
zwinięty i rozwinięty, zero poziomego scrolla; 760 i 390 px bez zmian (16 px).
Geometria telefonu 390×844 na syntetycznym fragmencie `.n2chat-*`: pola 16 px,
okno `bottom` 64 px / `height` 480 px / `max-height` 772 px bez klawiatury
(1:1 ze stanem sprzed zmian), a przy `--n2-kb-inset: 320px` → `bottom` 384 px,
`max-height` 452 px (górna krawędź 836 ≤ 844); popover 128→448 px, pułap
480→388 px. Blokada: sam dok montuje się dopiero z sesją chmurową, więc
klik-zamknij/klik-otwórz na ŻYWYCH bąbelkach nie był klikany — sprawdzony
jest czysty kontrakt (`buildDockBubbles` + test) i CSS. Wiki bez zmian
(żaden opisany kontrakt ani trasa testowa się nie przesunęły).

Poprawka po przeglądzie (Codex, ten sam przebieg): `useChatKeyboardInset`
miał bramkę `if (!isMobile()) return` NA WEJŚCIU do efektu, a efekt ma stałe
zależności — panel otwarty powyżej 760 px nigdy nie dostawał nasłuchu i po
zejściu poniżej breakpointu (zmiana rozmiaru okna, obrót tabletu, Split View)
klawiatura znów przykrywała kompozytor. Bramka przeniesiona do `sync()`,
doszedł nasłuch `change` na `matchMedia`, a `applyInset` pamięta ostatnią
wartość (`visualViewport` sypie `scroll` przy każdym drgnięciu widoku).
Desktop nadal bit w bit: `sync()` woła `applyInset(0)`, czyli `removeProperty`
na czystym elemencie — sprawdzone w Chrome, atrybut `style` NIE powstaje.
Samego przejścia przez breakpoint nie udało się odpalić w harnessie: Chrome
nie wysyła zdarzenia `change` do `MediaQueryList` w iframie zmienianym przez
rodzica (`matches` aktualizuje się dopiero przy odczycie). Ta sama ścieżka
`change` niesie dolny pasek telefonu przez `utils/useMediaQuery.ts`, a drugim,
niezależnym budzikiem jest `visualViewport.resize`, który przy każdej zmianie
rozmiaru okna woła ten sam `sync()`.

## Developer result (chat B) — PKG-20260817-chat-fixes, pakiet B (linki, GIF, emoji)

Zmienione granice (poza `src/chat/ui/*` i blokiem `n2chat` w `styles.css` nic
nie ruszone; `chatData.ts`, `ChatProvider.tsx`, `types.ts`, reduktor, storage i
baza BEZ ZMIAN):

- NOWE czyste moduły + testy node: `chatRichText.ts` (`tokenizeMessage`,
  `isGifUrl`, `isEmojiOnly`, `messageContentKind`), `chatEmoji.ts`
  (`EMOJI_CATEGORIES` — 8 kategorii / 199 pozycji, `filterEmoji`,
  `pushRecentEmoji`, `insertAtCaret`, `emojiLabel`), `chatGifs.ts`
  (`buildTenorSearchUrl`, `parseTenorResponse`, `tenorApiKey` — ZERO `fetch`).
- NOWE komponenty: `ChatEmojiPopover.tsx`, `ChatGifPopover.tsx` — obydwa na
  `useOverlay` w wariancie NIEPOZYCJONOWANYM (jak `ChatSearchPopover`), ale
  jako DZIECI `.n2chat-composer` wewnątrz okna, nie przez portal. Okno ma już
  własną warstwę `--n2-z-chat`, więc nowy token z-index nie był potrzebny.
- `ChatWindow.tsx`: render dymka idzie przez `ChatMessageBody` (segmenty
  tokenizera → `<a target="_blank" rel="noopener noreferrer">`, sam adres
  GIF-a → `<img loading="lazy">` w dymku `.is-gif`, 1–3 emoji → `.is-jumbo`).
  Zero `dangerouslySetInnerHTML`. Dwa przyciski kompozytora (`Smile`,
  `ImagePlay`); przycisk GIF NIE renderuje się bez `VITE_TENOR_API_KEY`.
  „Ostatnie" emoji to `useState` okna — celowo nie localStorage.
- `chatDockView.ts`: `previewText` pokazuje „GIF" dla wiadomości będącej samym
  adresem GIF-a (`Ty: GIF`, `Ola Kowalska: GIF`); adres z komentarzem zostaje
  tekstem. Nowy import `messageContentKind` — bez cyklu (rich text nic z doku
  nie bierze).
- `styles.css`: `white-space: pre-wrap` na `.n2chat-msg-text` (D7),
  `.is-jumbo`, `.n2chat-link` (+ wariant w moim dymku), `.n2chat-bubble-msg.is-gif`
  + `.n2chat-gif`, wspólna powłoka `.n2chat-inpop`, siatki emoji/GIF,
  `.n2chat-composer-btn`; `≤760 px` podnosi przyciski i kafelki emoji do 44 px
  i tnie panel do `min(300px, 40dvh)`. Wyłącznie tokeny `--n2-*`, hover-transformy
  pod `@media (hover: hover)`, czasy przez `--n2-transition` (`--n2-motion`).
- `icons.ts`: eksport `Smile`, `ImagePlay` z komentarzem. `.env.example`:
  `VITE_TENOR_API_KEY` z polskim opisem (Google Cloud → ten sam projekt co
  Picker → włącz „Tenor API" → klucz ograniczony do Tenor API + referrerów).

Kontrast linków: cudzy dymek `--n2-lavender` na `--n2-glass`/`--n2-surface-strong`
= 6,4:1; mój dymek (gradient marki) dziedziczy `--n2-lavender-mist` i wyróżnia
się grubszym podkreśleniem, bo lawenda zeszłaby tam poniżej progu.

Wyniki: `npx vitest run src/chat` → 169/169 PASS. `npm test` → 3000 PASS,
1 FAIL: `src/contentplan/google.test.ts` „bez zmiennych środowiskowych powód
blokady jest po polsku" — znana awaria ŚRODOWISKOWA (lokalny `.env.local` ma
`VITE_GOOGLE_*`, więc „brak konfiguracji" nie zachodzi), niezwiązana z pakietem.
`npm run build` zielony. `npm run check:openwiki` — 6 plików OK.

Blokada weryfikacji w przeglądarce: dok montuje się WYŁĄCZNIE przy
`auth.mode === 'supabase'` i zalogowanej sesji (`ChatProvider`: `signedIn &&
selfId !== null`), a logowanie do chmury było poza zakresem tego przebiegu.
NIC nie było klikane w przeglądarce. Zamiast tego: testy czyste na całej
decyzyjności (tokenizer, GIF-y, emoji, podgląd listy) + statyczna kontrola
zbudowanego arkusza `dist/assets/style-*.css` — potwierdzone obecne reguły
`.n2chat-msg-text{white-space:pre-wrap}`, `.is-jumbo`, `.n2chat-link`,
`.n2chat-bubble-msg.is-gif`, `.n2chat-inpop`, `.n2chat-emoji-grid`,
`.n2chat-gif-grid`, `.n2chat-composer{position:relative}` oraz blok 44 px
w `@media (max-width: 760px)`. Żywy ruch sieciowy do Tenora też NIE był
wykonany (brak klucza w tym środowisku) — pokryte jest mapowanie odpowiedzi
na realistycznej atrapie i budowanie adresu.

Wiki bez zmian: powłoka popovera to ten sam `useOverlay` w wariancie
niepozycjonowanym, który `frontend-performance-and-primitives.md` już opisuje;
żadna trasa testowa ani kontrakt się nie przesunęły.

## Fixer result (chat A+B)

Werdykt: PASS po czterech poprawkach last-mile. `chatRichText.ts` rozpoznaje
teraz flagi i keycapy jako pojedyncze grafemy emoji (1–3 jumbo, 4+ zwykły
tekst), a test tokenizera obejmuje także `),`, sam prefiks `https://`, domenę
Unicode i końcowy `?`. `chatGifs.ts` przepuszcza do obu `<img>` wyłącznie
adresy http(s), które przechodzą `isGifUrl` (sam poprawny schemat już nie
wystarcza). `ChatGifPopover.tsx` nie ustawia stanu po odmontowaniu podczas
asynchronicznej wysyłki, a `ChatWindow.tsx` nie kończy udanej wysyłki GIF-a
aktualizacją odmontowanego okna. Etykiety dwóch wyzwalaczy doprecyzowano po
polsku. Dodatkowo końcowy stan zawiera adresowane `dismissPicker` w
`chatWindowView.ts`: spóźnione zamknięcie wychodzącego panelu AnimatePresence
nie gasi świeżo otwartego sąsiada; czysty test pokrywa przełączenie emoji↔GIF.

Bezpieczeństwo, kompozytor, kontrakt jednego okna, CSS telefonu, hook klawiatury
i dostępność: PASS. Brak `dangerouslySetInnerHTML`; oba rodzaje zewnętrznych
odnośników mają `_blank` + `noopener noreferrer`; brak logowania lub wysyłania
klucza Tenora w treści. Brak chatowych pozostałości `collapsed`, wywołań
`markRead` w UI, arbitralnego z-indexu i transformacji hover poza
`@media (hover: hover)`. Rynna jest wyłącznie od 761 px; 390×844 mieści panel
300 px nad minimalnym kompozytorem w oknie 480 px (107 px zapasu od górnej
krawędzi okna). `useChatKeyboardInset` usuwa trzy nasłuchy i właściwość CSS,
zeruje ją poza mobile oraz nie zmienia `useModalShell`.

Weryfikacja końcowego stanu: `npx vitest run src/chat` 9 plików / 179 testów
PASS; `npm test` 134 pliki / 3010 testów PASS i dokładnie 1 dozwolony FAIL w
`src/contentplan/google.test.ts` (lokalne `.env.local` ma ustawione oba
`VITE_GOOGLE_*`); `npm run build` PASS; `npm run check:openwiki` 6 plików PASS;
`npx vitest run src/utils/stylesheetContract.test.ts` 1 plik / 8 testów PASS;
`git diff --check` PASS. Przeglądarki nie uruchamiano: dok wymaga sesji
Supabase, a logowanie było zakazane; żywy Tenor i interakcje fokusa pozostają
do smoke testu operatora po zalogowaniu. Wiki bez zmian: strona nie zawiera
twierdzenia o pozycjonowaniu `.n2chat-inpop`, które stałoby się nieaktualne.
Chronione `n2media-agency-dashboard-style.css` i `reports/` pozostały
nietknięte przez Fixera.

### Poprawka po przeglądzie stop-time (Codex) — pakiet B

1. WYŚCIG PRZEŁĄCZANIA PICKERÓW — naprawiony. `AnimatePresence` trzyma
   wychodzący panel zamontowanym na czas animacji wyjścia (~160 ms), więc jego
   `useOverlay` jeszcze żyje: pierwsze kliknięcie w NOWO otwarty panel wypadało
   dla starego „na zewnątrz" i bezwarunkowe `setPicker('none')` gasiło świeżo
   otwarty panel. Decyzja wyjęta do czystego `chatWindowView.ts`:
   `togglePicker(current, which)` (klik w przycisk) i `dismissPicker(current,
   which)` (sygnał z powłoki, ADRESOWANY — gasi wyłącznie panel, który nadal
   jest otwarty). `ChatWindow.tsx` ma już tylko dwie cienkie owijki
   (`flipPicker`, `closePicker`). Test node w `chatWindowView.test.ts` —
   „spóźniony sygnał wychodzącego panelu nie gasi świeżo otwartego sąsiada".
2. PROVISIONING PICKERA GIF — połowa kodowa sprawdzona i sprawna: build z
   `VITE_TENOR_API_KEY=TESTKEY_ZZZ9` wstrzykuje do bundla literał
   `VITE_TENOR_API_KEY:"TESTKEY_ZZZ9"` obok pozostałych `VITE_*`, a
   `tenorApiKey(import.meta.env)` czyta dokładnie ten obiekt — czyli zmienna
   faktycznie dociera do przycisku GIF. Otwarte zostaje pytanie ZEWNĘTRZNE
   (czy klucz Tenora da się dziś w ogóle wyrobić w Google Cloud) — oddane do
   Researchera, kontekst `tenor-gif-key-provisioning`; instrukcja w
   `.env.example` może wymagać przepisania albo zamiany dostawcy.

Wyniki po poprawce: `npx vitest run src/chat` → 179/179 PASS; `npm test` →
3010 passed, 1 failed (ta sama znana awaria środowiskowa
`src/contentplan/google.test.ts`); `npm run build` zielony (✓ 4.39s);
`npm run check:openwiki` — 6 plików OK.

## Developer result (chat follow-up)

Dwie usterki ze stop-time review, chirurgicznie. `chatData.ts`,
`ChatProvider.tsx`, `types.ts`, `store/*`, `useModalShell.ts`, migracje i baza:
BEZ ZMIAN. Zero nowych zależności.

USTERKA 1 — MINIMALIZACJA GUBIŁA SZKIC. Od pakietu A minimalizacja to
`closeConversation()`, więc `ChatWindow` się odmontowuje, a lokalny
`useState('')` kompozytora wyrzucał wpisany tekst. Szkice wyjechały piętro
wyżej, do `ChatDockInner`: `useState<ChatDrafts>({})` (pamięć sesji, świadomie
NIE localStorage — szkic czatu nie jest danymi planera), a okno dostaje
`draft` / `onDraftChange` i nie ma już własnego stanu treści. Efekt uboczny
pożądany: szkice są PER ROZMOWA, więc przełączenie bąbelka nie miesza tekstów.
Niemutujące pomocniki wylądowały w czystym `chatDockView.ts` obok `pushRecent`
(ta sama natura: stan sesji doku): `setDraftFor(drafts, id, value)` i
`clearDraftFor(drafts, id)` — pusta treść USUWA klucz, brak zmiany oddaje TĘ
SAMĄ referencję. Cztery testy node w `chatDockView.test.ts`: zapis/podmiana,
kasowanie pustą treścią, tożsamość referencji, izolacja rozmów.
Dwa szczegóły: (a) efekt „nowa rozmowa" nie zeruje już szkicu (zeruje tylko
picker i pozycję scrolla); (b) nowy `useLayoutEffect` na `conversation.id`
dosynchronizowuje wysokość `textarea` z odtworzonego szkicu — `rows={1}` po
zamontowaniu dawałoby jeden wiersz i ucięcie kilkuwierszowego tekstu do
własnego scrolla. Wysyłka przy odmontowanym oknie (zamknięcie w trakcie)
i tak czyści szkic, bo ten należy teraz do doku. „Ostatnie" emoji zostają
stanem okna — bez zmian.

USTERKA 2 — ATRYBUCJA TENORA PRZY UDOSTĘPNIENIU. Stopka pickera („Powered by
Tenor") była jedynym podpisem; sam WYNIK (dymek z GIF-em) nie miał ani
atrybucji, ani zgłoszenia udostępnienia.
(a) `chatGifs.ts`: czyste `buildTenorRegisterShareUrl({apiKey, gifId, query})`
→ `…/v2/registershare?key&client_key=n2hub&id&q&locale=pl_PL&country=PL`
(`q` odpada dla listy startowej; brak klucza albo `id` daje '' i wywołujący
pomija zapytanie) + trzy testy node. `ChatGifPopover.tsx` po UDANEJ
`chat.sendMessage` strzela `fetch(url, { keepalive: true }).catch(() => {})` —
bez `await`, bez `signal` (kontroler listy przerwałby je przy zamknięciu
panelu), bez własnego stanu i bez komunikatu; nieudane zgłoszenie statystyki
nie ma prawa dotknąć rozmowy.
(b) `chatRichText.ts`: czyste `gifAttribution(url): 'tenor' | null` (host
dokładnie `media.tenor.com`, adres musi być http(s)) + dwa testy node.
`ChatWindow` renderuje pod obrazkiem `<span class="n2chat-gif-credit">via
Tenor</span>` — formuła po angielsku, bo taka jest wymagana. CSS w bloku
`n2chat`, wyłącznie tokeny: `--n2-type-xs`, `--n2-text-muted`, a w moim dymku
(gradient marki) `--n2-lavender-mist`, dokładnie jak godzina wiadomości, która
kontrast na tym tle ma już potwierdzony. Dymek jest kolumną flex, więc podpis
siada pod obrazem bez zmiany struktury.

Pliki: `src/chat/ui/ChatDock.tsx`, `src/chat/ui/ChatWindow.tsx`,
`src/chat/ui/chatDockView.ts` (+ `chatDockView.test.ts`),
`src/chat/ui/chatGifs.ts` (+ `chatGifs.test.ts`),
`src/chat/ui/chatRichText.ts` (+ `chatRichText.test.ts`),
`src/chat/ui/ChatGifPopover.tsx`, `src/styles.css`.

Weryfikacja: `npx vitest run src/chat` → 188 PASS / 0 FAIL (było 179 — dziewięć
nowych przypadków). `npm run build` (czyli `tsc --noEmit && vite build`) →
zielony, ✓ 11.04s; zbudowany arkusz zawiera obie reguły
`.n2chat-gif-credit`. `npm test` → 134 pliki i 3019 testów PASS, 1 FAIL:
`src/contentplan/google.test.ts` „bez zmiennych środowiskowych powód blokady
jest po polsku" — POTWIERDZONA awaria środowiskowa, lokalny `.env.local` ma
oba `VITE_GOOGLE_*`, więc „brak konfiguracji" nie zachodzi; niezwiązana ze
zmianą. `npx vitest run src/utils/stylesheetContract.test.ts` → 8 PASS.

NIE zweryfikowano w przeglądarce: dok montuje się wyłącznie przy sesji
Supabase, a logowanie było poza zakresem. Do smoke testu operatora po
zalogowaniu zostają: (1) wpisanie tekstu → klik w aktywny bąbelek → ponowne
otwarcie (szkic i wysokość pola wracają); (2) wysłanie GIF-a i podpis „via
Tenor" w dymku; (3) żywe `registershare` w karcie Sieć (wymaga klucza
`VITE_TENOR_API_KEY`, którego to środowisko nie ma). Wiki bez zmian: żadna
granica ani trasa testowa opisana w `frontend-performance-and-primitives.md`
się nie przesunęła — szkic to stan sesji doku, nie nowy wzorzec prymitywu.

### Werdykt rozpoznania: Tenor API jest MARTWY (Researcher, 17.08.2026)

Kontekst `tenor-gif-key-provisioning`. Ustalenia ze źródeł pierwotnych:

- Google zamknął wydawanie NOWYCH kluczy Tenor API 13.01.2026, a 30.06.2026
  wyłączył wszystkie integracje. Żywe sprawdzenie `gcloud` z 17.08.2026 zwraca
  pustą listę dla `tenor.googleapis.com`. Instrukcja, którą dopisaliśmy do
  `.env.example` („Google Cloud > Library > Tenor API > Enable"), jest dziś
  NIEWYKONALNA — i to jest właściwa treść uwagi „picker GIF-ów nie jest
  provisionable".
- Archiwalne zasady bez zmian: atrybucja obowiązkowa, `client_key` tylko
  zalecany, schemat `results`/`media_formats`/`next` niezmieniony.
- Działające zamienniki BEZ własnego backendu: GIPHY „Tenor Compatibility API"
  oraz KLIPY. Oba: self-service klucz test/beta 100 żądań/h, CORS `*`, klucz
  webowy może być publiczny, atrybucja obowiązkowa; produkcja = osobny wniosek.

ZAKRES SZKODY jest wąski: dotyczy WYŁĄCZNIE pickera (D5b). Render GIF-ów (D5a)
jest niezależny i działa — wklejony adres `.gif` albo host
`media.tenor.com`/`media*.giphy.com`/`i.giphy.com` renderuje się inline i
pokazuje jako „GIF" na liście rozmów. Bez pickera funkcja degraduje się do
„wklej adres GIF-a", która już jest na miejscu. Przycisk GIF i tak nie
renderuje się bez klucza, więc nic się dziś nie psuje na ekranie.

Zamiana dostawcy zmienia decyzję D5b z pakietu, więc NIE podejmuję jej sam —
poszła do Commandera (kontekst `chat-gif-provider-d5b`) z czterema wariantami:
(A) GIPHY Tenor-compat — podmiana stałych endpointu i nazwy zmiennej, builder
i parser zostają, bo schemat ten sam; (B) KLIPY — nowy builder i parser;
(C) usunięcie pickera, zostaje sam render D5a; (D) uśpiony kod pickera plus
poprawiony komentarz w `.env.example`. Do rozstrzygnięcia także: limit 100/h,
nazwa zmiennej, treść atrybucji, ten przebieg czy osobny pakiet.

Stan drzewa w tym momencie (po poprawce wyścigu i równoległej pracy nad
szkicami kompozytora): `npx tsc --noEmit` czysty, `npx vitest run src/chat`
188/188 PASS, `npm run build` zielony.

## Fixer result (chat follow-up)

Werdykt: PASS po jednej poprawce last-mile. Szkice są stanem
`useState<ChatDrafts>` w `ChatDockInner`, per `conversation.id`; `ChatWindow`
nie ma lokalnego stanu treści i wszystkie ścieżki (pisanie z `sendTyping`,
emoji z karetką i limitem, udana wysyłka) idą przez `draft` /
`onDraftChange`. Zamknięcie i przełączenie bąbelka nie miesza tekstów,
odtworzony wielowierszowy szkic synchronizuje wysokość pola w layout effect,
a udana wysyłka kończąca się po odmontowaniu okna nadal czyści wpis doku.
`setDraftFor` / `clearDraftFor` są niemutujące, izolują rozmowy i zachowują
referencję przy no-opach. Brak użycia localStorage.

Atrybucja Tenora: builder `registershare` ma wymagany endpoint i parametry,
odrzuca pusty klucz/id, a picker uruchamia go bez `await`, bez `signal`, z
`keepalive`, wyłącznie po udanej wysyłce i bez błędu dla użytkownika.
`gifAttribution` rozpoznaje wyłącznie http(s) na dokładnym hoście
`media.tenor.com`; wspólny renderer dymka dodaje „via Tenor" zarówno dla
własnych, jak i cudzych wiadomości, z osobnym kontrastowym kolorem na
gradiencie własnego dymka. Stopka „Powered by Tenor" pozostaje.

Fixer poprawił jeden skutek uboczny: `ChatWindow.sendGif` zwracał `false`, gdy
wiadomość została wysłana poprawnie, ale okno zdążyło się odmontować. To
blokowało `registershare` mimo sukcesu `sendMessage`. Odmontowanie pomija teraz
tylko aktualizacje UI; wynik `true` nadal wraca do żyjącego callbacku pickera,
który zgłasza udostępnienie. Nie ma setState po odmontowaniu. Kontrakt propsów
kompiluje się, klucz AnimatePresence `openConversation.id` jest bez zmian,
a szkice nie trafiają do popovera wyszukiwania.

Weryfikacja końcowa: `npx vitest run src/chat` — 9 plików / 188 testów PASS;
`npm test` — 134 pliki / 3019 testów PASS i dokładnie 1 dozwolony FAIL w
`src/contentplan/google.test.ts` (lokalne `.env.local` ma oba
`VITE_GOOGLE_*`); `npm run build` PASS, 3272 moduły, build 8,40 s;
`npx vitest run src/utils/stylesheetContract.test.ts` — 1 plik / 8 testów
PASS; `git diff --check` PASS. Przeglądarki nie uruchamiano zgodnie z zakazem
logowania. Ryzyko operatora: żywe odtworzenie wysokości/fokusa, podpis w dymku
i request `registershare` wymagają smoke testu z sesją. Osobno, Tenor API jest
wyłączone od 30.06.2026 i nowego klucza nie da się wydać; wybór dostawcy jest
oczekującą decyzją Commandera, więc Fixer nie zmieniał integracji ani
`.env.example`. Chronione pliki i zabronione granice pozostały nietknięte.

### Poprawka po przeglądzie stop-time (Codex) — szkice

SPÓŹNIONA WYSYŁKA KASOWAŁA NOWSZY SZKIC. Skoro szkic przeżywa zamknięcie okna,
bezwarunkowe `onDraftChange('')` po udanej wysyłce było błędem: przy wolnej
sieci odpowiedź potrafi wrócić, gdy w polu jest już inny tekst — wpisany dalej
w tym samym oknie albo w oknie ZAMKNIĘTYM I OTWARTYM NA NOWO. Stary strzał
kasował wtedy świeże słowa.

Sprzątanie jest teraz porównaniem: czysty `clearSentDraft(drafts, id, sent)` w
`chatDockView.ts` kasuje wpis tylko wtedy, gdy nadal trzyma DOKŁADNIE treść,
która poszła w wiadomości; inaczej oddaje tę samą referencję. Okno dostało
osobny wywoład `onDraftSent(sent)` i przekazuje SUROWY szkic sprzed wysyłki
(`draft`, nie przycięty `composer.value` — w polu mogła zostać spacja). Trzy
nowe testy node: kasowanie po zgodnej treści (także z końcową spacją), spóźniona
wysyłka zostawia nowszy tekst i nie rusza cudzych rozmów, idempotencja.

Przy okazji wysokość kompozytora ma JEDNO źródło: `useLayoutEffect` na
`[conversation.id, draft]`. Wcześniej liczyły ją trzy miejsca (`onChange`, efekt
karetki, `style.height='auto'` po wysyłce), a to ostatnie zwijało pole nawet
wtedy, gdy szkicu nie skasowano — czyli akurat w przypadku, który ta poprawka
ratuje. Zostawiona bez zmian poprawka przeglądu w `sendGif`: odmontowanie
wyłącza tylko aktualizacje UI, wynik `true` dalej dociera do pickera, więc
udana wysyłka nadal zgłasza Tenorowi `registershare`.

Weryfikacja po poprawce: `npx vitest run src/chat` → 191 PASS / 0 FAIL;
`npm run build` → zielony (✓ 4.35s); `npm test` → 134 pliki, 3022 PASS i ten sam
1 dozwolony FAIL `src/contentplan/google.test.ts` (środowiskowy, lokalny
`.env.local` ma oba `VITE_GOOGLE_*`); `npx vitest run
src/utils/stylesheetContract.test.ts` → 8 PASS. Przeglądarki nadal nie
uruchamiano (dok wymaga sesji Supabase).

### Poprawka po drugim przeglądzie stop-time (Codex) — szkice, ciąg dalszy

PISANIE W TRAKCIE WOLNEJ WYSYŁKI ZOSTAWIAŁO WYSŁANY POCZĄTEK. Porównanie
„kasuj tylko, gdy szkic jest identyczny" ratowało dopisane słowa, ale gdy
odpowiedź wracała po dopisaniu czegokolwiek, w polu zostawała CAŁOŚĆ — razem z
tekstem, który już poszedł. Kolejne Enter wysyłało go drugi raz.

`clearSentDraft` odejmuje więc od szkicu dokładnie wysłaną treść zamiast ją
porównywać: szkic równy wysłanemu znika, wysłana treść będąca POCZĄTKIEM szkicu
zostawia sam dopisany ogon, a każdy inny kształt (tekst przepisany, inna
rozmowa, okno otwarte na nowo z czymś innym) zostaje nietknięty — nie da się
tam bezpiecznie odjąć. Ogon zostaje surowy, bez przycinania: separator wpisany
przez użytkownika jest jego, a `composerState` i tak przycina treść wysyłki.
Dwa nowe testy node (dopisany ogon ze spacją i z nową linią, tekst przepisany
od początku zostaje bez zmian).

Weryfikacja: `npx vitest run src/chat` → 192 PASS / 0 FAIL; `npm run build` →
zielony (✓ 17.16s); `npm test` → 3023 PASS i ten sam 1 dozwolony FAIL
`src/contentplan/google.test.ts`; `npx vitest run
src/utils/stylesheetContract.test.ts` → 8 PASS. Przeglądarki nie uruchamiano.

### Poprawka po trzecim przeglądzie stop-time (Codex) — szkice, koniec zgadywania

ODEJMOWANIE WSPÓLNEGO POCZĄTKU PSUŁO SZKIC NAPISANY OD NOWA. Reguła „wysłana
treść jest początkiem szkicu, więc ją odetnij" nie umie odróżnić dopisywania od
napisania czegoś nowego, co przypadkiem zaczyna się tak samo: wysłane „no" i
świeżo wpisany „nowy plan" dawały „wy plan". To gorsza awaria niż duplikat,
który przynajmniej widać.

Obie poprzednie reguły (kasowanie identycznego szkicu, potem odejmowanie
prefiksu) zgadywały po TREŚCI, bo sprzątały PO odpowiedzi serwera. Kolejność
jest teraz odwrotna i zgadywanie znika: Enter pustoszy pole natychmiast, więc
wszystko, co pojawi się później, z definicji należy do użytkownika. Sukces nie
robi już nic ze szkicem.

Nieudana wysyłka oddaje treść przez czysty `restoreFailedDraft(drafts, id,
failed)` — `clearSentDraft` zniknął. `ChatProvider` po odmowie trzyma sam
komunikat, nie treść wiadomości, więc bez tego powrotu tekst by przepadł. Pole
puste => treść wraca dosłownie; pole z tekstem dopisanym w międzyczasie =>
nieudana treść staje PRZED nim, oddzielona nową linią (nic nie ginie, nic nie
jest przepisywane znak po znaku, a podział na dwie wiadomości zostaje decyzją
użytkownika). Powrót działa też przy zamkniętym oknie, bo szkic należy do doku.
Trzy testy node: powrót do pustego pola (ze spacją końcową), powrót obok
świeżego tekstu wraz z przypadkiem „no" / „nowy plan", brak treści albo brak
rozmowy = ta sama referencja.

Weryfikacja: `npx vitest run src/chat` → 191 PASS / 0 FAIL; `npm run build` →
zielony (✓ 13.35s); `npm test` → 3022 PASS i ten sam 1 dozwolony FAIL
`src/contentplan/google.test.ts`; `npx vitest run
src/utils/stylesheetContract.test.ts` → 8 PASS. Przeglądarki nie uruchamiano
(dok wymaga sesji Supabase); do smoke testu operatora dochodzi porażka wysyłki
przy dopisanym tekście.

## Developer result (chat KLIPY swap)

Podmiana dostawcy pickera GIF-ów z Tenora (API wycofane 30.06.2026) na KLIPY
native v1, dokładnie wg `handoffs/research/gif-provider-klipy-2026-08-17.md`.
Chirurgicznie, w tym samym drzewie roboczym; `chatData.ts`, `ChatProvider.tsx`,
`types.ts`, `store/*`, `useModalShell.ts` i migracje BEZ ZMIAN, zero nowych
zależności.

Zmienione granice:

- `chatGifs.ts` (+test) — cała warstwa Tenora zastąpiona KLIPY: `KLIPY_BASE`,
  `klipyApiKey` (`VITE_KLIPY_API_KEY`), `buildKlipySearchUrl` (klucz SEGMENTEM
  ŚCIEŻKI, `gifs/search` przy niepustej frazie i `gifs/trending` przy pustej,
  `locale=pl_PL`, `content_filter=high`, `format_filter=gif`, `per_page` w
  widełkach 8–50 / 1–50, `page` od 1, `customer_id` doklejane tylko gdy
  niepuste), `parseKlipyResponse` (koperta `data.data[]`, tylko `type==='gif'`
  ze slugiem, podgląd `sm`→`xs`, wysyłka `md`→`hd`, każdy adres przez
  `isGifUrl`, `has_next`), `buildKlipyShareRequest` (POST `gifs/share/{slug}`,
  ciało `{customer_id, q}` bez `q` przy liście startowej, `null` przy braku
  klucza/sluga/identyfikatora). 19 testów.
- `chatRichText.ts` (+test) — lista hostów: `static.klipy.com`,
  `static.klipy.co`, `static1/2.klipy.com` (Giphy i reguła ścieżki `.gif`
  zostają dla ręcznie wklejanych linków); `gifAttribution` zwraca `'klipy'`.
  Host, nie rozszerzenie — renditiony KLIPY nie gwarantują końcówki `.gif`.
- `ChatGifPopover.tsx` — nowe buildery, `customerId` = `chat.selfId`, po UDANEJ
  wysyłce fire-and-forget `POST` z `keepalive` i bez `signal`, `blur_preview`
  jako tło kafelka. Debounce 300 ms, AbortController, szkielet i polski
  komunikat błędu bez zmian.
- `ChatWindow.tsx` — `klipyApiKey`, `customerId={chat.selfId ?? ''}`, podpis
  „Powered by KLIPY" pod dymkiem z GIF-em z hosta KLIPY (`.n2chat-gif-credit`).
- `.env.example` — blok Tenora zastąpiony `VITE_KLIPY_API_KEY` z polską
  instrukcją (partner.klipy.com → API Keys → Add Platform (Web, App URL) →
  klucz testowy 100/h → wniosek produkcyjny: kategoria, MAU, nagranie ekranu).
- `chat-fixes-2026-08-17.md` — decyzja D5 przepisana na KLIPY.

DWA ŁAŃCUCHY PO ANGIELSKU w polskim interfejsie są wymogiem KLIPY i tak zostają:
treść zastępcza pola wyszukiwania `Search KLIPY` (dokumentacja oznacza ją jako
REQUIRED) oraz formuła `Powered by KLIPY` w stopce pickera i pod dymkiem
(„API Terms of Use"). `aria-label` pola pozostał polski („Szukaj GIF-ów").

OFICJALNEGO LOGA NIE UDAŁO SIĘ POBRAĆ, więc atrybucja jest znakiem SŁOWNYM i
`KlipyMark.tsx` NIE POWSTAŁ: `https://docs.klipy.com/attribution` odpowiada 403,
folder z zasobami na Dysku Google pokazuje wyłącznie nazwy podfolderów („Logos
for GIF Picker-Search Bar", „Watermark for GIF Card") bez adresów plików, a
oficjalne repozytoria demo KLIPY zawierają tylko ikony launchera aplikacji.
Dorysowanie logo z pamięci byłoby zgadywaniem znaku towarowego — do zrobienia,
gdy operator pobierze zasób z Partner Panelu.

Wyniki: `grep -rin tenor src .env.example` → PUSTO. `npx vitest run src/chat` →
194/194 PASS. `npx vitest run src/utils/stylesheetContract.test.ts` → 8/8 PASS.
`npx tsc --noEmit` czysty. `npm run build` zielony (✓ 37.17s). `npm test` →
3025 passed, 1 failed: `src/contentplan/google.test.ts` (znana awaria
środowiskowa z lokalnego `.env.local`).

NIEZWERYFIKOWANE: żaden ruch do KLIPY nie poszedł — bez klucza nie da się
wywołać API (klucz jest segmentem ścieżki, więc zapytanie bez niego nie ma
sensu), więc kształt odpowiedzi, preflight `OPTIONS` na zgłoszeniu
udostępnienia i nagłówki CORS pozostają sprawdzone wyłącznie testami na
atrapie wg specyfikacji. Brak weryfikacji w przeglądarce (dok wymaga sesji
chmurowej). Do zrobienia przez operatora po wyrobieniu klucza testowego.

### Poprawka po przeglądzie stop-time (Codex) — zamiana na KLIPY

1. ALLOWLISTA HOSTÓW BYŁA DO OBEJŚCIA — naprawione. Parser KLIPY walidował
   adresy renditionów przez `isGifUrl`, a ta funkcja przepuszcza KAŻDĄ ścieżkę
   kończącą się na `.gif`, niezależnie od hosta (reguła słuszna dla linku
   WKLEJONEGO przez człowieka). Skutek: podmieniona albo złośliwa odpowiedź API
   przemyciłaby `https://obcy.example/pixel.gif` do `<img src>` ORAZ do treści
   wiadomości zapisywanej w bazie. Doszła osobna, wąska funkcja
   `isKlipyMediaUrl` (sam origin, zbiór czterech hostów) i to ona — nie
   `isGifUrl` — waliduje wszystko, co przychodzi z API. `gifAttribution` liczy
   się z tego samego zbioru. Przy okazji wzorzec `static[12]?\.klipy\.(com|co)`
   zamieniony na WYLICZONY zbiór: wpuszczał `static1.klipy.co` i
   `static2.klipy.co`, których dokumentacja nie wymienia. Testy: pełny zestaw
   dozwolonych i odrzucanych hostów, podszycie przez userinfo
   (`https://static.klipy.com@obcy.example/a.gif`), oraz w parserze pozycja z
   obcym hostem i pozycja MIESZANA (legalny podgląd, podmieniona wysyłka —
   odpada w całości, bo to `sendUrl` ląduje w bazie).
2. ATRYBUCJA BYŁA NIECZYTELNA — naprawione. Oba miejsca wymaganego umownie
   znaku „Powered by KLIPY" stały poniżej progu kontrastu przy 11 px: stopka
   pickera na `--n2-text-faint` dawała 4,34:1, a podpis pod dymkiem na
   `--n2-text-muted` 4,39:1 (próg 4,5:1). Oba przeszły na `--n2-text-soft` —
   8,59:1 w stopce i 7,33:1 na tle dymka. Stopka dostała też `flex: none`
   (rosnąca siatka wyników nie może jej ścisnąć), `font-weight: 600` i wróciła
   na lewą krawędź panelu. Pomiary liczone na realnych tokenach nad
   `--n2-surface-strong` i nad `--n2-glass`.

Oficjalny znak graficzny NADAL nieosiągalny (403 na stronie atrybucji, folder
Dysku bez adresów plików) — atrybucja pozostaje słowna, `KlipyMark.tsx` nie
powstał. To jedyny znany brak wobec „API Terms of Use" i czeka na zasób
pobrany przez operatora z Partner Panelu.

Wyniki po poprawce: `grep -rin tenor src .env.example` → PUSTO;
`npx vitest run src/chat` → 199/199 PASS; `npx vitest run
src/utils/stylesheetContract.test.ts` → 8/8 PASS; `npx tsc --noEmit` czysty;
`npm run build` zielony (✓ 10,71 s); `npm test` → 3030 passed, 1 failed
(znana awaria środowiskowa `src/contentplan/google.test.ts`).

### Weryfikacja NA ŻYWO kluczem testowym KLIPY (17.08.2026)

Operator dostarczył klucz testowy (limit 100 zapytań/h); wpisany do `.env.local`
(ignorowany przez git), NIE do `.env.example` — tam zostaje sama pusta zmienna.
Tym samym domknięte jest wszystko, co poprzedni wpis zgłaszał jako
NIEZWERYFIKOWANE:

- `GET gifs/trending` → HTTP 200, `content-type: application/json`,
  `access-control-allow-origin: *`. `GET gifs/search` z frazą „ćma nocą" →
  HTTP 200, adres wyszedł jako `q=%c4%87ma+noc%c4%85`, czyli dokładnie to, co
  produkuje `URLSearchParams` w `buildKlipySearchUrl`.
- PRAWDZIWA odpowiedź przepuszczona przez `parseKlipyResponse`: 24 pozycje na
  wejściu i 24 kafelki na wyjściu na OBU endpointach, `has_next: true`. Kształt
  ze specyfikacji potwierdzony w całości: `slug` (np.
  `happy-monday-mondays-4`), `title`, podgląd z warstwy `sm` 220×164, wysyłka z
  warstwy `md`, `blur_preview` jako `data:image/jpeg;base64,…`. Wszystkie adresy
  z hosta `static.klipy.com`, czyli z allowlisty; dla każdego kafelka
  `isKlipyMediaUrl` = true, `messageContentKind(sendUrl)` = 'gif' i
  `gifAttribution(sendUrl)` = 'klipy' — pełny łańcuch renderu dymka razem z
  podpisem działa na żywych danych.
- Preflight zgłoszenia udostępnienia (`OPTIONS` na `gifs/share/{slug}`, bo
  `Content-Type: application/json` nie jest CORS-simple) → HTTP 200,
  `access-control-allow-origin: *`, `access-control-allow-headers: *`.
  Właściwy `POST` z ciałem `{customer_id, q}` → HTTP 200 `{"result":true,...}`.
- Build z kluczem: `VITE_KLIPY_API_KEY` i jego wartość lądują w bundlu, więc
  przycisk GIF faktycznie się renderuje; w bundlu zero śladów po starym
  dostawcy.

Zostaje JEDEN znany brak: oficjalny znak graficzny KLIPY (strona atrybucji
odpowiada 403, folder Dysku nie wystawia adresów plików). Atrybucja jest
słowna. Do pobrania przez operatora z Partner Panelu — tam, gdzie i tak trzeba
złożyć wniosek o dostęp produkcyjny.

## Fixer result (chat KLIPY swap)

Werdykt: PASS po dwóch chirurgicznych poprawkach granicy zaufania. Drzewo
pozostało na `main`; bez zmian w `chatData.ts`, `ChatProvider.tsx`, `types.ts`,
`store/*`, `useModalShell.ts`, migracjach, zależnościach,
`n2media-agency-dashboard-style.css`, `reports/` i `.env.local`. Wartość klucza
operatorskiego nie była czytana, drukowana ani kopiowana.

Poprawki:

1. `src/chat/ui/chatRichText.ts` (+ test) - `isKlipyMediaUrl` sprawdza teraz
   dokładny origin HTTPS z allowlisty czterech originów, odrzuca niestandardowy
   port oraz jawne dane logowania. Wcześniejsza kontrola samego hosta
   przepuszczała `http://static.klipy.com/...` i port spoza wymaganego 443.
   Podszycie `https://static.klipy.com@obcy.example/a.gif` nadal odpada.
2. `src/chat/ui/chatGifs.ts` (+ test) - `blur_preview` przyjmuje wyłącznie
   wąski prefiks `data:image/jpeg;base64,` i znaki base64. Wcześniejszy wzorzec
   przyjmował także PNG i SVG; oba mają teraz test regresyjny i są pomijane.

Kontrola bezpieczeństwa i kontraktu: PASS. Preview i send URL przechodzą przez
`isKlipyMediaUrl`; pozycja z legalnym preview i obcym send URL wypada w całości.
Klucz jest wyłącznie kodowanym segmentem ścieżki; nie trafia do ciała
wiadomości, logów ani komunikatu UI. Błąd pickera jest stałym polskim tekstem i
nie pokazuje request URL. Search/trending, `pl_PL`, filtr `high`, format `gif`,
widełki `per_page`, numer strony od 1 i warunkowe `customer_id={chat.selfId}` są
zgodne ze specyfikacją. Share to POST po udanym sendzie, z `{customer_id, q?}`,
`keepalive`, bez sygnału i bez błędu widocznego dla użytkownika. Obie wymagane
formuły `Search KLIPY` / `Powered by KLIPY` są dosłowne i obecne we właściwych
miejscach.

Kontrast: PASS. Ponowne liczenie z realnych tokenów nad bazą `--n2-night`
daje 8,68:1 dla stopki pickera i 7,42:1 dla podpisu w cudzym dymku; podpis we
własnym dymku ma minimum 6,02:1 na jaśniejszym końcu gradientu. Wszystko jest
powyżej 4,5:1; różnica wobec wcześniejszych 8,59/7,33 wynika z przyjętego tła
pod półprzezroczystą powierzchnią i nie zmienia werdyktu.

Regresje: PASS. `grep -rin tenor src .env.example` - pusto. Przycisk GIF jest
renderowany tylko dla niepustego `VITE_KLIPY_API_KEY`; ręcznie wklejone adresy
Giphy i `.gif`, podgląd „GIF”, szkice, emoji i wzajemne wykluczanie pickerów
pozostały pokryte zielonym pakietem czatu. Asynchroniczne ścieżki sprawdzają
abort lub `mountedRef` przed aktualizacją stanu; udany send może po odmontowaniu
wykonać tylko bezstanowy share.

Gates:

- `npx vitest run src/chat/ui/chatGifs.test.ts src/chat/ui/chatRichText.test.ts`
  - 2 pliki, 54/54 PASS.
- `npx vitest run src/chat` - 9 plików, 199/199 PASS.
- `npx vitest run src/utils/stylesheetContract.test.ts` - 1 plik, 8/8 PASS.
- `npm run build` - PASS (`tsc --noEmit` + Vite production build).
- `npm test` - 3030 PASS, 1 FAIL: wyłącznie dozwolony
  `src/contentplan/google.test.ts` (lokalne środowisko).
- `git diff --check` - PASS. `.env.local` nie występuje w `git status` ani
  `git ls-files`; `git check-ignore -v .env.local` wskazuje `*.local`.

Wiki unchanged: `openwiki/n2hub/frontend-performance-and-primitives.md` i
`cloud-database.md` nie mają diffu, bo poprawka zawęża adapter zewnętrznego API
i nie zmienia kontraktu wspólnego prymitywu, wydajności renderu ani granic bazy.

Ryzyko rezydualne: brak oficjalnego pliku logo KLIPY, więc atrybucja pozostaje
czytelnym znakiem słownym. Nie wykonywano logowania ani nowej kontroli w
przeglądarce; wcześniejszy wpis zachowuje dowód live dla odpowiedzi API i CORS.

### Druga poprawka po przeglądzie stop-time — allowlista przyjmowała niezatwierdzone originy

Uwaga recenzenta trafna. `isKlipyMediaUrl` był już zaostrzony do originu
(poprzednia tura), ale gałąź ALLOWLISTY w `isGifUrl` nadal dopasowywała SAM
HOST:

```
return KLIPY_MEDIA_HOSTS.has(host) || GIF_HOSTS.test(host);
```

Skutek: `http://static.klipy.com/x` i `http://i.giphy.com/x` były uznawane za
GIF-a i renderowały się jako `<img src>` po JAWNYM łączu (podatne na podmianę w
drodze), tak samo `https://…:8443/x`. Allowlista była więc LUŹNIEJSZA niż
`img-src` w CSP, którą ma odwzorowywać — a to CSP jest ostatecznym egzekutorem.

Reguła originu wyciągnięta do jednej funkcji `hasApprovedOrigin(parsed, allows)`
(wyłącznie `https:`, port domyślny, zero danych logowania) i używana TERAZ PRZEZ
OBIE ścieżki: `isKlipyMediaUrl` (hosty KLIPY) oraz gałąź allowlisty w
`isGifUrl` (hosty KLIPY i Giphy). Zbędny już `KLIPY_MEDIA_ORIGINS` usunięty —
jedno miejsce wyraża „zatwierdzony origin".

Reguła ścieżki `.gif` w `isGifUrl` ZOSTAJE luźna i to jest świadome: dotyczy
linków WKLEJANYCH przez ludzi z całego internetu, nie treści od dostawcy, i nie
jest granicą zaufania dla odpowiedzi API.

Nowe testy (3): niezatwierdzony origin na gałęzi allowlisty (http, port 8443,
userinfo), zatwierdzony origin bez rozszerzenia `.gif` nadal jest GIF-em, oraz
potwierdzenie, że reguła ścieżki `.gif` pozostaje luźna.

Kontrola na PRAWDZIWYCH danych z API po zaostrzeniu: 24/24 kafelki na obu
endpointach nadal przechodzą, wszystkie adresy na allowliście, dymek i podpis
bez zmian — zaostrzenie niczego nie odcięło.

Wyniki: `npx vitest run src/chat` → 202/202 PASS; `npx vitest run
src/utils/stylesheetContract.test.ts` → 8/8 PASS; `npx tsc --noEmit` czysty;
`npm run build` zielony (✓ 22,38 s); `npm test` → 3033 passed, 1 failed (znana
awaria środowiskowa `src/contentplan/google.test.ts`);
`grep -rin tenor src .env.example` → PUSTO.

## Developer result (chat KLIPY logo)

Domknięta ostatnia luka wobec „API Terms of Use" KLIPY: atrybucja ma teraz nie
tylko znak słowny, ale i OFICJALNE LOGO. Commander pobrał zasoby z publicznego
folderu atrybucji KLIPY (linkowanego z docs.klipy.com/attribution) i położył je
jako pliki statyczne. Nie ruszałem ich ani nie eksportowałem ponownie — to cudzy
znak towarowy; build potwierdza, że jadą bajt w bajt.

Zmienione granice:

- `ChatGifPopover.tsx` — stopka pickera zamiast samego tekstu renderuje
  `<img class="n2chat-klipy-mark" src="/klipy/powered-by-klipy.svg"
  alt="Powered by KLIPY" width={119} height={20}>`. 119×20 to dokładna
  proporcja zasobu (viewBox 640×107,3 → 5,965), więc wiersz nie przeskakuje po
  dociągnięciu pliku. Tekst obok ZNIKA: nazwę dostępną niesie w całości `alt`,
  a zostawienie obu dałoby czytnikowi ekranu „Powered by KLIPY" dwa razy.
  W nagłówku pliku doszedł akapit o pochodzeniu zasobów.
- `ChatWindow.tsx` — podpis pod dymkiem z GIF-em z hosta KLIPY to teraz
  `<img class="n2chat-gif-credit-mark" src="/klipy/klipy-watermark.svg"
  alt="Powered by KLIPY" width={44} height={15}>` (proporcja 389,2×133,2 →
  2,922). Obraz siedzi w dotychczasowym `<span class="n2chat-gif-credit">`, więc
  wyrównanie `.is-mine` i istniejące reguły CSS działają bez zmian. GIF-y spoza
  KLIPY (wklejone linki giphy/`.gif`) nadal NIE dostają znaku.
- `styles.css` — `.n2chat-klipy-mark` (height 20px, width auto) i
  `.n2chat-gif-credit-mark` (height 15px, width auto, opacity .9). Wysokość
  ustalona, szerokość z proporcji zasobu. Blok `@media (max-width: 760px)` bez
  zmian. Reguły kroju i koloru na rodzicach NIE są martwe — gdy plik się nie
  wczyta, przeglądarka pokazuje w tym miejscu tekst z `alt`.
- `chat-fixes-2026-08-17.md` — dopisek o atrybucji logo w decyzji D5.

Wyniki: `npx vitest run src/chat` → 202/202 PASS; `npx vitest run
src/utils/stylesheetContract.test.ts` → 8/8 PASS; `npx tsc --noEmit` czysty;
`npm run build` zielony (✓ 21,90 s); `npm test` → 3033 passed, 1 failed (znana
awaria środowiskowa `src/contentplan/google.test.ts`).

Weryfikacja zasobów: `ls dist/klipy` pokazuje oba pliki (4,8K i 5,9K), `cmp`
potwierdza że są IDENTYCZNE z `public/klipy/`, w bundlu JS stoją adresy
`/klipy/powered-by-klipy.svg` i `/klipy/klipy-watermark.svg`, a w zbudowanym
arkuszu obie nowe reguły. Vite serwuje `public/` spod korzenia (domyślny
`publicDir`, w `vite.config.ts` nie ma `base`), więc adresy bezwzględne są
poprawne. Weryfikacji w przeglądarce NIE było — dok czatu wymaga sesji
chmurowej; wygląd znaków (rozmiar, kontrast na ciemnym tle) nie był oglądany.
