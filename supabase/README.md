# Supabase — migracje i model dostępu (RLS)

Migracje definiują docelowy, produkcyjny model dostępu po stronie bazy —
**cała logika uprawnień żyje w SQL**, kontrole po stronie klienta pozostają
wyłącznie UX-em.

## Granica przejściowa (tryb supabase)

W trybie supabase uwierzytelniony profil, dział, rola dostępu oraz widoczność
zespołu są odczytywane z Supabase i **wyjście RLS jest autorytatywne**; kontrole
po stronie klienta to wyłącznie UX. Osiem grup encji planera — **klienci,
projekty, kamienie milowe, zadania, przypisania, zaplanowane godziny (workload:
bloki kalendarza + zasobnik), komentarze i dziennik aktywności** — jest
LUSTRZANE do Supabase (zapisy liczone z diff-a stanu PO reduktorze, przez czyste
`src/supabase/cloudMirror.ts` + `src/supabase/plannerData.ts` za `PlannerDb`) i
HYDRATOWANE przy logowaniu jedną akcją reduktora `MERGE_CLOUD_ENTITIES` (scalenie
po id: wiersz chmury wygrywa, wiersze tylko-lokalne pozostają, para zasobnika
scala się do wiersza z id chmury z sumą godzin na siatce — propagacja kasacji
między klientami jest udokumentowanym ograniczeniem tego etapu). Naruszenia
ograniczeń (`23502/23503/23505/23514`) są klasyfikowane jak odmowa uprawnień
(op porzucony, praca zostaje lokalnie) — nie zatykają kolejki ponawiania.
**localStorage pozostaje kopią do odzysku** — każdy błąd chmury zostawia zmianę
lokalnie (błąd przejściowy: `SYNC_ERROR_MSG` + ponów; odrzucenie uprawnień:
`SYNC_PERMISSION_MSG`, op porzucony).

**Wycofanie aktywnych zapisów localStorage (po weryfikacji migracji).** Panel
`MigrationStatusPanel` (tylko administrator, tryb supabase) uruchamia odwracalny
handshake: pokrycie danych czyste → udany odczyt snapshotu → próbny zapis/odczyt/
usunięcie wiersza → pobrana kopia zapasowa. Dopiero wtedy flaga organizacji
`local_writes_retired` trafia do `public.app_settings`, a per-przeglądarkowy
znacznik na dedykowanym kluczu `n2hub.cloudMigration.v1` (poza kluczem danych
planera; `clearData()` go nie dotyka). Bramka `src/store/persistGate.ts` pozwala
wtedy pominąć per-akcyjny `saveData` TYLKO gdy zmiana dotyka wyłącznie kolekcji
lustrzanych, znacznik jest włączony, środowisko Supabase skonfigurowane, a lustro
zweryfikowane-zdrowe. localStorage NIGDY nie jest usuwane — pozostaje pasywną
kopią do odzysku odświeżaną po hydracji, drenażu kolejki, błędzie przejściowym i
`pagehide` z oczekującymi zapisami. Każda degradacja lustra oraz zmiana kolekcji
bez domu w chmurze wznawiają per-akcyjne zapisy lokalne. Protokół
odświeżenia/konfliktu między kartami tej samej przeglądarki działa jak dotąd;
współbieżność między przeglądarkami to LWW + ręczne odświeżenie. Przywrócenie
(`Przywróć zapisy lokalne`) czyści flagę i znacznik oraz natychmiast zapisuje
raz lokalnie.

LOKALNE NA STAŁE pozostają: **zapisane filtry** (preferencja UI per-użytkownik —
utrzymywane przez regułę „kolekcje bez domu w chmurze zawsze zapisują lokalnie”),
administracja osób (profile: zakładanie konta + samodzielna edycja, kroki 205–206)
oraz **MUTACJE słowników** (statusy / typy usług / kategorie prac / działy —
granica tylko-do-odczytu z kroku 209 obowiązuje). Dane przykładowe i pełny reset
są WYŁĄCZNIE lokalne (nigdy nie dotykają chmury). Tryb lokalny korzysta wyłącznie
z localStorage (`src/store/storage.ts`; żaden klient Supabase nie powstaje, brak
baneru, brak dispatchy; stary zbuforowany znacznik wycofania jest ignorowany).
Ładowanie/błąd w trybie supabase spada z powrotem na lokalną rolę na potrzeby
bramek UX. Odczyty referencyjne żyją w `src/supabase/referenceData.ts` (czyste,
`loadOrgSnapshot` + `effectiveAccessRole`) i `OrgDataProvider.tsx`; import z
`src/supabase/dataImport.ts` migruje słowniki, klientów, projekty/zadania (pełen
zestaw kolumn), kamienie milowe, zaplanowane godziny, komentarze i aktywność
idempotentnie.

