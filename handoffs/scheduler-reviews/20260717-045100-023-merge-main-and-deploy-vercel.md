# Raport workflow: 20260717-045100-023-merge-main-and-deploy-vercel

## Wykonane

Zadanie z kolejki („merge do main i push na Vercel”) koliduje wprost z kontraktem
schedulera obowiązującym workera w tym runie: „Nie zmieniaj gałęzi, nie
rebase'uj, nie merguj i nie wykonuj `git push`” oraz „Nie wolno dostarczać do
`main` zmian bezpośrednio”. Dodatkowo jest powód sekwencyjny: po zielonym gate
scheduler dopisze commit tego runu (m.in. ten raport) na `review-integration`,
więc merge wykonany *w trakcie* runu natychmiast zostawiłby `main` w tyle i
zdesynchronizował PR. Merge musi więc wykonać operator **po** commicie tego runu.

Zamiast tego przygotowałem i zweryfikowałem pełną gotowość do wydania:

1. **Stan gałęzi**: `review-integration` jest 12 commitów przed `origin/main`
   i 0 za nim — merge będzie czystym fast-forwardem, bez konfliktów.
2. **Weryfikacja release'owa**: pełny `npm test` i `npm run build` przeszły
   lokalnie (wyniki niżej).
3. **PR do main**: istnieje PR #5 (`review-integration` → `main`),
   `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, check CI `validate` =
   SUCCESS, check `Vercel Preview Comments` = SUCCESS. Integracja Vercel–GitHub
   jest aktywna, więc merge do `main` automatycznie uruchomi deploy produkcyjny.
4. **Konfiguracja Vercel**: `vercel.json` zawiera rewrite SPA
   (`/(.*) → /index.html`) — poprawny dla React Router. Sprawdziłem wymagania
   środowiskowe: funkcje chmurowe (Supabase, etapy 200–211) wymagają zmiennych
   `VITE_SUPABASE_URL` i `VITE_SUPABASE_PUBLISHABLE_KEY` ustawionych w
   projekcie Vercel (Vite wstrzykuje je w czasie builda). Bez nich aplikacja
   działa dalej w trybie lokalnym (`isSupabaseConfigured()` zwraca `false` —
   brak crasha), ale logowanie i synchronizacja chmurowa będą niedostępne.

### Kroki dla operatora (po commicie tego runu przez scheduler)

1. Upewnij się, że commit tego runu jest na `origin/review-integration`.
2. W ustawieniach projektu Vercel (Production) ustaw `VITE_SUPABASE_URL`
   i `VITE_SUPABASE_PUBLISHABLE_KEY` (wyłącznie klucz *publishable* —
   walidacja w `src/supabase/config.ts` odrzuca klucze sekretne).
3. Zmerguj PR #5: `gh pr merge 5 --merge` (lub przez UI GitHuba).
4. Vercel zbuduje i wdroży `main` automatycznie; zweryfikuj deploy produkcyjny
   (logowanie Supabase + rewrite tras SPA).

## Zmiany

- Brak zmian w plikach śledzonych przez Git (uzupełniono wyłącznie ten raport).

## Weryfikacja

- `npm test`: **PASS** — 31 plików testowych, 901 testów, 0 błędów.
- `npm run build`: **PASS** — `tsc --noEmit` czysty, Vite zbudował produkcyjny
  bundle (ostrzeżenie o chunku > 500 kB — istniejące, nieblokujące).
- `gh pr view 5`: MERGEABLE / CLEAN, check `validate` SUCCESS.
- `git rev-list origin/main...HEAD`: 0 za, 12 przed — fast-forward bez konfliktów.

## Ryzyka / rzeczy do sprawdzenia

- Jeśli zmienne `VITE_SUPABASE_*` nie są ustawione w Vercel, produkcja wstanie
  w trybie lokalnym (bez logowania i chmury) — sprawdzić przed merge.
- W Supabase (Auth → URL Configuration) domena produkcyjna Vercel musi być
  dodana do dozwolonych adresów przekierowań, inaczej logowanie na produkcji
  może być odrzucane.
- Bundle JS ma ~975 kB (282 kB gzip) — do rozważenia code-splitting w osobnym
  zadaniu; nie blokuje wydania.

## Podpis schedulera

- Run: `20260717-045100-023-merge-main-and-deploy-vercel`
- Prompt: `023-merge-main-and-deploy-vercel.md`
- Gałąź review: `review-integration`
- Baza: `9ae79dd1c4cce759086566dc3f4b4916e737d3c0`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `9ae79dd1c4cce759086566dc3f4b4916e737d3c0`
- Gałąź review: `review-integration`
- Run: `20260717-045100-023-merge-main-and-deploy-vercel`

### Pliki zgłoszone do review

- `handoffs/scheduler-reviews/20260717-045100-023-merge-main-and-deploy-vercel.md`
