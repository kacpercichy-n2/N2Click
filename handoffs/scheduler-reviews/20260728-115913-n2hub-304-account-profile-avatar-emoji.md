# Raport workflow: 20260728-115913-n2hub-304-account-profile-avatar-emoji

## Wykonane

Analiza wstępna: problem NADAL występował w bieżącym buildzie — komponent
`Avatar` renderował `person.avatar` (emotkę) jako fallback przed inicjałami,
a formularze Profilu i dodawania osoby miały rubrykę „Avatar” z inputem emoji
(placeholder 🙂). Żaden run 271–303 tego nie ruszał; względem referencyjnego
`28f9c88` pliki awatara różniły się tylko zmianami a11y, a CSS `.avatar` był
identyczny.

Poprawka (chirurgiczna, czysto prezentacyjna):

1. `src/components/Avatar.tsx` — usunięta gałąź emoji. Fallback przy braku
   zdjęcia to zawsze neutralne inicjały na kolorze osoby (`personColor`),
   czyli dotychczasowy neutralny wariant z `28f9c88` dla osób bez emotki.
   Kolejność: zdjęcie profilowe → inicjały. Naprawia to od razu WSZYSTKIE
   miejsca renderowania (rubryka awatara na Profilu, sidebar/stopka w
   `App.tsx`, LoginPage, PeoplePage, GlobalSearch, Kanban, Tasks, Dashboard,
   Workload, CommentsPanel, TeamStructureTree).
2. `src/pages/PersonProfilePage.tsx` — usunięte pole formularza „Avatar”
   (input emoji `pp-avatar` / odczyt `person.avatar`). Rubryka awatara to
   podgląd zdjęcia w pierwszej karcie: `ProfilePhotoAvatar` (zdjęcie +
   bąbelek ołówka do zmiany/wgrania — logika uploadu NIETKNIĘTA) albo
   `Avatar` 72 px z inicjałami, gdy upload niedostępny.
3. `src/pages/PeoplePage.tsx` — usunięty analogiczny input emoji „Avatar”
   z formularza dodawania osoby (nie zostawiamy martwego edytora pola,
   które nigdzie się nie renderuje).
4. Komentarze doprowadzone do stanu faktycznego (`types.ts` — `avatar` to
   pole legacy zachowane dla zgodności danych, `AvatarUrlsProvider.tsx`,
   nagłówki `PeoplePage`/`PersonProfilePage`).

Model danych, storage, migracje, `profileEditPolicy` (klucz `avatarEmoji`),
uprawnienia i logika uploadu zdjęcia — bez zmian. Zapis profilu nadal
przenosi dotychczasową wartość `person.avatar` bez modyfikacji (draft nie
jest już edytowalny), więc dane w chmurze/localStorage nie są czyszczone.

## Zmiany

- `src/components/Avatar.tsx` — fallback bez emoji (zdjęcie → inicjały).
- `src/pages/PersonProfilePage.tsx` — usunięte pole emoji „Avatar” z
  formularza Profilu + aktualizacja komentarza.
- `src/pages/PeoplePage.tsx` — usunięte pole emoji „Avatar” z formularza
  dodawania osoby + aktualizacja komentarza.
- `src/types.ts`, `src/supabase/AvatarUrlsProvider.tsx` — tylko komentarze.

## Weryfikacja

- `npm test`: 102 pliki, 2137 testów — wszystkie zielone, bez regresji.
- `npm run build`: zielony (Vite, bez błędów TS).
- Grep kontrolny: brak pozostałych `placeholder="🙂"` ani renderu
  `person.avatar` w całym `src/`.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- `Person.avatar` zostaje w modelu jako pole legacy (DATA_VERSION 7 bez
  zmian) — istniejące emotki w danych nie są kasowane, tylko przestają być
  renderowane i edytowalne. Ewentualne czyszczenie kolumny to osobna,
  świadoma decyzja (migracja danych — poza zakresem tego runu).
- `profileEditPolicy` nadal wymienia `avatarEmoji` w listach pól — celowo
  nietknięte (zakaz ruszania uprawnień); pole nie ma już UI, więc wpis jest
  martwy, ale nieszkodliwy.
- Wiki: bez zmian — `cloud-database.md` opisuje kolumnę `avatar` (emoji)
  jako format danych w bazie, co pozostaje prawdą; granice, inwarianty
  i trasy testowe nie zmieniły się.

## Podpis schedulera

- Run: `20260728-115913-n2hub-304-account-profile-avatar-emoji`
- Prompt: `304-account-profile-avatar-emoji.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `9613e20ab4f88e4b01cfaaa9c9b35a1689700723`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `9613e20ab4f88e4b01cfaaa9c9b35a1689700723`
- Gałąź review: `review-integration`
- Run: `20260728-115913-n2hub-304-account-profile-avatar-emoji`

### Pliki zgłoszone do review

- `src/components/Avatar.tsx`
- `src/pages/PeoplePage.tsx`
- `src/pages/PersonProfilePage.tsx`
- `src/supabase/AvatarUrlsProvider.tsx`
- `src/types.ts`
- `handoffs/scheduler-reviews/20260728-115913-n2hub-304-account-profile-avatar-emoji.md`
