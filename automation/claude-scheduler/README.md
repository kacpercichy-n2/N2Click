# Claude scheduler

Lokalna, unattended kolejka Claude Code uruchamiana na osobnej gałęzi review.

## Prompt contract

Aktywne pliki `.md` leżą bezpośrednio w `prompts/` i są wykonywane
leksykograficznie. Każdy prompt musi zawierać niepuste sekcje:

```markdown
## Risk and routing
- Risk: low | medium | high
- Route: developer → reviewer
- Codex review: required | conditional | skip — <reason>

## Wiki context
- `openwiki/n2hub/<area>.md`

## Expected touchpoints
- `src/existing-file.ts`

## Invariants
## Scope
## Out of scope
## Acceptance
## Verification
```

Scheduler sprawdza istnienie stron wiki i touchpointów. `high` wymaga Codex
review; brak CLI blokuje run zamiast obniżać review. Jeden prompt obejmuje jeden
spójny rezultat techniczny. Gotowy pojedynczy boundary nie potrzebuje
dodatkowego handoffu architekta.

Przy `required` proces implementacyjny Claude kończy pracę przed review.
Scheduler sam uruchamia `bash scripts/codex-review.sh --run-id <runId>`, a potem
startuje osobny proces Fable w `safe-mode` z reviewer promptem załadowanym do
pamięci przed workerem. Przed użyciem wrappera sprawdza hash jego i bezpośrednich
zależności; ich zmiana w aktywnym runie blokuje gate. Codex nie jest dostępny w
uprawnieniach workerów. Scheduler sprawdza run ID oraz hash diffu i nie dopuści
zmian w kodzie po review.

Przy `conditional` reviewer może raz zwrócić maszynowo przechwycony
`codex-requested`. Scheduler uruchamia wtedy wrapper i wywołuje reviewer drugi
raz z artefaktem oraz zapisanym powodem eskalacji. Żaden agent nie może zmienić
tego stanu na skip.

Touchpoint wskazuje plik lub kontrolowany glob plików, nie cały katalog. Nowy
plik deklaruj jako `` `new: path/to/file` ``; jego katalog nadrzędny musi istnieć.

## Uruchomienie

```bash
caffeinate -dimsu node automation/claude-scheduler/run-queue.mjs
```

Domyślne sloty: `16:00, 21:01, 02:02, 07:03, 12:04`. Jednorazowy zestaw:

```bash
CLAUDE_AUTO_TIMES="20:39" caffeinate -dimsu node automation/claude-scheduler/run-queue.mjs
```

Po zielonym przebiegu scheduler:

1. uruchamia raz `npm run test:scheduler`, `npm test` i `npm run build`,
   zatrzymując się na pierwszym błędzie;
2. przenosi prompt do `archive/completed/`;
3. commituje kod, handoff i ruch promptu na gałęzi review;
4. zapisuje lokalny checkpoint i metryki.

Agent nie commituje ani nie pushuje. Push jest osobną decyzją operatora po
obejrzeniu wyniku. Błąd Claude, wymaganego review lub weryfikacji pozostawia
zmiany niecommitowane, zapisuje bieżący `RUN-RESULT.json` jako `blocked` i
zatrzymuje kolejkę; poprzednie approval jest unieważniane na starcie runu.

Przed finalnymi testami scheduler wymaga świeżego `handoffs/RUN-RESULT.json`
z bieżącym `runId`, werdyktem `approve` i polem `codexReview.requested`. Gdy
conditional reviewer zażąda Codex, `requested: true` wymaga świeżego
hash-bound artefaktu i nie może zostać zapisane jako skip. Przy `required` świeży
artefakt i odpowiadające mu metadane Codex review są obowiązkowe. Hash
kanonicznego diffu musi nadal się
zgadzać; każda późniejsza zmiana kodu zamyka gate. Tekstowa deklaracja sukcesu
nie otwiera gate.

## Verification ownership

- Worker: focused tests/checks podczas iteracji.
- Reviewer: sprawdzenie sensu testów i focused evidence, bez ponownego full suite.
- Scheduler: jeden finalny `npm run test:scheduler && npm test && npm run build`.
- Browser: tylko skrypt i silniki zadeklarowane w prompcie; pełna macierz wyłącznie w release bundle.

`npm run build` już zawiera `tsc --noEmit`, więc prompt nie powinien żądać
osobnego pełnego typechecku.

## Dry run i test kontraktu

```bash
npm run test:scheduler
CLAUDE_AUTO_DRY_RUN=1 CLAUDE_AUTO_CONTINUE_ON_ERROR=1 \
  node automation/claude-scheduler/run-queue.mjs
```

Dry run waliduje aktywną kolejkę i harmonogram, ale nie uruchamia Claude, testów,
commita ani archiwizacji.

Po aktualizacji Claude Code można tanio sprawdzić matcher uprawnień bez
wykonywania właściwego review:

```bash
npm run check:scheduler-permissions
```

Checker używa `project`-only settings i `dontAsk`, potwierdza jedno dozwolone
`pwd`, a następnie celowo jednocześnie allow+deny dla `codex exec --help` i
sprawdza skorelowane odrzucenie. Ogólne `npm`, `npx`, `node`, `find` i shellowe
`rg` nie są dozwolone; lista obejmuje tylko focused Vitest, typecheck i nazwane
lokalne skrypty weryfikacyjne. Właściwy Codex działa poza procesem Claude.
Proces implementacyjny dostaje shimy blokujące przypadkowe `codex`/`claude`,
pusty `CODEX_HOME`, pusty klucz OpenAI i offline npx, bez usuwania współdzielonego
katalogu narzędzi z `PATH`. Jest to ochrona operacyjna przed niezamierzonym
zużyciem, nie sandbox bezpieczeństwa dla złośliwego kodu testowego. Reviewer nie ma Bash; czyta
kanoniczny diff zapisany przez scheduler, a hash jest sprawdzany po jego wyjściu.
Reviewer dostaje również jawne `--tools Read,Glob,Grep,LS` i deny Bash/Write/Edit.
Ten smoke test jest lokalny i nie należy do CI, aby CI nie wymagało Claude,
Codex ani płatnego API.

