# Handoff: Czat — poprawki UX (dok, platformy, treść wiadomości)

- **Package ID:** PKG-20260817-chat-fixes
- **Status:** ready
- **Owner:** Commander (Deck) — plan; dwa pakiety Builderów wykonywane SZEREGOWO, potem Fixer.
- **Depends on:** commit `ef901bf` (moduł czatu) — nic więcej.
- **Blast radius:** low/medium — wyłącznie `src/chat/ui/*`, blok `n2chat` w `src/styles.css`, `src/components/icons.ts`, `.env.example`. Reduktor, storage, `chatData.ts`, `ChatProvider.tsx`, migracje: BEZ ZMIAN.

## Wiki context
`openwiki/n2hub/frontend-performance-and-primitives.md` (popovery, `useOverlay`), `openwiki/n2hub/testing-and-automation.md`. Schemat czatu opisuje `cloud-database.md` — tylko do wglądu, nie zmieniamy bazy.

## Stan zastany (zbadany 2026-08-17)
- Dok: `src/chat/ui/ChatDock.tsx` — kolumna bąbelków (52 px) w prawym dolnym rogu, przycisk-lupa (`Search`) otwiera `ChatSearchPopover`. Stan `collapsed` w doku; klik w aktywny bąbelek toggluje zwinięcie.
- Okno: `src/chat/ui/ChatWindow.tsx` — nagłówek (awatar 32 px + tytuł-przycisk + chevron zwiń/rozwiń + X). Zwinięte okno = sam nagłówek (`.n2chat-window.is-collapsed { height:auto }`). Treść wiadomości: `<span class="n2chat-msg-text">{body}</span>` — czysty tekst, bez linków, bez `pre-wrap`.
- Kompozytor: `<textarea class="n2chat-input">` (Enter wysyła, Shift+Enter nowa linia), przycisk `Send`. Limit 4000 znaków (CHECK w bazie). `sendMessage(body)` przyjmuje sam tekst — GIF/emoji NIE wymagają zmian schematu: GIF = wiadomość, której treść jest URL-em GIF-a; emoji = zwykłe znaki Unicode.
- Widok czysty: `chatWindowView.ts`, `chatDockView.ts` (+ testy node, vitest `environment: node`, brak jsdom — logika w czystych modułach `.ts` + testy; komponenty cienkie).
- CSS: blok od `.n2chat-dock` (~linia 11702 `src/styles.css`); telefon `@media (max-width: 760px)`: kolumna nad `--n2-bottom-nav-h`, okno pełna szerokość, `has-window` chowa kolumnę.
- Powłoka: `.app-shell` (grid, `padding: var(--n2-space-6)`; ≤760 px `--n2-space-4`). Dok jest `position: fixed` obok routera — treść wjeżdża POD bąbelki.
- Ikony wyłącznie przez `src/components/icons.ts` (re-eksport lucide-react 1.23). Dostępne i zweryfikowane: `MessagesSquare`, `Smile`, `ImagePlay`.
- Klawiatura ekranowa: `src/components/keyboardInset.ts` (`resolveKeyboardInset`, czysta arytmetyka) + wzorzec nasłuchu `visualViewport` w `useModalShell.ts` (NIE modyfikować `useModalShell`). `MOBILE_NAV_QUERY` w `src/utils/useMediaQuery.ts`.
- Znaleziony błąd iOS: `.n2chat-input`/`.n2chat-search-input` mają `font-size: var(--n2-type-sm)` (13 px), klasa wygrywa z globalną regułą `textarea { font-size:16px }` na ≤760 px → Safari iOS przybliża stronę przy fokusie.
- Brak CSP w `index.html`/`vercel.json` — obrazy z CDN-u dostawcy GIF-ów i linki zewnętrzne nie są blokowane.
- Env: wzorzec kluczy publicznych z łagodną degradacją (`VITE_GOOGLE_API_KEY` w `.env.example`).

