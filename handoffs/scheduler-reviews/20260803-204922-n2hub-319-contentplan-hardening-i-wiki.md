# Raport workflow: 20260803-204922-n2hub-319-contentplan-hardening-i-wiki

## Wykonane

Faza R9 modułu Content Plan (hardening, domknięcie testów, wiki). Routing tier:
test-writer -> reviewer (praca weryfikacyjno-mechaniczna; implementacja faz
311-318 była już kompletna w worktree - wszystkie fazy obecne, żadnej nie
brakuje).

Analiza wstępna wykazała, że wymagane pokrycie testowe JUŻ ISTNIEJE z faz
312-318, więc zgodnie z poleceniem ("if not, skip") nie dopisano duplikatów:

- gate `canViewContentPlan`: `src/pages/contentPlanScope.test.ts` (administrator
  TAK / manager i worker NIE / niezalogowany NIE / tryb lokalny pelne->admin,
  ograniczone->worker / grant modułu na razie ignorowany / fallbacki
  loading-error-brak profilu);
- sanitizery storage: `src/store/contentPlanStorage.test.ts` (uszkodzony slice
  contentplan nie wywraca całego payloadu, odrzucanie uszkodzonych wierszy bez
  kaskady, zdejmowanie base64, idempotencja, brak echo-write);
- walidacja publikacji miesiąca: `src/store/contentPlanActions.test.ts`
  (atomowość: jedna niekompletna publikacja blokuje cały miesiąc) +
  `src/components/contentPlanPostEditor.test.ts` (walidacja -> pola formularza);
- mapowanie statusów importu TWS: `src/contentplan/twsSeedImport.test.ts`
  (pełna mapa 7 statusów, merge "najmniej zaawansowany", nieznane statusy nie
  wywracają importu, integralność słowników z danych źródłowych).

Selektywny port testów defects ze źródła
`.../Content plan/tests/defects/security-and-integrity.test.tsx` - mapa 8
case'ów: 4 przeportowane (invalid localStorage, quota - generycznie w
`storage.test.ts`, slug PL + kolizja slugów marki, atomowa publikacja
miesiąca), 4 zasadnie N/A dla architektury N2Hub (mock-login - gate zamiast
formularza; widok klienta readonly - portal klienta świadomie poza zakresem,
plan §6; kolizja Math.random - moduł używa `crypto.randomUUID`; `readAssetFile`
- moduł nie trzyma plików, media to referencje Google Drive). Werdykty N/A
zweryfikowane niezależnie przez reviewera względem kodu.

Samo-review względem planu (`handoffs/content-plan-module-plan.md`), punkt po
punkcie, wszystko PASS bez działań naprawczych:

- brak Mantine w bundlu: 0 wystąpień w `package.json`, `package-lock.json`
  i importach `src/` (wzmianki tylko w komentarzach "zero Mantine");
- brak nowych bibliotek: `package.json` bajtowo identyczny ze stanem sprzed
  fazy 311 (git diff pusty);
- RLS: 6 tabel w `20260803160000_contentplan_schema_and_tables.sql`, 6x
  `enable row level security` tamże, polityki dla wszystkich 6 tabel w
  `20260803160100_contentplan_rls_policies.sql`;
- brak base64 w store: grep po `src/store` i `src/contentplan` - wyłącznie
  komentarze i testy (repair wręcz zdejmuje zaszłościowy base64, jest test);
- stringi po polsku bez em/en-dash: skan unicode wszystkich plików modułu -
  0 trafień w literałach user-facing (jedyne trafienie to komentarz kodu);
- wiersz modułu w dry-runie eksportu obecny (`src/store/exportDryRun.ts`,
  `entity: 'Content Plan (schemat contentplan)'`);
- brak regresji kalendarza/planera i inwarianty CLAUDE.md: potwierdzone pełną
  zieloną suitą.

Wiki: **wiki unchanged** dla obu wskazanych stron, z weryfikacją punktową
względem kodu (nie tylko deklaratywnie):

- `ui-navigation-and-onboarding.md` - sekcja `/content-plan` aktualna (trasa,
  ikona `CalendarRange`, `useContentPlanAccess` w 4 punktach wpięcia,
  `CONTENT_PLAN_ROLES`, scope'y dirty `contentplan-post-modal`/`-brand-modal`);
- `cloud-database.md` - sekcja schematu contentplan aktualna (migracje
  160000-160300 + seed TWS, widok `my_access`, konwencja `core.app_access`
  dla modułów, adapter `client.schema('contentplan')` bez drugiego
  `createClient`, routing opsów po `CloudOp.schema`, świadome pominięcie
  Realtime);
- `testing-and-automation.md` - bez wzmianki: strona opisuje warstwy
  weryfikacji i browser checki, nie listuje testów jednostkowych per moduł.

Faza R9 nie zmieniła żadnej granicy modułu, stąd brak edycji wiki jest
werdyktem, nie zaniechaniem.

## Zmiany

- `handoffs/RUN-STATE.md` - dopisany wpis wynikowy fazy R9 (8 linii).
- Poza tym brak zmian w plikach śledzonych przez Git: pokrycie testowe,
  produkcja i wiki nie wymagały korekt.

## Weryfikacja

- `npm test`: 119 plików testowych, 2663 testy, wszystkie zielone.
- `npm run build`: zielony (exit 0).
- Reviewer (read-only, tier): **VERDICT: approved**, zero blockerów; wyrywkowo
  potwierdził komplet wariantów gate'a, test przeżycia payloadu, mapę statusów
  TWS, zasadność 4 werdyktów N/A portu defects, czystość diffu i oba werdykty
  "wiki unchanged".
- Gate (`npm test && npm run build`): oczekuje na scheduler.

## Ryzyka / rzeczy do sprawdzenia

- Werdykt R9 zatwierdza stan po fazach 311-318 (faza czysto weryfikacyjna,
  bez nowego kodu produkcyjnego) - to zamierzone dla promptu domykającego.
- Pozostałe RĘCZNE kroki operatora (poza zasięgiem agenta, żadnych operacji na
  żywej bazie nie wykonano):
  1. aplikacja migracji contentplan z faz 311 i 316 (schema+tabele, RLS,
     my_access, seed app_access, seed TWS) - wg konwencji: MCP apply_migration
     za zgodą, zapasowo dashboard;
  2. dodanie schematu `contentplan` do Exposed schemas w dashboardzie Supabase
     (Integrations -> Data API -> Settings) - bez tego PostgREST zwraca 406;
  3. originy aplikacji w Google Cloud Console dla klienta OAuth (GIS token
     flow importu/podglądu Dysku);
  4. decyzja o zawężeniu ról (faza R10) - osobny, wstrzymany prompt; do tego
     czasu moduł widzą wyłącznie administratorzy wg `CONTENT_PLAN_ROLES`.

## Podpis schedulera

- Run: `20260803-204922-n2hub-319-contentplan-hardening-i-wiki`
- Prompt: `319-contentplan-hardening-i-wiki.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `09e08537b0f93d94efc5e5a374b45b3833d715cc`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `09e08537b0f93d94efc5e5a374b45b3833d715cc`
- Gałąź review: `review-integration`
- Run: `20260803-204922-n2hub-319-contentplan-hardening-i-wiki`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `handoffs/scheduler-reviews/20260803-204922-n2hub-319-contentplan-hardening-i-wiki.md`
