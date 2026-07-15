# Supabase — migracje i model dostępu (RLS)

Ten katalog to **uśpiona infrastruktura**: aplikacja nadal działa wyłącznie na
localStorage (`src/store/storage.ts`), a klient z `src/supabase/` nie jest
jeszcze nigdzie importowany. Migracje definiują docelowy, produkcyjny model
dostępu po stronie bazy — **cała logika uprawnień żyje w SQL**, kontrole po
stronie klienta pozostają wyłącznie UX-em.

Żadna migracja nie została zastosowana na hostowanym projekcie w ramach tego
zadania.

## Struktura i konwencje

```
supabase/
  migrations/
    20260715210000_core_schema.sql    # tabele rdzenia + enable RLS (deny-by-default)
    20260715210500_rls_policies.sql   # funkcje pomocnicze, polityki, Storage avatars
  README.md
```

- Nazwa pliku: `YYYYMMDDHHMMSS_opis.sql` (konwencja Supabase CLI); wersje muszą
  rosnąć, a zastosowanego pliku nie wolno edytować — poprawki tylko nową
  migracją.
- Każda funkcja ustawia `set search_path = ''` i w pełni kwalifikuje nazwy.
- Funkcje pomocnicze żyją w schemacie `app` (poza API PostgREST); po ich
  utworzeniu odbieramy `EXECUTE` roli `PUBLIC` i nadajemy go `authenticated`.
- Nowa tabela w `public` dostaje `enable row level security` w tej samej
  migracji, w której powstaje, oraz `revoke all ... from anon` (N2Hub nie ma
  danych anonimowych).
- **Nigdy** `force row level security` — patrz „Brak rekursji” niżej.

Konwencje pilnuje statyczny test `src/supabase/migrations.test.ts`
(uruchamiany w `npm test`), który parsuje pliki `supabase/migrations/*.sql`.

## Model ról

Enum `public.access_role`: `administrator`, `manager`, `worker`.
Menedżer zarządza działem wskazanym w **własnym** `profiles.department_id`.
Robocze mapowanie z ról frontendu (`AccessRole` w `src/types.ts`):
`administrator → administrator`, `pm → manager`, `handlowiec/pracownik →
worker` — do potwierdzenia przy zadaniu integracyjnym.

## Macierz widoczności

| Tabela | administrator | manager | worker |
| --- | --- | --- | --- |
| `profiles` | CRUD | odczyt profili swojego działu (+ własny); edycja tylko własnego | odczyt/edycja tylko własnego |
| `departments` | CRUD | odczyt własnego działu | odczyt własnego działu |
| `projects` | CRUD | CRUD projektów swojego działu (bez przenoszenia do cudzego działu) | odczyt projektów, w których jest członkiem |
| `project_members` | CRUD | zarządza członkostwem projektów swojego działu, dodaje wyłącznie osoby z tego działu | odczyt własnych członkostw |
| `tasks` | CRUD | CRUD zadań w projektach swojego działu | odczyt + aktualizacja zadań, do których jest przypisany |
| `task_assignments` | CRUD | zarządza przypisaniami zadań swojego działu, przypisuje wyłącznie osoby z tego działu | odczyt własnych przypisań |

Reguły niewyrażalne w `WITH CHECK` (porównanie starych i nowych wartości)
egzekwują triggery:

- `protect_profile_privileges` — nie-administrator nie zmieni swojej
  `access_role`, `department_id` ani `id` (polityka UPDATE pozwala mu edytować
  własny profil, trigger blokuje eskalację uprawnień);
- `protect_task_project` — przeniesienie zadania między projektami wymaga
  administratora albo menedżera obu projektów.

Projekt z `department_id = null` widzą tylko administratorzy i jawni
członkowie; menedżer nie może „odpiąć” projektu od działu (WITH CHECK).

## Brak rekursji w politykach

Klasyczna pułapka RLS: polityka na `profiles` odpytująca `profiles` (np. „czy
jestem adminem?”) rekursywnie uruchamia samą siebie. Rozwiązanie zastosowane
tutaj:

- wszystkie funkcje pomocnicze (`app.is_administrator()`,
  `app.current_department_id()`, `app.manages_project(...)`, …) są
  `STABLE SECURITY DEFINER`, więc czytają tabele **jako ich właściciel**,
  z pominięciem RLS — polityka nigdy nie wraca do samej siebie;
- dlatego żadna tabela **nie może** dostać `force row level security` —
  FORCE objąłby RLS także właściciela i przywrócił rekursję;
- to bezpieczne, bo funkcje zwracają wyłącznie ciasne odpowiedzi
  boolean/uuid, nigdy całe wiersze.

## Storage: prywatny bucket `avatars`

- Bucket `avatars` jest **prywatny** (`public = false`; migracja wymusza to
  także, gdy bucket już istniał). Odczyt wyłącznie przez podpisane URL-e /
  API z JWT.
- Konwencja ścieżki: `<id profilu>/<nazwa pliku>` (np.
  `123e4567-.../avatar.webp`).
- Odczyt awatara = widoczność profilu (`app.can_view_profile`), więc pracownik
  widzi tylko własny awatar, menedżer — awatary swojego działu, administrator
  — wszystkie (w tym obiekty spoza konwencji ścieżki).
- Zapis/edycja/usunięcie: wyłącznie własny folder **i** zgodny
  `storage.objects.owner_id` (obie tożsamości muszą się zgadzać) albo
  administrator.
- Migracja waliduje w bloku `DO` rzeczywisty typ identyfikatora właściciela
  (`storage.objects.owner_id` musi istnieć i być `text`; kolumna `owner uuid`
  jest przestarzała) i zatrzymuje się z jasnym błędem, gdy hostowany schemat
  Storage odbiega od założeń — polityki nie powstaną z cichą, inną semantyką.

## Bootstrap i stosowanie

- Pierwszego administratora tworzy operator poza API (SQL Editor / dashboard):
  konto w `auth.users`, potem wiersz w `public.profiles` z
  `access_role = 'administrator'`. Polityka `profiles_insert_admin` świadomie
  nie ma ścieżki samodzielnej rejestracji.
- Stosowanie na hostowanym projekcie (świadoma decyzja operatora, poza tym
  repo): `supabase link --project-ref <ref>` + `supabase db push`, albo CI.
  Wymaga to uprawnień do tworzenia polityk na `storage.objects` (rola
  `postgres` na współczesnych projektach Supabase je ma).
- Klient frontendowy używa wyłącznie klucza *publishable*
  (patrz `src/supabase/config.ts`); klucze sekretne/service_role nigdy nie
  trafiają do przeglądarki ani do tego repo.
