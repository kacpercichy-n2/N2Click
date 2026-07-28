# Raport workflow: 20260728-120610-n2hub-305-changelog-backdrop-and-entry

## Wykonane

Oba punkty były nadal aktualne w bieżącym buildzie.

**1. Przywrócone żywe tło pod modalami (bez rozmycia, bez bitmapy).**
Analiza wykazała dwa różne defekty w jednym obszarze:

- `ModalFrame` (changelog, szybkie dodawanie) nadal używał rasteryzowanego
  snapshotu z `0ccbcbc`: `html2canvas` robił zrzut strony, wypalał w bitmapę
  rozmycie/przyciemnienie i chował `#root` (`visibility: hidden`).
- Modale formularzy (zadanie, wydarzenie, zgłoszenie — refaktor `useModalShell`
  z runów 277+) renderowały div `.task-modal-scrim`, ale `0ccbcbc` usunęło jego
  bazową regułę CSS i nigdy nie wróciła — te modale nie miały ŻADNEGO
  przyciemnienia tła.

Naprawa:
- usunięty cały mechanizm snapshotu: `src/components/modalBackdropSnapshot.ts`
  (plik skasowany), wywołania w `ModalFrame.tsx`, reguły
  `.task-modal-snapshot*` i `html[data-modal-backdrop] #root` w `styles.css`,
  zależność `html2canvas` z `package.json`/`package-lock.json` (mniejszy bundle);
- przywrócona bazowa reguła `.task-modal-scrim` (`rgba(4, 3, 8, 0.68)`,
  `pointer-events: none`, z-index 1000) — zgodnie ze stanem sprzed `0ccbcbc`,
  ale celowo BEZ `backdrop-filter: blur(6px)` (wprost wymagane „bez rozmycia");
- `ModalFrame` renderuje teraz scrim (animowany fade jak w TaskModalu) w tym
  samym portalu co viewport; stos modali, Escape, blokada scrolla i inert
  `#root` bez zmian;
- korzysta na tym też okno potwierdzenia (`.confirm-scrim` dziedziczy szkielet
  scrima, który do tej pory był pusty).

Zachowana część optymalizacji scrolla: jedynym przewijanym elementem pozostaje
`.task-modal-body` wewnątrz nieprzezroczystej karty (viewport `overflow:
hidden`), więc scroll modala dalej nie przemalowuje strony pod spodem.

**2. Stały przycisk „Zobacz zmiany" na Panelu.** W prawym górnym rogu
(`src/pages/DashboardPage.tsx`), obok daty (`.dash-head-meta`), dodany
dyskretny przycisk w stylu `link-btn` (skala typograficzna paska daty), który
zawsze otwiera popout changeloga z pełną listą paczek. Belka „Nowości … →"
z runu 295 zostaje bez zmian jako sygnał nieprzeczytanego wpisu; otwarcie
przyciskiem potwierdza najnowszy wpis tak samo jak dotąd (ta sama ścieżka
`openChangelog`, logika „przeczytane" per urządzenie nietknięta). Dane
changeloga (`src/data/changelog.ts`) nietknięte.

Dodatkowo zaktualizowana wiki
`openwiki/n2hub/frontend-performance-and-primitives.md` (sekcja „Shared modal
contract"): opis snapshotu zastąpiony kontraktem scrima nad żywą aplikacją
i zakazem powrotu do bitmapy/rozmycia; opis powłok zgodny ze stanem
(`ModalFrame` + `useModalShell`).

## Zmiany

- `src/components/ModalFrame.tsx` — scrim zamiast snapshotu
- `src/components/modalBackdropSnapshot.ts` — usunięty
- `src/components/ChangelogModal.tsx` — tylko aktualizacja komentarza
- `src/pages/DashboardPage.tsx` — stały przycisk „Zobacz zmiany" obok daty
- `src/styles.css` — przywrócona `.task-modal-scrim`, usunięte reguły
  snapshotu, style `.dash-head-meta`/`.dash-changelog-btn`
- `package.json`, `package-lock.json` — usunięty `html2canvas`
- `openwiki/n2hub/frontend-performance-and-primitives.md` — kontrakt tła modali

## Weryfikacja

- `npm test` — 102 pliki, 2137 testów, wszystkie zielone (bez regresji;
  kontrakt stylów `stylesheetContract.test.ts` przechodzi z nowym scrimem).
- `npm run build` — zielony; chunk `html2canvas` zniknął z dist.
- Smoke w przeglądarce (Playwright, dev server): changelog otwarty nowym
  przyciskiem → `.task-modal-scrim` z `rgba(4, 3, 8, 0.68)`,
  `backdrop-filter: none`, brak warstwy `.task-modal-snapshot`, `#root`
  widoczny (`visibility: visible`) i poprawnie inert; modal zadania — ten sam
  wynik, na zrzucie ekranu żywy, przyciemniony interfejs pod kartą; przycisk
  „Zobacz zmiany" widoczny także przy 390 px obok daty „Wt. 28.07".
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Scrim jest teraz bez `backdrop-filter` (stan sprzed `0ccbcbc` miał
  `blur(6px)`) — to świadoma decyzja zgodna z poleceniem „bez rozmycia";
  gdyby owner chciał jednak delikatne szkło, to jedna linia CSS, ale wróci
  wtedy ryzyko szarpanego scrolla z pomiaru w `375ed73`.
- Okno potwierdzenia (`.confirm-scrim`) zachowuje własny `blur(3px)` nad
  modalem pod spodem — poza zakresem skargi, nie ruszane.
- Wydajność scrolla changeloga po powrocie żywego tła sprawdzona tylko
  syntetycznie (kompozycja: przewija się wyłącznie `.task-modal-body`);
  zgodnie z zasadą repo ostateczny werdykt GPU należy do urządzenia, które
  zgłaszało problem — priorytet miał wygląd, zgodnie z zadaniem.

## Podpis schedulera

- Run: `20260728-120610-n2hub-305-changelog-backdrop-and-entry`
- Prompt: `305-changelog-backdrop-and-entry.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `0d1a371b4b60d0b94b3b4f004c2a5777a6c68dc8`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `0d1a371b4b60d0b94b3b4f004c2a5777a6c68dc8`
- Gałąź review: `review-integration`
- Run: `20260728-120610-n2hub-305-changelog-backdrop-and-entry`

### Pliki zgłoszone do review

- `openwiki/n2hub/frontend-performance-and-primitives.md`
- `package-lock.json`
- `package.json`
- `src/components/ChangelogModal.tsx`
- `src/components/ModalFrame.tsx`
- `src/components/modalBackdropSnapshot.ts`
- `src/pages/DashboardPage.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260728-120610-n2hub-305-changelog-backdrop-and-entry.md`
