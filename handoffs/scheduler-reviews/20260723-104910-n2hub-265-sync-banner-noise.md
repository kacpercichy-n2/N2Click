# Raport workflow: 20260723-104910-n2hub-265-sync-banner-noise

## Wykonane

### Diagnoza — który baner i dlaczego cyklicznie

Baner, który widzi użytkownik, to niebieski (info) **stale-hint**
`STALE_HINT_MSG = "Dane mogą być nieaktualne — odśwież dane z serwera."`
(`src/supabase/cloudMirror.ts:42`, renderowany w `CloudSyncBanner.tsx`,
warunek `status === 'ready' && pendingCount === 0`, tuż po `live` → `null`).
Nie ma dosłownego stringu „dane zostały odświeżone” — to parafraza użytkownika.

Opis kodu w promptcie był nieaktualny: gałąź integracyjna zawiera już commit
`9893b67` (231-seamless-live-sync-refresh), który **usunął** bramkę
`useSustained(status==='ready' && !live, STALE_GRACE_MS=30_000)`. W bieżącym
buildzie baner stale-hint pojawia się więc **natychmiast**, ilekroć
`status === 'ready' && !live && pendingCount === 0`. Problem jest nadal obecny
(a bez grace nawet ostrzejszy): flaga `live` jest ustawiana wprost z
`channel.subscribe((s) => setLive(s === 'SUBSCRIBED'))`. Zwrotka `subscribe`
Realtime woła się na KAŻDYM przejściu socketu — przy heartbeacie / re-joinie
publikacji (rząd ~30 s) kanał potrafi zrobić flap `SUBSCRIBED → CHANNEL_ERROR/
TIMED_OUT → SUBSCRIBED`. Każdy taki przejściowy drop natychmiast zbijał `live`
na false → baner odsłaniał się cyklicznie, mimo że live realnie działał.
Efekt subskrypcji ma zależności `[active, userId]` (stabilne przy cichym
syncu — `refreshSilently` nie zrzuca org do `loading`), więc źródłem migotania
NIE jest planowy resubscribe, tylko brak histerezy na zwrotce statusu.

### Fix u źródła (raportowanie `live`)

- Nowy, czysty moduł `src/supabase/liveChannelTracker.ts` — histereza flagi
  `live` z wstrzykiwanym zegarem (bez Reacta, bez klienta Supabase):
  - `SUBSCRIBED` → `live=true` natychmiast (i kasuje ewentualny timer dropu);
  - utrata statusu przy żywym kanale → NIE zbija `live` od razu, planuje drop
    po `LIVE_DROP_GRACE_MS`; rejoin w oknie grace = ciągłość (zero migotania);
  - utrata przy martwym kanale (nigdy nie było `SUBSCRIBED`, np. offline od
    startu) → nic nie planuje, `live` zostaje false → fallback działa od razu;
  - `report()` woła `setLive` tylko przy faktycznej zmianie wartości.
- `CloudSyncProvider.tsx`: subskrypcja Realtime przepuszcza statusy przez
  `createLiveTracker` (`LIVE_DROP_GRACE_MS = 5_000`) zamiast `setLive(s ===
  'SUBSCRIBED')`. Cleanup efektu woła `tracker.dispose()` (kasuje timer, zbija
  `live`). `setLive` opakowany strażnikiem `mountedRef` (bez setState po
  odmontowaniu). Mechanika samego syncu/hydracji/debounce'ów bez zmian.

Efekt: udany cichy sync = zero banera; realna utrata Realtime > grace nadal
odsłania stale-hint (fallback); banery błędu zapisu / konfliktu bez zmian.

## Zmiany

- `src/supabase/liveChannelTracker.ts` — nowy: histereza flagi `live` (czysta).
- `src/supabase/liveChannelTracker.test.ts` — nowy: 8 testów (flap, trwała
  utrata > grace, powrót, brak kumulacji timerów, martwy kanał, dispose).
- `src/supabase/CloudSyncProvider.tsx` — subskrypcja Realtime używa trackera;
  stała `LIVE_DROP_GRACE_MS`.

## Weryfikacja

- `npm test`: zielony — 59 plików, 1427 testów (wcześniej 1419; +8 nowych).
- `npm run build` (`tsc --noEmit && vite build`): zielony.
- `npx vitest run src/supabase/liveChannelTracker.test.ts`: 8/8 pass.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Środowisko nie ma żywego Supabase, więc realny flap kanału nie był
  weryfikowany end-to-end — testy odtwarzają go na fałszywym zegarze. Sam
  wzorzec flapu (`SUBSCRIBED → CHANNEL_ERROR → SUBSCRIBED` co ~30 s) przyjęto
  jako udokumentowaną w promptcie przyczynę.
- `LIVE_DROP_GRACE_MS = 5 s` to kompromis: pokrywa szybki rejoin, a realna
  utrata odsłania fallback z ≤5 s opóźnieniem. Do ewentualnego dostrojenia,
  gdyby w praktyce rejoin bywał wolniejszy.
- Zakres celowo wąski: zmieniono wyłącznie raportowanie `live`; mechanika
  syncu, hydracji i debounce'ów oraz warunki renderu w `CloudSyncBanner.tsx`
  bez zmian (invariant 6 i tryb wycofania nietknięte).

## Podpis schedulera

- Run: `20260723-104910-n2hub-265-sync-banner-noise`
- Prompt: `265-sync-banner-noise.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `250a61740a0e323e3e4cd54f0732446e87436693`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `250a61740a0e323e3e4cd54f0732446e87436693`
- Gałąź review: `review-integration`
- Run: `20260723-104910-n2hub-265-sync-banner-noise`

### Pliki zgłoszone do review

- `src/supabase/CloudSyncProvider.tsx`
- `handoffs/scheduler-reviews/20260723-104910-n2hub-265-sync-banner-noise.md`
- `src/supabase/liveChannelTracker.test.ts`
- `src/supabase/liveChannelTracker.ts`
