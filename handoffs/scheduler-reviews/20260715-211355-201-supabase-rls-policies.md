# Raport workflow: 20260715-211355-201-supabase-rls-policies

## Wykonane

Dodano wersjonowane migracje Supabase z produkcyjnym modelem Row Level
Security — jako uśpioną infrastrukturę, bez żadnej zmiany w aktywnym przepływie
localStorage i bez kontaktu z hostowanym projektem.

Kontekst zastany: etap 200 dodał wyłącznie klienta (`src/supabase/`) — w repo
nie było jeszcze żadnego schematu ani katalogu `supabase/`. Ta migracja ustanawia
więc konwencję (`supabase/migrations/YYYYMMDDHHMMSS_opis.sql`, tylko-do-przodu)
i dzieli pracę na dwa pliki:

- `supabase/migrations/20260715210000_core_schema.sql` — minimalny rdzeń pod
  model działowy: `profiles` (1:1 z `auth.users`), `departments`, `projects`,
  `project_members`, `tasks`, `task_assignments`; enum `public.access_role`
  (`administrator`/`manager`/`worker`); trigger `updated_at`; indeksy pod
  warunki polityk. RLS jest **włączane w tej samej migracji, w której powstaje
  tabela** (deny-by-default zanim istnieją polityki), a rola `anon` traci
  domyślne uprawnienia. Celowo bez `force row level security` (patrz niżej).
- `supabase/migrations/20260715210500_rls_policies.sql` — nierekursywne funkcje
  pomocnicze w schemacie `app` (poza API PostgREST): wszystkie `STABLE
  SECURITY DEFINER` + `set search_path = ''`, czytają tabele jako właściciel,
  więc polityka nigdy nie odpytuje samej siebie (klasyczna rekursja `profiles`
  wykluczona konstrukcyjnie; dlatego FORCE RLS jest zakazane i pilnowane
  testem). Polityki: administrator — pełny dostęp; manager — profile/projekty/
  zadania swojego działu (CRUD), członkostwo i przypisania ograniczone w
  `WITH CHECK` do osób z własnego działu; worker — własny profil, odczyt
  projektów przez członkostwo, odczyt+aktualizacja zadań przez przypisanie.
  Reguły „stare vs nowe” egzekwują triggery: `protect_profile_privileges`
  (blokada samo-eskalacji `access_role`/`department_id`) i
  `protect_task_project` (relokacja zadania tylko przez admina/menedżera obu
  projektów).
- Storage: prywatny bucket `avatars` (`public = false`, wymuszane też przy
  istniejącym buckecie); konwencja ścieżki `<id profilu>/<plik>`; odczyt
  awatara = widoczność profilu (`app.can_view_profile`); zapis/edycja/usunięcie
  wiążą folder ścieżki **i** `owner_id` z wgrywającym. Zgodnie z zadaniem
  migracja **waliduje rzeczywisty typ identyfikatora właściciela** w bloku
  `DO` (wymaga `storage.objects.owner_id` typu `text`; kolumna `owner uuid`
  jest przestarzała) i zatrzymuje się z jasnym błędem przed utworzeniem
  polityk, gdyby hostowany schemat Storage odbiegał od założeń.
- Dokumentacja: `supabase/README.md` — konwencje, macierz widoczności ról,
  wyjaśnienie braku rekursji, model awatarów, bootstrap pierwszego
  administratora, procedura przyszłego `db push` (decyzja operatora).
- Walidacja statyczna: `src/supabase/migrations.test.ts` (17 testów vitest,
  wchodzi w `npm test`) parsuje pliki SQL i pilnuje inwariantów: RLS na każdej
  tworzonej tabeli, zakaz FORCE RLS, `search_path` w każdej funkcji, `stable`
  na każdym definerze, revoke/grant EXECUTE w schemacie `app`, polityki
  wyłącznie `to authenticated`, wymagane pokrycie per-komenda dla każdej
  tabeli, `with check` na insert/update, prywatność bucketa i kolejność
  „walidacja typu owner_id przed politykami storage”.
- Drobne: `.gitignore` + `supabase/.temp/`, `supabase/.branches/` (artefakty
  CLI); wpis w `handoffs/RUN-STATE.md`.

Nie zastosowano migracji na hostowanym projekcie, nie tworzono użytkowników,
nie użyto poświadczeń service-role; `storage.ts`/`AppStore.tsx` nietknięte.
Wiki: bez zmian — localStorage pozostaje jedyną aktywną granicą persystencji
(`state-and-persistence.md` aktualne), a nowy test to standardowy
`src/**/*.test.ts` objęty opisem w `testing-and-automation.md`.

## Zmiany

- `supabase/migrations/20260715210000_core_schema.sql` — nowy (schemat rdzenia).
- `supabase/migrations/20260715210500_rls_policies.sql` — nowy (RLS + Storage).
- `supabase/README.md` — nowy (dokumentacja modelu dostępu i konwencji).
- `src/supabase/migrations.test.ts` — nowy (statyczna walidacja migracji).
- `.gitignore` — artefakty Supabase CLI.
- `handoffs/RUN-STATE.md` — wpis runu.

## Weryfikacja

- `npx vitest run src/supabase/`: PASS — 33 testy (16 istniejących config +
  17 nowych walidacji migracji).
- `npm test`: PASS — 16 plików, 652 testy.
- `npm run build` (`tsc --noEmit && vite build`): PASS — tsc czysty; jedynie
  wcześniej istniejące ostrzeżenie o chunku >500 kB. Migracje nie wpływają na
  bundle (test korzysta z `import.meta.glob` tylko w vitest).

## Ryzyka / rzeczy do sprawdzenia

- SQL nie był wykonany na żadnym Postgresie (w środowisku brak lokalnego
  Supabase/psql; zadanie zakazuje dotykania hostowanego projektu). Walidacja
  jest statyczna — przed `db push` warto przepuścić migracje przez
  `supabase db start`/`supabase db lint` lokalnie.
- Tworzenie polityk na `storage.objects` wymaga uprawnień właścicielskich;
  na współczesnych projektach Supabase rola `postgres` (CLI) je ma, na bardzo
  starych instancjach może być konieczne założenie polityk przez dashboard.
- Mapowanie ról frontendu (`pm → manager`, `handlowiec/pracownik → worker`)
  to robocze założenie zapisane w README i migracji — do potwierdzenia przy
  zadaniu integracyjnym (4 role aplikacji vs 3 poziomy w bazie).
- Interpretacja zakresu widoczności: worker widzi zadania **przypisane do
  niego** (litera zadania); członkostwo w projekcie daje mu odczyt projektu,
  ale nie automatycznie wszystkich jego zadań — rozszerzenie to jedna linijka
  w `tasks_select`, decyzja odnotowana w README.
- Bootstrap pierwszego administratora wymaga działania operatora poza API
  (polityka `profiles_insert_admin` celowo nie ma samodzielnej rejestracji).

## Podpis schedulera

- Run: `20260715-211355-201-supabase-rls-policies`
- Prompt: `201-supabase-rls-policies.md`
- Gałąź review: `review-integration`
- Baza: `ad5fa056096ff68a0b0f1f11e6b4b96b3a286c24`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `ad5fa056096ff68a0b0f1f11e6b4b96b3a286c24`
- Gałąź review: `review-integration`
- Run: `20260715-211355-201-supabase-rls-policies`

### Pliki zgłoszone do review

- `.gitignore`
- `handoffs/RUN-STATE.md`
- `handoffs/scheduler-reviews/20260715-211355-201-supabase-rls-policies.md`
- `src/supabase/migrations.test.ts`
- `supabase/`
