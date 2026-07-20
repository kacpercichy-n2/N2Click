# Raport workflow: 20260720-132101-223-avatar-save-and-display

## Wykonane

Najpierw sprawdziłem stan bieżącej gałęzi: oba zgłoszenia operatora były nadal
aktualne. Istniał kod z etapu 206 (`avatarFile.ts`, `avatarStorage.ts`, sekcja
„Zdjęcie profilowe” na stronie osoby), ale:

- wskazanie pliku wysyłało go NATYCHMIAST — nie było żadnego przycisku zapisu;
- `photoUrl` był przekazywany do `<Avatar>` wyłącznie w jednym miejscu
  (`PersonProfilePage`), więc zdjęcie widać było tylko na własnym profilu; żaden
  inny widok nie czytał awatarów, także cudzych.

### 1. Jawny zapis zdjęcia („Zapisz zmiany”)

`AvatarPhotoSection` w `src/pages/PersonProfilePage.tsx` przerobiona na model z
wyborem oczekującym (`PendingAvatarChange`):

- wskazanie pliku tylko WALIDUJE (`validateAvatarFile`) i pokazuje podgląd
  (obiektowy URL, zwalniany przy zmianie/porzuceniu wyboru i przy odmontowaniu);
- „Usuń zdjęcie” również tylko planuje usunięcie;
- do chmury zapisuje wyłącznie przycisk **„Zapisz zmiany”** (nieaktywny, gdy nie
  ma zmian), obok niego „Anuluj”. Komunikat pod spodem mówi, co zostanie zapisane.

Zapis idzie dotychczasową ścieżką chmurową: `uploadAvatar` (bucket `avatars` +
`profiles.avatar_path`) albo `removeAvatar`. Zgodnie z inwariantem 6 nieudany
zapis NIE melduje sukcesu — pokazuje polski błąd, zachowuje wybór do ponowienia
i nie rusza stanu zapisanego. Sukces daje „Zapisano zmiany.” / „Usunięto
zdjęcie.” dopiero po potwierdzeniu z backendu.

### 2. Awatary w całym UI (także cudze)

Zamiast doklejać odczyt w każdym widoku, wpiąłem JEDNO źródło w sam komponent
`Avatar`, więc wszystkie istniejące miejsca wywołania dostały zdjęcia naraz:

- `src/supabase/referenceData.ts` — snapshot organizacji czyta dodatkowo
  `avatar_path` (`CloudProfile.avatarPath`); to te same wiersze `profiles`
  zscope'owane przez RLS, więc bez dodatkowego zapytania;
- `src/supabase/avatarDirectory.ts` (nowy, czysty, testowalny w node) — buduje
  katalog „znormalizowany e-mail → ścieżka” i planuje, które wpisy wymagają
  nowego podpisu, a które zostają;
- `src/supabase/AvatarProvider.tsx` (nowy) — podpisuje URL-e dla WSZYSTKICH
  widocznych profili, wystawia `usePersonPhotoUrl(person)` oraz
  `useSetPersonAvatar()` (natychmiastowa aktualizacja po zapisie na profilu, bez
  czekania na przeładowanie snapshotu). Zamontowany w `main.tsx` wewnątrz
  `OrgDataProvider`. W trybie lokalnym i przed zalogowaniem katalog jest pusty i
  żaden klient Supabase nie powstaje;
- `src/components/Avatar.tsx` — czyta katalog po e-mailu; `photoUrl` nadal
  nadpisuje (podgląd niezapisanego pliku), a `null` jawnie wyłącza zdjęcie
  (zaplanowane usunięcie). Bez dostawcy hook zwraca `undefined` — render jak
  dotąd. Fallback kolejno: zdjęcie → emoji → inicjały na kolorze osoby.

Zdjęcia renderują się teraz wszędzie, gdzie stoi `<Avatar>`: nagłówek/menu
użytkownika (`App.tsx`), lista osób (`PeoplePage`), obciążenie
(`WorkloadPage`), wyszukiwarka globalna, komentarze, czat, ekran logowania,
strona profilu. Dodatkowo podmieniłem kropkę na awatar 20 px w wyborze
przypisanych osób w `TaskModal` (kodowanie kolorem zachowane — awatar bez
zdjęcia i tak stoi na kolorze osoby).

Odświeżanie podpisów: podpisany URL żyje godzinę, więc dostawca przepisuje je
cyklicznie dokładnie w momencie, w którym cache `avatarFile.ts` przestaje
oddawać wpis (TTL − margines = 55 min). Bez tego karta otwarta cały dzień
kończyła z zepsutymi obrazkami. Odświeżenie nie miga na inicjały — stare URL-e
zostają do nadejścia nowych.

