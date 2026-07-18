# Raport workflow: 20260718-024614-215-save-feedback-and-authz-logic-fixes

## Wykonane

Pięć poprawek logiki z zakresu zadania:

1. **TaskModal — fałszywe „Zapisano” przy odrzuconym zapisie.** Nowy czysty
   precheck `wouldRejectSaveTask(state, payload)` w `src/store/AppStore.tsx`
   (uruchamia reduktor bez dispatchu i sprawdza referencję stanu — inwariant 6).
   `handleSave` w `src/components/TaskModal.tsx` przy odrzuceniu (np. status /
   projekt / przypisana osoba usunięte przez scalenie z chmury lub inną kartę)
   zostawia modal otwarty z brudnym szkicem i pokazuje jawny polski błąd —
   bez rebasu snapshotu, bez `markSaved()`, bez zamknięcia.
2. **AdminPage — nazwa statusu na lokalnym szkicu.** Nowy komponent
   `StatusNameInput` + czysta decyzja commitu `commitStatusName` w
   `src/pages/statusNameDraft.ts` (wzorzec SimpleListRow): edycja pola nie
   dotyka store'u, commit na blur/Enter, pusty szkic wraca do nazwy ze store'u,
   niezmieniona nazwa nie dispatchuje. Klucz `${id}:${name}` remountuje pole po
   zewnętrznej zmianie nazwy. Koniec spamu persystencji/lustra per klawisz i
   „odskakiwania” pola przy kasowaniu do ponownego wpisania.
3. **`setStatusArchived` — strażnik liczy tylko AKTYWNE statusy ukończenia.**
   Nowy helper `isLastActiveDoneStatus` w `src/store/AppStore.tsx`; archiwizacja
   ostatniego aktywnego statusu `isDone` jest odrzucana także wtedy, gdy inny
   status `isDone` jest zarchiwizowany (wcześniej kanban mógł zostać bez kolumny
   ukończenia). Lustrzany strażnik przycisku „Archiwizuj” w `AdminPage`
   zaktualizowany razem z tooltipem; strażniki DELETE/SET_STATUS_DONE bez zmian
   (poza zakresem — patrz ryzyka).
4. **Edytor lokalnego hasła ukryty w trybie chmury.** Nowa czysta polityka
   `canEditLocalPassword(mode)` w `src/pages/profileEditPolicy.ts`;
   `PersonProfilePage` renderuje `PasswordSection` tylko w trybie lokalnym —
   w trybie supabase zapis martwego lokalnego hasha sugerował zmianę hasła
   konta, którego nie dotykał (bramkowanie jak `AvatarPhotoSection`).
5. **Lustro profili z MAPOWANYM działem.** W tym worktree nie istniał żaden
   upsert `profiles` (diff lustra kończył się na 8 rodzinach) — opisany w
   promptcie bug „wysyła lokalny departmentId dosłownie” nie miał więc kodu do
   poprawienia. Zgodnie z kontraktem zbudowałem brakujące lustro od razu
   poprawnie: `profileRow` + sekcja „1b) Profile osób” w
   `src/supabase/cloudMirror.ts` — update-only istniejących kont (mapa po
   e-mailu), wąska projekcja (imię/nazwisko/stanowisko/dział), dział rozwiązywany
   przez `maps.departments` jak w projektach (nigdy lokalne id → brak odrzucanego
   naruszenia FK przy dziale o tej samej nazwie i innym cloud id). E-mail, rola
   dostępu i awatar pozostają własnością serwera; lustro nigdy nie tworzy ani nie
   usuwa profili; zmiany pól wyłącznie lokalnych (hasło, pojemność, dni pracy)
   nie emitują operacji. `people` celowo zostaje w NON_MIRRORED_KEYS
   `persistGate` (komentarz dopisany) — pola lokalne muszą zawsze trafiać do
   localStorage.

