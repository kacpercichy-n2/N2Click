# Raport workflow: 20260716-091154-205-admin-team-account-ui

## Wykonane

TierWorkflow, trasa `developer → reviewer` (jedna granica implementacyjna,
testy nierozdzielne od logiki widoczności ról). Zbudowano chroniony rolami
obszar „Struktura zespołu” (`/team`) oraz administracyjne zakładanie kont
przez zaufany endpoint provisioningu z zadania 204:

- **`src/pages/teamScope.ts`** (nowy) — czysty moduł: `teamAccessForUser` /
  `canViewTeam` (mapowanie roli lokalnej na zakres widoczności zgodnie z
  modelem serwerowym: `pracownik`/`handlowiec` = worker → obszar ukryty,
  `pm` = manager → wyłącznie własny dział, `administrator` → wszystkie
  działy), `buildTeamHierarchy` (działy → osoby ze stanowiskiem, etykietą
  roli dostępu i przełożonym; grupa „Bez działu” tylko dla administratora),
  `PROVISION_ROLE_LABELS` (Administrator / Menedżer / Pracownik) i
  `buildProvisionRequest` — walidacja formularza przez reuse
  `parseProvisionRequest` z `supabase/functions/provision-account/contract.ts`
  (bez duplikacji reguł), tryb hasła `invite` (zero haseł w UI).
- **`src/pages/TeamPage.tsx`** (nowy) — hierarchia renderowana z lokalnego
  store (gate UX; realny zakres wymusza RLS). Formularz zakładania konta NIE
  renderuje się domyślnie — rozwija go jawna akcja „Utwórz konto”, widoczna
  wyłącznie dla administratora w trybie supabase; w trybie lokalnym zamiast
  akcji krótka informacja, że zakładanie kont wymaga połączenia z serwerem.
  Pola: imię, nazwisko, znormalizowany e-mail firmowy (trim + lowercase),
  stanowisko operacyjne, dział, przełożony (menedżerowie wybranego działu),
  rola dostępu — administrator jako rola dostępu systemowego, odrębna od
  stanowiska. Listy działów/menedżerów pobierane z Supabase po rozwinięciu
  formularza (polskie stany ładowania/błędu). Sukces/błąd po polsku, bez
  ekspozycji credentiali.
- **`src/supabase/provisioning.ts`** (nowy) — cienki klient przeglądarkowy:
  URL `<url>/functions/v1/provision-account` z `resolveSupabaseConfig`,
  POST JSON z `Authorization: Bearer <access_token>`, wstrzykiwany `fetch`
  (testowalność), wyłącznie polskie komunikaty; żadna ścieżka nie loguje ani
  nie zwraca tokenu, hasła czy surowej odpowiedzi SDK.
- **`src/App.tsx`** — trasa `/team` + link nawigacji „Struktura zespołu”
  gated przez `canViewTeam` (worker/handlowiec → redirect do `/dashboard`),
  lustrzany wzorzec istniejącego gatingu `/admin` i `/account` (bez ich zmian).
  Etykieta „Struktura zespołu” zamiast „Zespół”, bo `/people` używa już
  etykiety „Zespół”.
- **Testy** (nowe, czysty node/vitest, bez jsdom):
  `src/pages/teamScope.test.ts` — widoczność dla czterech ról lokalnych,
  hierarchia (admin: wszystkie działy z uzgodnioną organizacją Design i IT /
  Marketing / Produkcja / Dział handlowy w fixture'ach; pm: tylko własny
  dział), walidacja formularza przez kontrakt;
  `src/supabase/provisioningClient.test.ts` — poprawny URL/nagłówki/body,
  sukces, 409, 403, odpowiedź bez body, błąd sieci, brak wycieku tokenu.
- Drobne: `src/components/icons.ts` (+ikona `Network`), `src/styles.css`
  (klasy hierarchii/formularza, reszta to reuse istniejących klas),
  `handoffs/RUN-STATE.md` (wpis runu).

Bez migracji SQL, bez zmian Edge Function, bez provisioningu realnych kont,
bez avatar uploadu i bez migracji rekordów plannera. `src/store/permissions.ts`
nietknięty — mapowanie rola→zakres jest specyficzne dla obszaru, nie pasuje do
matrixa PermAction.

## Zmiany

- `src/pages/TeamPage.tsx` (nowy)
- `src/pages/teamScope.ts` (nowy)
- `src/pages/teamScope.test.ts` (nowy)
- `src/supabase/provisioning.ts` (nowy)
- `src/supabase/provisioningClient.test.ts` (nowy)
- `src/App.tsx` (trasa + nav)
- `src/components/icons.ts` (ikona Network)
- `src/styles.css` (style obszaru zespołu)
- `handoffs/RUN-STATE.md` (wpis runu)

## Weryfikacja

- `npx vitest run src/pages/teamScope.test.ts src/supabase/provisioningClient.test.ts`:
  **25 passed / 0 failed** (worker)
- `npm test`: **752 testy / 21 plików — zielone** (worker i orkiestrator,
  niezależnie)
- `npm run build` (`tsc --noEmit && vite build`): **zielony** (jedynie
  wcześniej istniejące ostrzeżenie o chunku >500 kB)
- Skan diffu: brak sekretów/kluczy/haseł, brak `console.*` w nowych modułach,
  brak zmian w stability-sensitive obszarze kalendarza/bin.
- `npm test` / `npm run build` jako obowiązkowy gate: wykona scheduler.
- Decyzja wiki: **wiki unchanged** — `openwiki/n2hub/ui-navigation-and-onboarding.md`
  nadal poprawnie opisuje granice (routing w `App.tsx`, polskie stringi,
  kontrole uprawnień jako UX); nowa trasa powiela udokumentowany wzorzec
  gatingu `/admin`/`/account`, nie zmieniając żadnej opisanej granicy.

## Ryzyka / rzeczy do sprawdzenia

- Token dostępu pobierany przy submit przez `getSupabaseClient().auth.getSession()`,
  bo typowany `AuthSession` w `src/auth/session.ts` celowo eksponuje tylko
  `user` — zgodne z tym, jak `SessionProvider` już sięga po surowy klient.
- Nazwy kolumn list serwerowych (`departments.id/name`,
  `profiles.first_name/last_name/department_id/access_role`) przyjęte z
  kontraktu Edge Function; to zachowanie realnego serwera niemożliwe do
  pokrycia w testach node — ścieżka pozostaje celowo bez testu.
- Widoczność `/team` to wyłącznie gate UX po stronie klienta; realny zakres
  danych wymusza RLS (201) i autoryzacja Edge Function (204).

## Podpis schedulera

- Run: `20260716-091154-205-admin-team-account-ui`
- Prompt: `205-admin-team-account-ui.md`
- Gałąź review: `review-integration`
- Baza: `61bb04f545f40112ccb6f344f2dbc2d3b3710f4f`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `61bb04f545f40112ccb6f344f2dbc2d3b3710f4f`
- Gałąź review: `review-integration`
- Run: `20260716-091154-205-admin-team-account-ui`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/App.tsx`
- `src/components/icons.ts`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260716-091154-205-admin-team-account-ui.md`
- `src/pages/TeamPage.tsx`
- `src/pages/teamScope.test.ts`
- `src/pages/teamScope.ts`
- `src/supabase/provisioning.ts`
- `src/supabase/provisioningClient.test.ts`
