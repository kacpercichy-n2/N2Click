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

Logi i stan sa ignorowane przez Git.

## 3. Zmiana godzin

```bash
CLAUDE_AUTO_TIMES="16:00,21:01,02:02,07:03,12:04" caffeinate -dimsu node automation/claude-scheduler/run-queue.mjs
```

## 4. Tryb testowy bez odpalania Claude'a

```bash
CLAUDE_AUTO_DRY_RUN=1 node automation/claude-scheduler/run-queue.mjs
```

## 5. Po powrocie

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

## 6. Gdy Claude blokuje sie na uprawnieniach

Domyslnie skrypt przekazuje Claude'owi szeroki zestaw dozwolonych narzedzi. Jesli lokalna konfiguracja mimo tego wymaga potwierdzen, najpierw zrob krotki test na jednym prostym prompcie. Awaryjnie mozna wlaczyc:

```bash
CLAUDE_AUTO_SKIP_PERMISSIONS=1 caffeinate -dimsu node automation/claude-scheduler/run-queue.mjs
```

To uzywa `--dangerously-skip-permissions`, wiec stosuj tylko wtedy, gdy akceptujesz ryzyko pracy bez pytan o zgody.