Wiki: `openwiki/n2hub/state-and-persistence.md` zaktualizowana (granica lustra —
dochodzi wąska projekcja profili; reszta stron bez zmian).

## Zmiany

- `src/store/AppStore.tsx` — `wouldRejectSaveTask`, `isLastActiveDoneStatus`,
  poprawiony strażnik `setStatusArchived`.
- `src/components/TaskModal.tsx` — precheck odrzucenia + polski komunikat błędu.
- `src/pages/AdminPage.tsx` — `StatusNameInput` (lokalny szkic), lustrzany
  strażnik archiwizacji.
- `src/pages/statusNameDraft.ts` (nowy) — czysta decyzja commitu nazwy statusu.
- `src/pages/profileEditPolicy.ts` — `canEditLocalPassword`.
- `src/pages/PersonProfilePage.tsx` — bramkowanie `PasswordSection` trybem.
- `src/supabase/cloudMirror.ts` — `profileRow` + sekcja diff profili (dział przez
  `maps.departments`).
- `src/store/persistGate.ts` — komentarz o częściowym lustrze `people`.
- Testy: `src/store/taskSaveFeedback.test.ts` (nowy),
  `src/pages/statusNameDraft.test.ts` (nowy), `src/store/statusActions.test.ts`
  (+2 przypadki strażnika archiwizacji), `src/pages/profileEditPolicy.test.ts`
  (+`canEditLocalPassword`), `src/supabase/cloudMirror.test.ts` (+5 przypadków
  lustra profili, w tym regresja mapowania działu).
- `openwiki/n2hub/state-and-persistence.md` — granica lustra.

## Weryfikacja

- `npm test`: 35 plików / 960 testów — PASS (w tym 67 w pięciu plikach
  dotkniętych regresjami tego zadania).
- `npm run build` (`tsc --noEmit` + vite): PASS (ostrzeżenie o rozmiarze chunka
  jak dotychczas).

## Ryzyka / rzeczy do sprawdzenia

- Analogiczny problem liczenia zarchiwizowanych statusów `isDone` istnieje nadal
  w strażnikach `DELETE_STATUS` i `SET_STATUS_DONE` (usunięcie / odznaczenie
  ostatniego AKTYWNEGO statusu ukończenia przechodzi, gdy inny `isDone` jest
  zarchiwizowany). Zakres zadania wskazywał wyłącznie `setStatusArchived` —
  zostawione bez zmian, kandydat na osobny prompt.
- Lustro profili to nowa (dotąd nieistniejąca) ścieżka zapisu: RLS pozostaje
  źródłem autoryzacji — edycja cudzego profilu przez nie-admina zakończy się
  zrzuceniem operacji z istniejącą polską notką uprawnień (ścieżka
  `applyCloudOps`), bez blokowania kolejki.

## Podpis schedulera

- Run: `20260718-024614-215-save-feedback-and-authz-logic-fixes`
- Prompt: `215-save-feedback-and-authz-logic-fixes.md`
- Gałąź review: `review-integration`
- Baza: `10523b1219ccc842338bf5ac14e59527c96e48cb`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `10523b1219ccc842338bf5ac14e59527c96e48cb`
- Gałąź review: `review-integration`
- Run: `20260718-024614-215-save-feedback-and-authz-logic-fixes`

### Pliki zgłoszone do review

- `openwiki/n2hub/state-and-persistence.md`
- `src/components/TaskModal.tsx`
- `src/pages/AdminPage.tsx`
- `src/pages/PersonProfilePage.tsx`
- `src/pages/profileEditPolicy.test.ts`
- `src/pages/profileEditPolicy.ts`
- `src/store/AppStore.tsx`
- `src/store/persistGate.ts`
- `src/store/statusActions.test.ts`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `handoffs/scheduler-reviews/20260718-024614-215-save-feedback-and-authz-logic-fixes.md`
- `src/pages/statusNameDraft.test.ts`
- `src/pages/statusNameDraft.ts`
- `src/store/taskSaveFeedback.test.ts`