## Branch safety

Przed startem worktree musi być czysty. Scheduler tworzy
`review/claude-auto-YYYYMMDD-HHMM`, a przed każdym promptem sprawdza aktualną
gałąź i to, czy zawiera lokalny `main`. Nie merguje, nie rebase'uje i nie pushuje.

## Completion and recovery

Źródłem prawdy są wyłącznie pliki: aktywne w `prompts/`, wykonane w
`archive/completed/`. Ignorowany `state/completed.json` jest tylko lokalną
telemetrią i nigdy nie pomija aktywnego pliku; niespójność generuje ostrzeżenie.
Nieudany prompt nie jest przenoszony ani oznaczany jako ukończony.

Logi i metryki znajdują się w ignorowanych `logs/` i `state/`. Metryki obejmują
rozmiar promptu, czas, risk/route/Codex policy, kody weryfikacji i opcjonalny
snapshot wykorzystania. Nie są dokładnym licznikiem tokenów.

Scheduler trzyma atomowy `state/scheduler.lock` przez cały harmonogram. Drugi
proces kończy się przed uruchomieniem modelu. Martwy lock nie jest odzyskiwany
automatycznie, bo wynik ostatniego model call może być nieznany; operator najpierw
sprawdza procesy/log, a dopiero potem usuwa plik locka.
Claude, Codex, reviewer i komendy weryfikacji działają w śledzonych process
groups. SIGINT/SIGTERM najpierw kończy i potwierdza grupę; bez potwierdzenia lock
pozostaje. Approval jest zapisywane dopiero po final gate, a błąd archiwizacji
lub commita nadpisuje wynik na `blocked`.

Każda długa faza ma też fail-closed timeout: worker 120 min, Codex 45 min,
reviewer 30 min, pojedyncza komenda weryfikacji 60 min. Można je zmienić przez
`CLAUDE_AUTO_WORKER_TIMEOUT_MINUTES`, `CLAUDE_AUTO_CODEX_TIMEOUT_MINUTES`,
`CLAUDE_AUTO_REVIEWER_TIMEOUT_MINUTES` i `CLAUDE_AUTO_VERIFY_TIMEOUT_MINUTES`.
Timeout kończy całą grupę procesu i blokuje run; nie przechodzi do kolejnej fazy.

## Opcje

```bash
CLAUDE_AUTO_EARLY_CHECK_MINUTES=60 ...
CLAUDE_AUTO_USAGE_GATE=0 ...
CLAUDE_AUTO_VERIFY="npm run test:scheduler && npm test && npm run build" ...
```

Kontrola użycia jest domyślnie włączona: przed każdym promptem scheduler odczytuje
limit i uruchamia go tylko przy wykorzystaniu `≤ 50%`. Powyżej tego progu czeka
60 sekund po czasie resetu. Brak poprawnego odczytu albo czasu resetu zatrzymuje
kolejkę zamiast ryzykować kolejny run. `CLAUDE_AUTO_USAGE_GATE=0` służy wyłącznie
do świadomego wyłączenia tej ochrony. Standardowe sloty pozostają jedynym
harmonogramem; `CLAUDE_AUTO_EARLY_CHECK_MINUTES` jest opcjonalnym trybem
przyspieszenia między udanymi promptami.

Werdykt review `changes-required` nie kończy kolejki: scheduler zachowuje diff,
przekazuje konkretne blokery do następnej próby tego samego promptu i ponawia ją
po minucie (`CLAUDE_AUTO_RETRY_DELAY_MINUTES`), zawsze po ponownym sprawdzeniu
progu użycia. Błędy techniczne bez poprawnego werdyktu review nadal zatrzymują
run, bo scheduler nie ma wtedy wiarygodnych instrukcji naprawy.

Gdy prompt wymaga scenariusza browserowego, worker wykonuje go przez Playwright
MCP — nie przez skrypty `node scripts/browser-check-*.mjs`. Worker uruchamia
własny Vite dla bieżącego drzewa na `127.0.0.1:5174`, najpierw potwierdza tytuł
`N2Hub Planer`, a po scenariuszu go kończy; sam MCP prowadzi nawigację,
interakcje i asercje. Wynik scenariusza MCP worker zapisuje w `focusedChecks`.
Projektowa konfiguracja `.mcp.json` udostępnia serwer `playwright`, a allowlista obejmuje jego narzędzia jako
`mcp__playwright__*`. Skrypty browserowe pozostają deterministyczną regresją
release/CI, lecz scheduler nie uruchamia ich w fazie workera.

`CLAUDE_AUTO_SKIP_PERMISSIONS=1` włącza niebezpieczne pomijanie pytań o zgody;
używaj wyłącznie jako świadomej decyzji operatora.

Po runie sprawdź lokalnie:

```bash
git log --oneline main..review/claude-auto-YYYYMMDD-HHMM
git diff --stat main...review/claude-auto-YYYYMMDD-HHMM
git diff main...review/claude-auto-YYYYMMDD-HHMM
```