Żadna migracja nie została zastosowana na hostowanym projekcie w ramach tego
zadania.

## Struktura i konwencje

```
supabase/
  migrations/
    20260715210000_core_schema.sql    # tabele rdzenia + enable RLS (deny-by-default)
    20260715210500_rls_policies.sql   # funkcje pomocnicze, polityki, Storage avatars
    20260715220000_profiles_must_change_password.sql  # flaga wymuszonej zmiany pierwszego hasła
    20260716150000_reference_tables.sql               # słowniki: statuses, service_types, work_categories
    20260716190000_planner_entities.sql               # klienci, komentarze, dziennik + kolumny planera na projects/tasks
    20260717000000_workload_planner_retirement.sql    # zaplanowane godziny, kamienie milowe, app_settings (flaga wycofania)
  functions/
    provision-account/                # Edge Function: serwerowe zakładanie kont (tylko administrator)
    README.md
  README.md
```

Serwerową granicę zakładania kont (Auth user + wiersz `profiles`, dostępną
wyłącznie dla administratora) opisuje [functions/README.md](functions/README.md).
Ta funkcja nie wymaga żadnej migracji i nie jest jeszcze wywoływana z aplikacji.

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
| `statuses` | CRUD | odczyt | odczyt |
| `service_types` | CRUD | odczyt | odczyt |
| `work_categories` | CRUD | odczyt | odczyt |
| `clients` | CRUD | odczyt wszystkich; tworzenie (SAVE_PROJECT) | odczyt wszystkich |
| `comments` | odczyt/dopisywanie (bez UPDATE/DELETE) | komentarze projektów/zadań swojego działu | komentarze widocznych encji; dopisywanie własnych |
| `activity_events` | odczyt/dopisywanie (bez UPDATE/DELETE) | wpisy encji swojego działu + własne | własne wpisy + wpisy widocznych encji |
| `workload_entries` | CRUD | wiersze zadań swojego działu (zapis wyłącznie dla osób z tego działu) | własne wiersze (przypisane godziny) |
| `milestones` | CRUD | CRUD kamieni milowych projektów swojego działu | odczyt kamieni widocznych projektów |
| `app_settings` | odczyt/zapis (flagi runtime) | odczyt | odczyt |

Słowniki referencyjne (`statuses`, `service_types`, `work_categories`) to dane
całej organizacji: SELECT dla każdego `authenticated` (`using (true)`), a
INSERT/UPDATE/DELETE wyłącznie dla administratora (`app.is_administrator()`).
Kolumna `statuses.sort_order` (nie `order` — słowo zarezerwowane) mapuje
`Status.order` z `src/types.ts`.

Encje planera (`20260716190000_planner_entities`): `clients` to dane referencyjne
biznesu — SELECT dla każdego zalogowanego (`using (true)`, nazwy klientów muszą
renderować się na widocznych projektach), INSERT dla administratora **lub**
menedżera (SAVE_PROJECT menedżera może utworzyć klienta atomowo przez
`newClientName`), UPDATE/DELETE tylko administrator. `comments` i `activity_events`
są **dopisywalne** (append-only): tylko SELECT + INSERT, bez UPDATE/DELETE
(usunięcie encji sprząta je kaskadą FK). Widoczność komentarza/wpisu odpowiada
widoczności jego projektu/zadania (`app.manages_project` / `app.is_project_member`
/ `app.manages_task` / `app.is_assigned_to_task`); autor komentarza musi być
zalogowanym użytkownikiem (albo administrator), a `activity_events.created_by`
(domyślnie `auth.uid()`) jest autorytatywnym autorem wiersza po stronie serwera.
Kolumny planera na `projects`/`tasks` są NULLABLE/z domyślną wartością, więc
wiersze zaimportowane przed tą migracją pozostają poprawne, a istniejące polityki
`projects_*`/`tasks_*` obejmują je automatycznie.

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
- Kolumna `profiles.must_change_password` (domyślnie `true`) wymusza w kliencie
  ustawienie własnego hasła przy pierwszym logowaniu konta założonego przez
  administratora. Flagę czyści właściciel po udanej zmianie hasła — bramka UX,
  nie granica bezpieczeństwa (patrz migracja
  `20260715220000_profiles_must_change_password.sql`).
- Stosowanie na hostowanym projekcie (świadoma decyzja operatora, poza tym
  repo): `supabase link --project-ref <ref>` + `supabase db push`, albo CI.
  Wymaga to uprawnień do tworzenia polityk na `storage.objects` (rola
  `postgres` na współczesnych projektach Supabase je ma).
- Klient frontendowy używa wyłącznie klucza *publishable*
  (patrz `src/supabase/config.ts`); klucze sekretne/service_role nigdy nie
  trafiają do przeglądarki ani do tego repo.
