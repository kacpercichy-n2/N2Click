# Claude scheduler

Prosty lokalny scheduler do odpalania kolejki promptow przez Claude Code CLI na osobnej galezi review.

## 1. Dodaj prompty

Utworz pliki w:

```bash
automation/claude-scheduler/prompts/
```

Nazwij je w kolejnosci wykonania:

```text
001.md
002.md
003.md
```

Kazdy plik to jeden prompt dla Claude'a.

Wykonane prompty przenos do:

```text
automation/claude-scheduler/archive/completed/
```

Scheduler czyta tylko pliki `.md` bezposrednio z `prompts/`. Lokalny
`state/completed.json` jest dodatkowym checkpointem, ale jest ignorowany przez
Git i nie moze byc jedynym zabezpieczeniem przed ponownym wykonaniem promptu.

## 2. Uruchom kolejke

Z katalogu repo:

```bash
caffeinate -dimsu node automation/claude-scheduler/run-queue.mjs
```

Domyslny harmonogram:

```text
16:00, 21:01, 02:02, 07:03, 12:04
```

Skrypt:

- przelacza sie na galaz `review/claude-auto-YYYYMMDD-HHMM`,
- odpala kolejny prompt w najblizszym slocie czasowym,
- po kazdym przebiegu uruchamia `npm test` i `npm run build`,
- commituje zmiany na galezi review,
- zapisuje lokalne logi w `automation/claude-scheduler/logs/`,
- zapisuje stan wykonanych promptow w `automation/claude-scheduler/state/`.

Prompt jest oznaczany jako wykonany i commitowany dopiero po zielonym przebiegu
Claude'a oraz wszystkich komend weryfikacyjnych. Gdy run zawiedzie, scheduler
zatrzymuje kolejke i pozostawia niecommitowane zmiany do odzyskania — nie tworzy
commita `auto-failed`, ktory moglby zanieczyscic kolejna probe.

Przed startem i ponownie tuz przed kazdym promptem scheduler sprawdza, czy nadal
jest na swojej galezi review oraz czy ta galaz zawiera aktualny lokalny `main`.
Jesli ktos przelaczy galaz podczas oczekiwania albo `main` pojdzie do przodu,
kolejka zatrzyma sie zamiast uruchomic prompt na starej bazie lub na `main`.

Logi i stan sa ignorowane przez Git.

## 3. Zmiana godzin

```bash
CLAUDE_AUTO_TIMES="16:00,21:01,02:02,07:03,12:04" caffeinate -dimsu node automation/claude-scheduler/run-queue.mjs
```

## 4. Tryb testowy bez odpalania Claude'a

```bash
CLAUDE_AUTO_DRY_RUN=1 node automation/claude-scheduler/run-queue.mjs
```

Dry run nie przelacza galezi, nie commituje zmian i nie oznacza promptow jako
wykonane. Wyswietla aktywna kolejke i przechodzi przez harmonogram bez czekania.

## 5. Przyspieszanie kolejki

Domyslnie scheduler czeka na kolejne stale sloty. Jesli prompt skonczy sie
wczesniej i chcesz sprawdzac kolejke np. co godzine, ustaw:

```bash
CLAUDE_AUTO_EARLY_CHECK_MINUTES=60 caffeinate -dimsu node automation/claude-scheduler/run-queue.mjs
```

Po udanym prompcie nastepny prompt wystartuje wczesniej z dwoch terminow:
`zakonczenie + 60 minut` albo kolejny staly slot z harmonogramu.

## 6. Limity uzycia i metryki

Jesli lokalny helper `~/.claude/fetch-claude-usage.swift` jest dostepny,
scheduler zapisuje przed/po kazdym runie obserwacyjny procent wykorzystania,
czas, rozmiar promptu i kody wyjscia do
`automation/claude-scheduler/state/run-metrics.jsonl`. To nie sa dokladne
tokeny modelu, ale pozwala porownywac runy bez blokowania kolejki.

Domyslnie pozostaly procent wykorzystania **nie opoznia** kolejnego slotu.
Jesli swiadomie chcesz czekac na reset, wlacz bramke:

```bash
CLAUDE_AUTO_USAGE_GATE=1 caffeinate -dimsu node automation/claude-scheduler/run-queue.mjs
```

## 7. Po powrocie

Sprawdz, co powstalo:

```bash
git log --oneline main..review/claude-auto-YYYYMMDD-HHMM
git diff --stat main...review/claude-auto-YYYYMMDD-HHMM
git diff main...review/claude-auto-YYYYMMDD-HHMM
npm test
npm run build
```

Jesli chcesz wyslac galaz do remote:

```bash
git push -u origin review/claude-auto-YYYYMMDD-HHMM
```

## 8. Gdy Claude blokuje sie na uprawnieniach

Domyslnie skrypt przekazuje Claude'owi szeroki zestaw dozwolonych narzedzi. Jesli lokalna konfiguracja mimo tego wymaga potwierdzen, najpierw zrob krotki test na jednym prostym prompcie. Awaryjnie mozna wlaczyc:

```bash
CLAUDE_AUTO_SKIP_PERMISSIONS=1 caffeinate -dimsu node automation/claude-scheduler/run-queue.mjs
```

To uzywa `--dangerously-skip-permissions`, wiec stosuj tylko wtedy, gdy akceptujesz ryzyko pracy bez pytan o zgody.
