# Raport workflow: 20260716-092511-206-avatar-and-profile-editing

## Wykonane

Trasa tier: architect → developer (reviewer po stronie schedulera, Codex review: required). Pakiet: `handoffs/PKG-20260716-avatar-profile-editing.md`.

- **Awatar (prywatny bucket `avatars` z etapu 201 — bez nowej migracji):**
  `src/supabase/avatarFile.ts` — czysta walidacja pliku (tylko JPG/PNG/WebP,
  limit 2 MB, polskie komunikaty), budowa ścieżki obiektu
  `<profileId>/avatar.<ext>` oraz cache podpisanych URL-i (TTL 3600 s, margines
  odświeżenia 300 s, zegar wstrzykiwany — testowalne w node).
  `src/supabase/avatarStorage.ts` — granica sieciowa: upload (upsert + zapis
  `profiles.avatar_path` + sprzątanie starego obiektu przy zmianie rozszerzenia),
  usunięcie awatara oraz pobranie wyłącznie przez `createSignedUrl` — żadnych
  publicznych URL-i. Klient Supabase tworzony leniwie; w trybie lokalnym (brak
  `VITE_SUPABASE_*`) sekcja zdjęcia w ogóle się nie renderuje.
- **Polityka edycji profilu:** `src/pages/profileEditPolicy.ts` — czysta macierz
  pól edytowalnych: admin/tryb setup — wszystkie pola; użytkownik o sobie —
  pola własne bez `email`, `roleTitle`, `departmentId` (e-mail to łącznik
  tożsamości Supabase); PM — wskazane pola tylko dla osób z własnego działu
  (bez adminów). `canUploadAvatarPhoto` odzwierciedla RLS Storage (tryb
  Supabase + self lub admin), więc UI nie obiecuje niczego, czego polityki nie
  dopuszczą.
- **UI:** `src/pages/PersonProfilePage.tsx` konsumuje macierz (pola bez
  uprawnień są `disabled` z tytułem wyjaśniającym) i zawiera sekcję zdjęcia ze
  stanami ładowania / braku zdjęcia / zapisu / sukcesu / błędu
  (`role="status"` / `role="alert"`, komunikaty po polsku).
  `src/components/Avatar.tsx` — opcjonalny `photoUrl` (bez niego render
  identyczny jak dotąd). `src/pages/AccountPage.tsx` — link „Mój profil”.
- Bez zmian w `supabase/` (migracje nietknięte), bez publicznego storage, bez
  załączników, bez zmian w provisioning; dane obrazów nigdy nie trafiają do
  localStorage (wersja danych 7 bez zmian).

## Zmiany

- Nowe: `src/supabase/avatarFile.ts` (+ test), `src/supabase/avatarStorage.ts`,
  `src/pages/profileEditPolicy.ts` (+ test),
  `handoffs/PKG-20260716-avatar-profile-editing.md`.
- Zmienione: `src/pages/PersonProfilePage.tsx`, `src/pages/AccountPage.tsx`,
  `src/components/Avatar.tsx`, `src/styles.css`, `handoffs/RUN-STATE.md`.

## Weryfikacja

- Testy skupione (walidacja plików + polityka ról): 27/27 zaliczone.
- `npm test`: 779/779 zaliczone (23 pliki) — uruchomione przez developera i
  powtórzone przez orkiestratora na końcowym stanie drzewa.
- `npm run build` (tsc --noEmit + vite): czysto.
- `migrations.test.ts` bez zmian i zielony; brak `getPublicUrl` w `src/`.

## Ryzyka / rzeczy do sprawdzenia

- Świadome zaostrzenie: `email`, `roleTitle` i `departmentId` przestają być
  edytowalne przez samego użytkownika (tylko admin/setup) — decyzja pakietu,
  do potwierdzenia w review.
- Ścieżki uploadu/podpisanych URL-i nie były testowane na żywym projekcie
  Supabase (brak konfiguracji w tym środowisku) — pokryte testami czystych
  modułów i buildem; RLS bucketu `avatars` pochodzi z etapu 201.
- Pola tekstowe profilu nadal żyją tylko w lokalnym `Person` (do serwera
  zapisywany jest wyłącznie `avatar_path`) — przyszłe zadanie synchronizacji
  profili musi to uzgodnić.
- Wiki: `openwiki/n2hub/ui-navigation-and-onboarding.md` może wymagać jednej
  linii o granicy polityki profilu/awatara — decyzja należy do finalnego
  reviewera schedulera.

## Podpis schedulera

- Run: `20260716-092511-206-avatar-and-profile-editing`
- Prompt: `206-avatar-and-profile-editing.md`
- Gałąź review: `review-integration`
- Baza: `4929e03aaa3e01626f3e4ad9709dc34ac5d1e9c1`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `4929e03aaa3e01626f3e4ad9709dc34ac5d1e9c1`
- Gałąź review: `review-integration`
- Run: `20260716-092511-206-avatar-and-profile-editing`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/components/Avatar.tsx`
- `src/pages/AccountPage.tsx`
- `src/pages/PersonProfilePage.tsx`
- `src/styles.css`
- `handoffs/PKG-20260716-avatar-profile-editing.md`
- `handoffs/scheduler-reviews/20260716-092511-206-avatar-and-profile-editing.md`
- `src/pages/profileEditPolicy.test.ts`
- `src/pages/profileEditPolicy.ts`
- `src/supabase/avatarFile.test.ts`
- `src/supabase/avatarFile.ts`
- `src/supabase/avatarStorage.ts`