Wiki: dopisałem w sekcji „Boundaries” w `openwiki/n2hub/cloud-database.md` punkt
o granicy awatarów (nie była tam opisana, a teraz jest to źródło dla całego UI).

## Zmiany

Nowe: `src/supabase/avatarDirectory.ts`, `src/supabase/avatarDirectory.test.ts`,
`src/supabase/AvatarProvider.tsx`.
Zmienione: `src/components/Avatar.tsx`, `src/components/TaskModal.tsx`,
`src/pages/PersonProfilePage.tsx`, `src/supabase/referenceData.ts`,
`src/main.tsx`, `src/styles.css` (`.btn.disabled` dla `<label class="btn">`),
`openwiki/n2hub/cloud-database.md` oraz fixture'y `CloudProfile` w pięciu
plikach testowych (nowe wymagane pole `avatarPath`).

## Weryfikacja

- `npm test`: **zielone — 1068 testów w 42 plikach**. Uwaga: prompt zakładał 912
  testów; bieżąca gałąź integracyjna ma ich więcej niż baza z treści zadania.
  Dołożyłem 9 nowych testów (`avatarDirectory.test.ts` — normalizacja e-maili,
  duplikaty, plan podpisu przy zmianie ścieżki, usuwanie wpisów, scalanie i
  nieudany podpis; `referenceData.test.ts` — mapowanie `avatar_path`, puste → null).
- `npm run build`: **zielone** (obejmuje `tsc --noEmit`).
- `npm run check:openwiki`: zielone (7 plików wiki).
- Sprawdzenie w przeglądarce: **nie uruchomiono** — w tym worktree nie ma
  zainstalowanego `playwright` (`ERR_MODULE_NOT_FOUND` dla
  `scripts/browser-check-*.mjs`). Sprawdziłem natomiast, że żaden skrypt
  browser-check nie selektuje `assignee-chip`, `person-dot` ani awatarów, więc
  zmiana w `TaskModal` nie rusza pokrycia tych scenariuszy.

## Ryzyka / rzeczy do sprawdzenia

- **Bez weryfikacji na żywym Supabase.** Poprawność zapisu i odczytu opiera się
  na istniejących politykach RLS: `avatars_select` pozwala czytać awatary
  profili, które wolno widzieć (`app.can_view_profile`), więc cudze zdjęcia
  powinny się ładować; przy braku uprawnień wpis po prostu nie trafia do
  katalogu i UI wraca do inicjałów (nieblokująco). Warto potwierdzić na środowisku.
- Katalog awatarów jest tak szeroki, jak zwróci RLS — osoba niewidoczna dla
  zalogowanego użytkownika nigdzie nie pokaże zdjęcia (to poprawne zachowanie,
  nie błąd).
- Wiązanie planer↔konto idzie po e-mailu (jak `findPersonByEmail`), więc osoba z
  innym e-mailem w planerze niż w koncie chmurowym nie dostanie zdjęcia.
- 9–10-pikselowe kropki osób (`PersonChip`, timeline, `MonthView`,
  `AllocationGrid`, `PersonFilter`) celowo zostały kropkami — w tym rozmiarze
  zdjęcie jest nieczytelne, a kropka pełni tam rolę kodowania kolorem.
- Trybu wygaszania (retirement) nie dotykałem i nie włączałem.

## Podpis schedulera

- Run: `20260720-132101-223-avatar-save-and-display`
- Prompt: `223-avatar-save-and-display.md`
- Gałąź review: `review-integration`
- Baza: `ab749c34bd0035db9f8076057cb22bc6bce8cc7a`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `ab749c34bd0035db9f8076057cb22bc6bce8cc7a`
- Gałąź review: `review-integration`
- Run: `20260720-132101-223-avatar-save-and-display`

### Pliki zgłoszone do review

- `openwiki/n2hub/cloud-database.md`
- `src/components/Avatar.tsx`
- `src/components/TaskModal.tsx`
- `src/main.tsx`
- `src/pages/PersonProfilePage.tsx`
- `src/pages/teamScope.test.ts`
- `src/styles.css`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/migrationStatus.test.ts`
- `src/supabase/plannerData.test.ts`
- `src/supabase/referenceData.test.ts`
- `src/supabase/referenceData.ts`
- `handoffs/scheduler-reviews/20260720-132101-223-avatar-save-and-display.md`
- `src/supabase/AvatarProvider.tsx`
- `src/supabase/avatarDirectory.test.ts`
- `src/supabase/avatarDirectory.ts`
