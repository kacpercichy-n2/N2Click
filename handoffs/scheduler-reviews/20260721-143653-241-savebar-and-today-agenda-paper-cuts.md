# Raport workflow: 20260721-143653-241-savebar-and-today-agenda-paper-cuts

## Wykonane

Oba zgłoszone błędy były nadal obecne w bieżącym buildzie — naprawione oba, chirurgicznie:

1. **Sticky pasek „Zapisz” prześwitywał (Kacper).** Przyczyna: `.editor-actions-sticky`
   miało `background: var(--card-bg)`, a `--card-bg` to `rgba(255,255,255,0.04)` —
   niemal przezroczysty token, przez który przebijała przewijana treść. Utwardzono tło
   lokalnie w `src/styles.css` na solidny `var(--n2-panel)` (#202024 — ten sam kolor co
   karta modala `.task-modal-card`) plus subtelny cień u góry paska
   (`box-shadow: 0 -10px 18px -14px`) dla wizualnego oddzielenia. Token `--card-bg` nie
   był zmieniany globalnie; zero zmian w logice zapisu. Klasa jest współdzielona z
   `ProjectDetailPage` — tam efekt jest ten sam (solidne tło zamiast prześwitu).

2. **„Moja praca” / karta „Dzisiaj” pokazywała zadania z innych dni (Kamil).**
   Przyczyna potwierdzona w `todayAgendaForPerson` (`src/store/selectors.ts`): gałąź
   `dateless` przepuszczała każde zadanie, którego zakres `startDate <= date <= endDate`
   obejmował dziś — wielodniowe zadanie bez bloku w kalendarzu lądowało w agendzie
   każdego dnia trwania. Zawężono warunek do `t.endDate === date` („dziś” = deadline
   przypada dzisiaj); sortowanie dateless uproszczone do samego tytułu (endDate jest
   teraz stały), docstring zaktualizowany. Gałąź `timed` (`w.date === date`) nietknięta.
   Sprawdzono `todayStr()` w `src/utils/dates.ts` — używa date-fns `format(new Date())`,
   czyli strefy lokalnej (brak pułapki `toISOString`/UTC); bez zmian.

Dostosowano istniejące testy do nowej semantyki (3 przypadki w `selectors.test.ts`
+ 1 data zapytania w `draftTasks.test.ts`) i dodano nowy test regresyjny:
zadanie wielodniowe 06–10.07 bez bloków nie pojawia się w dateless w dniach
06/07/08/09.07 ani 11.07, a pojawia się wyłącznie 10.07 (dzień terminu).

Wiki: bez zmian — jedyna wzmianka o `todayAgendaForPerson` w
`openwiki/n2hub/state-and-persistence.md` dotyczy wykluczania szkiców i pozostaje
aktualna (filtr `isPublishedTask` nie był ruszany).

## Zmiany

- `src/styles.css` — solidne tło + cień separujący na `.editor-actions-sticky`.
- `src/store/selectors.ts` — `todayAgendaForPerson`: dateless tylko dla
  `endDate === date`; sort po tytule; docstring.
- `src/store/selectors.test.ts` — aktualizacja 3 testów dateless do nowej semantyki
  + nowy test regresyjny zadania wielodniowego.
- `src/store/draftTasks.test.ts` — zapytanie agendy przesunięte na dzień terminu.

## Weryfikacja

- Focused vitest `selectors.test.ts` + `draftTasks.test.ts`: **115 passed, 0 failed**.
- `npm test`: **42 pliki, 1143 testy — wszystkie zielone**.
- `npm run build`: **zielony** (standardowe ostrzeżenie o chunku >500 kB, bez zmian).

## Ryzyka / rzeczy do sprawdzenia

- Zmiana semantyki dateless jest celowo zawężająca: zadanie wielodniowe bez bloków
  pokaże się w „Dzisiaj” dopiero w dniu deadline'u (nie w dniu startu ani w środku
  zakresu). Zadania w toku bez bloków nadal widać w sekcjach „niezaplanowane” /
  „po terminie” — jeśli zespół oczekuje też sygnału „startuje dziś”, to osobna,
  świadoma decyzja produktowa.
- Meta wiersza dateless („do {data}”) pokazuje teraz zawsze dzisiejszą datę —
  poprawne, choć redundantne; zostawione bez zmian (chirurgiczność).
- Solidne tło paska dotyczy też karty projektu (`ProjectDetailPage`) — wizualnie
  spójne z resztą paneli, sprawdzone tylko statycznie (bez przejścia browser-check;
  zmiana czysto CSS-owa, bez wpływu na ścieżki pointer/drag).

## Podpis schedulera

- Run: `20260721-143653-241-savebar-and-today-agenda-paper-cuts`
- Prompt: `241-savebar-and-today-agenda-paper-cuts.md`
- Gałąź review: `review-integration`
- Baza: `642b7b22baa1a91a3e0ffc8e655b620480a64ce5`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `642b7b22baa1a91a3e0ffc8e655b620480a64ce5`
- Gałąź review: `review-integration`
- Run: `20260721-143653-241-savebar-and-today-agenda-paper-cuts`

### Pliki zgłoszone do review

- `src/store/draftTasks.test.ts`
- `src/store/selectors.test.ts`
- `src/store/selectors.ts`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260721-143653-241-savebar-and-today-agenda-paper-cuts.md`
