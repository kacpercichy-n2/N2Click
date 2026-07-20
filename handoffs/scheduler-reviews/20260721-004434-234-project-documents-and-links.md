# Raport workflow: 20260721-004434-234-project-documents-and-links

## Wykonane

Najpierw sprawdzono, czy funkcja już istnieje w bieżącym buildzie — nie istniała
(brak `documents` w `src/types.ts` i w `src/store/`, brak migracji dokumentów).
Zadanie zrealizowano w całości.

**Model.** `ProjectDocumentKind` (`oferta | wycena | brief | link`) oraz
`ProjectDocument { id, kind, label, url }` w `src/types.ts`; `Project.documents`
jest polem **wymaganym**, spójnie z istniejącym `Task.checklist`. Nowy
`src/utils/projectDocuments.ts` skupia polskie etykiety rodzajów, wartość
domyślną (`link`), type guard i `normalizeProjectDocumentUrl`.

**Reduktor i persystencja.** Akcje `ADD_/SAVE_/DELETE_PROJECT_DOCUMENT`
w `src/store/AppStore.tsx`; walidacja w `src/store/commandValidation.ts`.
Odrzucona komenda zwraca **tę samą referencję stanu** (inwariant 6), a zapis bez
zmiany wartości jest no-opem. Każda zmiana odświeża `updatedAt` i dopisuje wiersz
dziennika projektu. `repairProjectDocuments` w `src/store/storage.ts` domyślnie
ustawia `[]` dla danych legacy i biegnie na wyniku obu ścieżek wczytania.
`DATA_VERSION` pozostaje 7 — pole jest addytywne, a repair pokrywa każdą ścieżkę
`REPLACE_FROM_STORAGE`; to ten sam precedens co przy zgłoszeniach (tickets).

**Migracja.** `supabase/migrations/20260721010000_project_documents.sql` —
kolumna jsonb `projects.documents not null default '[]'` z CHECK
`jsonb_typeof(...) = 'array'`, idempotentna (`add column if not exists`,
`drop constraint if exists` + `add`). Wybrano kolumnę zamiast osobnej tabeli
`project_documents`: lista jest zawsze czytana i zapisywana razem z projektem,
a RLS dziedziczy się z wiersza `public.projects` — zero nowych polityk. Lista
plików uzupełniona w `src/supabase/migrations.test.ts`; mapowanie w
`cloudMirror.ts`, `plannerData.ts` i `dataImport.ts`.

**UI.** Karta „Dokumenty” w `src/pages/ProjectDetailPage.tsx`: lista z odznaką
rodzaju i odnośnikiem (`target="_blank" rel="noopener"`), przyciski Edytuj/Usuń
oraz jeden formularz obsługujący dodawanie i edycję (select rodzaju, opcjonalna
nazwa, wymagany adres). Wszystkie kontrolki mutujące są za `projects.manage`;
bez uprawnienia zostaje sam odczyt z linkami. Interfejs w całości po polsku.

**Zaostrzenie bezpieczeństwa (poza literalnym brzmieniem zadania).** Zadanie
wymagało jedynie „URL non-empty”. Ponieważ po etapach 209–211 projekty są danymi
chmurowymi współdzielonymi w organizacji, adres wpisany przez jednego
użytkownika renderuje się jako klikalny `href` u innych — samo „niepuste”
dopuszczałoby przechowywany XSS przez `javascript:`. Schemat ograniczono do
`http/https`, decyzja podejmowana po **sparsowanym** `URL.protocol`
(`new URL()` w try/catch, bez regexów), egzekwowana na trzech granicach:
walidacja reduktora, repair w storage i renderowanie (adres odrzucony pokazuje
się jako nieklikalny `<span>` z dopiskiem „(niedozwolony adres)”, co chroni
także rekordy już zapisane w chmurze). Adres bez schematu jest dopuszczony
i normalizowany przez dopisanie `https://`, przy czym prefiksowanie biegnie
wyłącznie wtedy, gdy pierwsze parsowanie zawiodło.

## Zmiany

30 plików zmienionych, 4 nowe (`src/utils/projectDocuments.ts`,
`src/store/projectDocuments.test.ts`,
`supabase/migrations/20260721010000_project_documents.sql`, ten raport);
504 wstawienia, 7 usunięć. Do 16 plików testowych dopisano `documents: []`
w fixture'ach projektu — zmiany czysto mechaniczne, bez modyfikacji asercji
(zweryfikowane w review na diffie).

Wiki: zaktualizowano `openwiki/n2hub/cloud-database.md` (nowa kolumna jsonb,
brak nowych polityk RLS) oraz `openwiki/n2hub/state-and-persistence.md` (nowe
pole persystowane, akcje reduktora, repair, reguła schematu adresu). Druga
strona była w zadeklarowanym kontekście zadania i po tej zmianie byłaby
niekompletna. **Decyzja review: `wiki updated`.**

