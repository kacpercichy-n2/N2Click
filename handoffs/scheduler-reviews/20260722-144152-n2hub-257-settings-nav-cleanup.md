# Raport workflow: 20260722-144152-n2hub-257-settings-nav-cleanup

## Wykonane

Workflow tier: `architect → developer → reviewer` (pakiet
`handoffs/packages/settings-nav-cleanup.md`, PKG-20260722-settings-nav-cleanup).
Wszystkie 5 punktów zadania było nadal aktualnych w bieżącym buildzie i zostało
zrealizowanych:

1. **„Konto" → „Ustawienia"** w nawigacji i nagłówku strony, z ikoną trybika
   (`Settings`). Żeby uniknąć dwóch identycznych trybików, „Administracja"
   dostała ikonę `ShieldCheck`. Link i trasa `/account` są teraz dostępne w OBU
   trybach (w trybie lokalnym widoczna jest tylko sekcja „Interfejs";
   „Zmiana hasła" pozostaje wyłącznie supabase).
2. **Edytor kolejności menu**: wbrew treści zadania `NavOrderEditor` NIE
   istniał w kodzie — został zbudowany od zera. Nowy `src/components/navItems.ts`
   (przeniesione `NAV_ITEMS` + czysta funkcja `orderNavPaths`), preferencja
   `navOrder` w `src/utils/uiPrefs.ts` (per urządzenie, klucz `n2hub.ui.v1`),
   sekcja „Interfejs" → „Kolejność menu" w Ustawieniach (strzałki góra/dół +
   „Przywróć domyślną kolejność", bez drag&drop — brak biblioteki drag w repo).
   Sidebar odświeża kolejność natychmiast przez zdarzenie
   `n2hub:nav-order-changed`. Struktura strony gotowa na przyszłe sekcje.
3. **Usunięte sekcje „Profil w chmurze" i „Mój profil"** z Ustawień (duplikaty
   zakładki „Zespół"). Synchronizacja cloud nietknięta.
4. **Stopka sidebaru**: bąbelek z awatarem zalogowanego (Link React Router do
   `/people/<id>`, także w wariancie zwiniętym >1180px) obok węższego
   przycisku „Wyloguj" (`flex: 1` zamiast pełnej szerokości). Przycisk
   „Wyloguj" zachowuje nazwę dostępną (kontrakt skryptu przeglądarkowego).
5. **Pełne usunięcie „występuj jako"**: skasowane akcje `IMPERSONATE` /
   `STOP_IMPERSONATION`, pole `AppData.impersonatorId`, selektory
   `realUserId`/`realUser`/`isImpersonating`, uprawnienie `users.impersonate`,
   przełącznik i banner w UI, plumbing w `OnboardingRoot`, `TeamPage`,
   `useCan`, `effectiveAccessRole`, `persistGate`, `seed`, `exportDryRun`.
   `ActivityEvent.impersonatorId?` pozostaje jako pole HISTORYCZNE (tylko
   odczyt — stare wiersze aktywności i kolumna w Supabase nadal się
   wyświetlają; brak migracji DB). Storage usuwa zaszłościowy klucz przy
   wczytaniu (naprawa bez podbicia wersji danych — zostaje 7; czysty payload
   nie powoduje echo-zapisu).

Odstępstwo od pakietu (zaakceptowane przez reviewera):
`src/auth/SessionProvider.tsx` importował usunięty `realUserId` — zamieniony
na `storeState.currentUserId` (semantycznie identyczne po usunięciu
impersonacji).

Wiki: **wiki updated** — `openwiki/n2hub/ui-navigation-and-onboarding.md`
zaktualizowana (Ustawienia/trybik, oba tryby `/account`, navOrder, stopka,
brak impersonacji); `state-and-persistence.md` bez zmian (nigdy nie
dokumentowała `impersonatorId` — zweryfikowane grepem).

## Zmiany

- Nowe: `src/components/navItems.ts`, `src/components/navItems.test.ts`,
  `handoffs/packages/settings-nav-cleanup.md` (pakiet architekta).
- Zmienione: `src/App.tsx`, `src/pages/AccountPage.tsx`,
  `src/components/icons.ts`, `src/utils/uiPrefs.ts`, `src/styles.css`,
  `src/types.ts`, `src/store/AppStore.tsx`, `src/store/selectors.ts`,
  `src/store/permissions.ts`, `src/store/useCan.ts`,
  `src/store/persistGate.ts`, `src/store/storage.ts`, `src/store/seed.ts`,
  `src/store/exportDryRun.ts`, `src/supabase/referenceData.ts`,
  `src/onboarding/OnboardingRoot.tsx`, `src/pages/TeamPage.tsx`,
  `src/pages/AdminPage.tsx`, `src/auth/SessionProvider.tsx`,
  `src/components/PersistenceBanner.tsx` (komentarz),
  `openwiki/n2hub/ui-navigation-and-onboarding.md`.
- Zaktualizowane testy: `blockActions`, `activityAttribution`,
  `commandValidation`, `selectors`, `permissions`, `persistGate`, `storage`,
  `exportDryRun`, `referenceData` (+ nowe testy inwariantu 6: usunięte
  komendy zwracają TĘ SAMĄ referencję stanu).
- Celowo NIEZMIENIONE: `cloudMirror.ts`, `plannerData.ts`, `dataImport.ts`,
  `CommentsPanel.tsx`, `supabase/migrations/`, `teamScope.test.ts`,
  `profileEditPolicy.test.ts`, `plannerData.test.ts`.

## Weryfikacja

- Vitest fokusowany (13 plików, w tym niemodyfikowane
  teamScope/profileEditPolicy/plannerData): **669 testów, zielony**.
- `npm test` (pełny, uruchomiony przez developera i NIEZALEŻNIE powtórzony
  przez reviewera): **54 pliki / 1379 testów, zielony**.
- `npm run build` (`tsc --noEmit` + vite): **zielony** (tylko zastane
  ostrzeżenie o rozmiarze chunka).
- `grep -ri impersonat src/`: wyłącznie sankcjonowane ścieżki historyczne;
  `grep "acting-as" src/`: zero trafień.
- `node scripts/browser-check-ui-keyboard.mjs`: **NIE uruchomiony** —
  playwright niezainstalowany w tym worktree; kontrakt („Wyloguj" jako
  `<button>` z nazwą dostępną, awatar jako `Link`) zweryfikowany statycznie.
- Werdykt reviewera: **approved** (bez blockerów), warunkowo względem
  wymaganego przez pakiet przebiegu Codex, który scheduler uruchamia po
  zakończeniu tego procesu.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

1. Skrypt `browser-check-ui-keyboard.mjs` wymaga uruchomienia w środowisku z
   playwrightem (DOM stopki się zmienił); pełną macierz przeglądarkową
   posiada weryfikacja release.
2. Zaszłościowy zapis w trakcie impersonacji wczyta się jako tożsamość
   „występowana" (`currentUserId`); realna sesja i tak jest ponownie
   ustawiana przy logowaniu — jednorazowe, zgodnie z decyzją pakietu.
3. Zapisany `navOrder` sprzed zmiany widoczności `/admin`/`/team` dokleja
   nowo widoczne pozycje na końcu w kolejności domyślnej — zamierzona
   degradacja.
4. Kolejność menu jest per urządzenie (localStorage `n2hub.ui.v1`), nie per
   konto w chmurze — zgodnie z granicą `uiPrefs` (jedyny poza `storage.ts`
   moduł dotykający localStorage).

## Podpis schedulera

- Run: `20260722-144152-n2hub-257-settings-nav-cleanup`
- Prompt: `257-settings-nav-cleanup.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `a4efd81781e65085ce8fef47c580fc454cd5144e`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `a4efd81781e65085ce8fef47c580fc454cd5144e`
- Gałąź review: `review-integration`
- Run: `20260722-144152-n2hub-257-settings-nav-cleanup`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/App.tsx`
- `src/auth/SessionProvider.tsx`
- `src/components/PersistenceBanner.tsx`
- `src/components/icons.ts`
- `src/onboarding/OnboardingRoot.tsx`
- `src/pages/AccountPage.tsx`
- `src/pages/AdminPage.tsx`
- `src/pages/TeamPage.tsx`
- `src/store/AppStore.tsx`
- `src/store/activityAttribution.test.ts`
- `src/store/blockActions.test.ts`
- `src/store/commandValidation.test.ts`
- `src/store/exportDryRun.test.ts`
- `src/store/exportDryRun.ts`
- `src/store/permissions.test.ts`
- `src/store/permissions.ts`
- `src/store/persistGate.test.ts`
- `src/store/persistGate.ts`
- `src/store/seed.ts`
- `src/store/selectors.test.ts`
- `src/store/selectors.ts`
- `src/store/storage.test.ts`
- `src/store/storage.ts`
- `src/store/useCan.ts`
- `src/styles.css`
- `src/supabase/referenceData.test.ts`
- `src/supabase/referenceData.ts`
- `src/types.ts`
- `src/utils/uiPrefs.ts`
- `handoffs/packages/settings-nav-cleanup.md`
- `handoffs/scheduler-reviews/20260722-144152-n2hub-257-settings-nav-cleanup.md`
- `src/components/navItems.test.ts`
- `src/components/navItems.ts`