## Decyzje projektowe (Commander)
- D1 **Minimalizacja = zamknięcie okna.** Znika stan `collapsed`, chevron i pasek nagłówka „zwiniętego" okna. Bąbelek aktywnej rozmowy zostaje w kolumnie (już dziś: `recentIds` + `pushRecent`). Klik w aktywny bąbelek zamyka okno, kolejny klik otwiera. Skutek uboczny pożądany: zamknięte okno nie oznacza cudzych wiadomości jako przeczytanych (dziś zwinięty nagłówek to robił).
- D2 **Gutter 52 px**: `ChatDockInner` dokłada klasę `n2chat-on` na `document.documentElement` (efekt z cleanupem); CSS `.n2chat-on .app-shell { padding-right: calc(var(--n2-space-6) + 52px + var(--n2-space-3)) }` TYLKO powyżej 760 px. Nie przez `useChat()` w `App.tsx` (re-render całej powłoki przy każdej wiadomości).
- D3 **Ikona**: przycisk lupy dostaje `MessagesSquare`; pole wyszukiwania w popoverze zachowuje `Search`.
- D4 **Linki**: czysty tokenizer `http(s)://` + `www.` (z obcięciem końcowej interpunkcji i domknięciem nawiasów), render `<a target="_blank" rel="noopener noreferrer">`. Zero `dangerouslySetInnerHTML`.
- D5 **GIF** (ZMIENIONE 17.08.2026 — Tenor API wycofany: Google zamknął wydawanie nowych kluczy 13.01.2026 i wyłączył integracje 30.06.2026, więc dostawcą jest KLIPY; pełne rozpoznanie w `handoffs/research/gif-provider-klipy-2026-08-17.md`): (a) render — wiadomość będąca W CAŁOŚCI jednym URL-em GIF-a (ścieżka `.gif` albo host `static.klipy.com`/`static.klipy.co`/`static1.klipy.com`/`static2.klipy.com`/`media*.giphy.com`/`i.giphy.com`) renderuje się jako `<img loading="lazy" alt="GIF">` w dymku, z podpisem „Powered by KLIPY" pod obrazkiem z hosta KLIPY; (b) picker — KLIPY API v1 (`https://api.klipy.com/api/v1/{klucz}/gifs/search` i `/gifs/trending`, klucz SEGMENTEM ŚCIEŻKI), klucz `VITE_KLIPY_API_KEY` z partner.klipy.com, `locale=pl_PL`, `content_filter=high`, `format_filter=gif`, `per_page=24`, `customer_id` = chmurowe `selfId`; podgląd z warstwy `sm` (zapas `xs`), do wiadomości idzie `md` (zapas `hd`). Po UDANEJ wysyłce leci `POST gifs/share/{slug}` „wyślij i zapomnij". Bez klucza przycisk GIF nie renderuje się — reszta czatu bez zmian. Dwa łańcuchy po ANGIELSKU są wymogiem KLIPY: treść zastępcza pola wyszukiwania „Search KLIPY" i stopka pickera „Powered by KLIPY". ATRYBUCJA LOGO (17.08.2026): oficjalne zasoby KLIPY z ich publicznego folderu atrybucji leżą jako pliki statyczne w `public/klipy/` — `powered-by-klipy.svg` w stopce pickera i `klipy-watermark.svg` pod dymkiem z GIF-em z hosta KLIPY; plików nie przerysowujemy ani nie eksportujemy ponownie. Podgląd na liście rozmów: „GIF".
- D6 **Emoji**: własny, mały picker na KURATOROWANEJ liście (~8 kategorii × ~24 emoji, polskie słowa kluczowe, sekcja „Ostatnie" w pamięci sesji `useState`, NIE localStorage). Bez nowej zależności, bez CDN, bez IndexedDB — mobilne klawiatury mają własne emoji, picker służy desktopowi. Wstawianie w pozycji kursora (`insertAtCaret` — czysta funkcja + test). Wiadomość złożona z 1–3 samych emoji renderuje się większym stopniem (`.is-jumbo`).
- D7 **Nowe linie**: `.n2chat-msg-text { white-space: pre-wrap }` — Shift+Enter dziś jest w kompozytorze, a w dymku się zlewa; poprawka jednoliniowa przy okazji renderu segmentów.
- D8 **Szeregowość**: pakiet A (dok/okno/platformy) przed pakietem B (treść), bo B buduje na kompozytorze i nagłówku po zmianach A; oba dotykają `ChatWindow.tsx` i `styles.css`. Builderzy pracują w TYM SAMYM drzewie roboczym: zakaz `git stash/checkout/reset/branch/commit`.

## Pakiet A — dok, minimalizacja, gutter, ikona, Android/iOS
Pliki: `ChatDock.tsx`, `ChatWindow.tsx` (tylko nagłówek + kompozytor-textarea atrybuty), nowy `src/chat/ui/useChatKeyboardInset.ts`, `styles.css` (blok n2chat + reguła gutter), `icons.ts`; testy: `chatDockView.test.ts` (jeśli zmiana logiki), nowy test czysty dla ewentualnej arytmetyki.
1. Usunąć `collapsed`/`onToggleCollapse`/chevrony/`.is-collapsed`; klik aktywnego bąbelka → `chat.closeConversation()`; tytuł w nagłówku przestaje być przyciskiem (zwykły blok tekstu); X i Escape zamykają.
2. Gutter (D2). Sprawdzić: sidebar zwinięty/rozwinięty, 1181+ px, 761–1180 px, ≤760 px bez zmian.
3. Ikona (D3): eksport `MessagesSquare` w `icons.ts` z komentarzem; `aria-label` bez zmian.
4. Platformy: (i) hook `useChatKeyboardInset(ref)` na `resolveKeyboardInset` + `visualViewport` resize/scroll, aktywny tylko pod `MOBILE_NAV_QUERY`, ustawia `--n2-kb-inset` na oknie i popoverze; CSS ≤760 px: `bottom` okna/popovera + inset, `max-height: calc(100dvh - inset - …)`; (ii) `.n2chat-input`, `.n2chat-search-input` `font-size:16px` na ≤760 px; (iii) `70vh` → `70dvh`; (iv) `:hover` transformy bąbelka i `Send` pod `@media (hover: hover)`; (v) `enterkeyhint="send"` + `autoCapitalize`/`autoCorrect` domyślne (nie ruszać), `inputMode` bez zmian; (vi) `env(safe-area-inset-right)` przy prawej krawędzi kolumny na ≤760 px. Desktop bit-w-bit bez zmian poza pkt 1–3.
Weryfikacja A: `npx vitest run src/chat`, `npm test`, `npm run build`; ręcznie (jeśli Chrome/DevTools dostępne): iPhone 390×844 i Pixel 412×915 — okno z otwartą klawiaturą nie chowa kompozytora, brak zoomu przy fokusie, klik bąbelka zamyka/otwiera okno, brak paska po zamknięciu.

## Pakiet B — linki, GIF, emoji (po zakończeniu A)
Pliki: nowe `chatRichText.ts` (+test), `chatEmoji.ts` (+test), `chatGifs.ts` (+test; mapowanie odpowiedzi Tenora bez fetch), `ChatEmojiPopover.tsx`, `ChatGifPopover.tsx`; edycje `ChatWindow.tsx` (render segmentów, dwa przyciski kompozytora), `chatDockView.ts` (`previewText` → „GIF"), `styles.css`, `icons.ts` (`Smile`, `ImagePlay`), `.env.example` (`VITE_TENOR_API_KEY` z opisem po polsku).
Wymagania: popovery na `useOverlay` jak `ChatSearchPopover` (Escape, klik poza, powrót fokusa do kompozytora); cele dotykowe ≥44 px na ≤760 px; obrazki `max-width:100%; max-height:220px`; błąd sieci Tenora → polski komunikat w pickerze, nie w `chat.error`; brak klucza → brak przycisku GIF; żadnych zmian w `chatData.ts`/`ChatProvider.tsx`/bazie; komunikaty po polsku.
Weryfikacja B: testy czyste dla tokenizera (URL w środku zdania, `www.`, nawiasy, interpunkcja końcowa, `javascript:` NIE jest linkiem, wielolinijkowość), `isGifUrl`, `insertAtCaret`, `filterEmoji`, mapowanie Tenora; `npm test`; `npm run build`.

## Fixer (po B)
Niezależny przegląd A+B: brak regresji kontraktu okna (jedno okno, `markRead` nadal tylko w providerze), brak XSS w renderze linków, `useOverlay` poprawnie zamyka popovery, desktop niezmieniony poza zakresem, mobile CSS spójny z paskiem dolnym; `npm test`/`npm run build` zielone; poprawki last-mile.

## Report back
Każdy Builder: wpis w `handoffs/RUN-STATE.md` (zwięźle: zmienione granice, wynik testów/buildu, blokady). Wiki: `frontend-performance-and-primitives.md` bez zmian, chyba że dojdzie nowy wzorzec popovera — wtedy jedno zdanie.