## Weryfikacja

- Focused `npx vitest run src/store/projectDocuments.test.ts`: **24/24 PASS**
  (reducer add/edit/remove, pusty i niedozwolony adres z zachowaniem referencji
  stanu, repair danych legacy, round-trip mirror → snapshot, bramka renderowania,
  warianty `javascript:` / `JavaScript:` / z wiodącą spacją / `data:` / `file:` /
  `mailto:` oraz normalizacja adresu bez schematu).
- Pełny `npx vitest run`: **1068/1068 PASS, 40 plików**.
- `npm run build` (tsc --noEmit + vite build): **czysto, 0 błędów**.
- Review (osobny proces read-only, weryfikacja na kodzie i diffie, nie tylko na
  raporcie): **APPROVED-WITH-NITS, brak blokerów**. Codex nie był wymagany ani
  wnioskowany — diff mieści się w całości w zadeklarowanym kontekście.

Uwaga do liczb: podany w prompcie baseline „933+new” jest nieaktualny.
Zweryfikowany baseline gałęzi to 1044; 1044 + 24 = 1068.

## Ryzyka / rzeczy do sprawdzenia

- **Brak walidacji kształtu pojedynczego wiersza na ścieżce chmurowej**
  (`src/supabase/plannerData.ts`): sprawdzane jest `Array.isArray`, ale wpisy
  jsonb są rzutowane bez kontroli typu pól. Wpis z `url` innym niż string
  wywróciłby render. Osiągalne wyłącznie ręczną edycją SQL — CHECK wymusza tylko
  tablicę. Świadomie spójne z istniejącym traktowaniem `tasks.checklist`
  (też bez walidacji per-wiersz), więc nie blokuje; do rozważenia później guard
  `typeof d.url === 'string'` w mapperze snapshotu.
- **Adres bez schematu z portem** (`localhost:3000`, `example.test:8080/x`) jest
  odrzucany zamiast dostać prefiks `https://` — parser traktuje host jako
  schemat. Kierunek bezpieczny (fail-closed), zgrzyt czysto UX-owy.
- **Treść komunikatu walidacji** („Podaj poprawny adres dokumentu (http:// lub
  https://)”) sugeruje wymagany schemat, choć adres bez schematu jest
  akceptowany i normalizowany — drobna nieścisłość.
- **Bramka renderowania jest testowana jako funkcja czysta, nie przez DOM** —
  repo nie ma harnessu renderującego (brak `@testing-library`, środowisko
  vitest to `node`), a `ProjectDetailPage` deleguje decyzję „`href` czy sam
  tekst” dokładnie do tej funkcji. Asercja na wyrenderowanym DOM wymagałaby
  dołożenia zależności testowej — nie zrobiono tego samowolnie.
- Zakres utrzymany: bez uploadu plików, bez Supabase Storage, bez integracji
  zewnętrznych.

## Podpis schedulera

- Run: `20260721-004434-234-project-documents-and-links`
- Prompt: `234-project-documents-and-links.md`
- Gałąź review: `review-integration`
- Baza: `88d6a98b84035bd1971e017f9dc322e8d0bcccc1`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `88d6a98b84035bd1971e017f9dc322e8d0bcccc1`
- Gałąź review: `review-integration`
- Run: `20260721-004434-234-project-documents-and-links`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/cloud-database.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/pages/ProjectDetailPage.tsx`
- `src/pages/kanbanBoard.test.ts`
- `src/store/AppStore.tsx`
- `src/store/activityAttribution.test.ts`
- `src/store/blockActions.test.ts`
- `src/store/cloudMerge.test.ts`
- `src/store/commandValidation.test.ts`
- `src/store/commandValidation.ts`
- `src/store/dateGuards.test.ts`
- `src/store/exportDryRun.test.ts`
- `src/store/saveTaskWorkload.test.ts`
- `src/store/seed.ts`
- `src/store/selectors.test.ts`
- `src/store/statusActions.test.ts`
- `src/store/storage.test.ts`
- `src/store/storage.ts`
- `src/store/taskMeta.test.ts`
- `src/store/taskOrder.test.ts`
- `src/styles.css`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `src/supabase/dataImport.test.ts`
- `src/supabase/dataImport.ts`
- `src/supabase/migrationStatus.test.ts`
- `src/supabase/migrations.test.ts`
- `src/supabase/plannerData.ts`
- `src/types.ts`
- `handoffs/scheduler-reviews/20260721-004434-234-project-documents-and-links.md`
- `src/store/projectDocuments.test.ts`
- `src/utils/projectDocuments.ts`
- `supabase/migrations/20260721010000_project_documents.sql`
