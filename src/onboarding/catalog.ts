import type { AccessRole } from '../types';
import type { TutorialModuleId } from '../utils/uiPrefs';

export type TourStep = {
  target: string;
  title: string;
  body: string;
  route: string;
  note?: string;
  practice?: {
    kind: 'move' | 'resize' | 'bin-drop';
    instruction: string;
  };
};

export type TutorialModule = {
  id: TutorialModuleId;
  title: string;
  summary: string;
  minutes: string;
  roles?: AccessRole[];
  steps: TourStep[];
};

const EVERYONE: AccessRole[] = ['pelne', 'ograniczone'];

export const TUTORIAL_MODULES: TutorialModule[] = [
  {
    id: 'shell',
    title: 'Pierwsze kroki',
    summary: 'Nawigacja, wyszukiwanie i miejsce, od którego warto zacząć.',
    minutes: '2 min',
    roles: EVERYONE,
    steps: [
      {
        target: 'shell.nav',
        title: 'Najważniejsze widoki',
        body: 'Menu prowadzi do danych, planowania czasu i widoków zespołu. Widzisz funkcje odpowiednie dla swojej roli.',
        route: '@current',
      },
      {
        target: 'shell.search',
        title: 'Znajdź bez przeklikiwania',
        body: 'Wyszukaj projekt, zadanie, osobę albo klienta. Skrót Ctrl/Cmd+K działa z każdego widoku.',
        route: '@current',
      },
      {
        target: 'shell.main',
        title: 'Twój punkt startowy',
        body: 'Po zalogowaniu trafiasz na widok dopasowany do Twojej roli — pracownik zaczyna od widoku Moja praca, a pozostałe role od podsumowania zespołu. Szczegóły zawsze otworzysz bez utraty miejsca na stronie.',
        route: '@current',
        note: 'Gdy dane zmienią się w innej karcie przeglądarki, aplikacja nigdy nie nadpisze Twojej pracy po cichu — zapyta, którą wersję zostawić.',
      },
      {
        target: 'shell.help',
        title: 'Pomoc jest zawsze pod ręką',
        body: 'W tym miejscu ponownie uruchomisz intro lub wybrany samouczek. Nie musisz kończyć go teraz.',
        route: '@current',
      },
    ],
  },
  {
    id: 'home',
    title: 'Panel i moja praca',
    summary: 'Dzisiejszy plan, Zasobnik i alerty.',
    minutes: '2 min',
    roles: EVERYONE,
    steps: [
      {
        target: 'home.today',
        title: 'Co jest na dziś',
        body: 'Ta lista pokazuje bloki rzeczywiście zaplanowane na dzisiejszy dzień.',
        route: '@home',
      },
      {
        target: 'home.bin',
        title: 'Zasobnik',
        body: 'To godziny przypisane do osoby, ale bez konkretnego dnia i godziny. Nadaj im termin w Kalendarzu.',
        route: '@home',
      },
      {
        target: 'home.alerts',
        title: 'Alerty wymagają uwagi',
        body: 'Zobaczysz tu zadania po terminie, przeciążone dni i pracę bez planu. Przeciążenie jest ostrzeżeniem, nie blokadą.',
        route: '@home',
      },
    ],
  },
  {
    id: 'projects',
    title: 'Projekty',
    summary: 'Klienci, okresy, płatność i projektowe podsumowania.',
    minutes: '3 min',
    roles: EVERYONE,
    steps: [
      {
        target: 'projects.filters',
        title: 'Filtry i presety',
        body: 'Zawężaj listę po kliencie, statusie, płatności i okresie. Powtarzalny zestaw filtrów możesz zapisać.',
        route: '/projects',
      },
      {
        target: 'projects.list',
        title: 'Projekt w jednym miejscu',
        body: 'Karta pokazuje klienta, status, daty, liczbę zadań, zaplanowane godziny i wielkość zespołu.',
        route: '/projects',
      },
      {
        target: 'projects.coin',
        title: 'Moneta to płatność',
        body: 'Złota moneta oznacza projekt opłacony, a brązowa nieopłacony. Nie jest to status realizacji projektu.',
        route: '/projects',
      },
    ],
  },
  {
    id: 'kanban',
    title: 'Kanban',
    summary: 'Lejek statusów zadań.',
    minutes: '2 min',
    roles: EVERYONE,
    steps: [
      {
        target: 'kanban.board',
        title: 'Kolumny opisują etap',
        body: 'Każda kolumna to status, a każda karta to zadanie. Kliknięcie karty otwiera edycję zadania.',
        route: '/kanban',
      },
      {
        target: 'kanban.column',
        title: 'Zmiana statusu',
        body: 'Uprawnione osoby mogą przeciągnąć kartę do innej kolumny. Jeśli nie używasz przeciągania, otwórz zadanie i zmień status w szczegółach.',
        route: '/kanban',
      },
    ],
  },
  {
    id: 'timeline',
    title: 'Oś czasu',
    summary: 'Daty projektów, zadań i kamienie milowe.',
    minutes: '3 min',
    roles: EVERYONE,
    steps: [
      {
        target: 'timeline.toolbar',
        title: 'Wybierz perspektywę',
        body: 'Przełącz widok Projektów i Osób, zakres oraz powiększenie. Te kontrolki nie zmieniają danych.',
        route: '/timeline',
      },
      {
        target: 'timeline.chart',
        title: 'Pasek oznacza okres dat',
        body: 'Szerokość paska pokazuje zakres kalendarzowy projektu lub zadania, a nie liczbę godzin pracy.',
        route: '/timeline',
      },
    ],
  },
  {
    id: 'tasks',
    title: 'Zadania',
    summary: 'Status planowania, szacunki, osoby i godziny.',
    minutes: '4 min',
    roles: EVERYONE,
    steps: [
      {
        target: 'tasks.filters',
        title: 'Znajdź właściwą pracę',
        body: 'Filtruj po osobie, statusie, priorytecie, kategorii i stanie planowania.',
        route: '/tasks',
      },
      {
        target: 'tasks.list',
        title: 'Status realizacji i planowanie',
        body: 'Status zadania mówi o etapie pracy. Znacznik planowania mówi, czy godziny są rozpisane, częściowo w Zasobniku albo przekraczają szacunek.',
        route: '/tasks',
      },
      {
        target: 'tasks.list',
        title: 'Planowanie w oknie zadania',
        body: 'Godziny w dniu i w Zasobniku przyjmują kroki co 0,25 h (15 minut), a godziny w Zasobniku dodasz tylko osobom przypisanym do zadania. Skrócenie okresu od razu przelicza „zaplanowano”, a wpisy poza nowym okresem są usuwane przy zapisie.',
        route: '/tasks',
        note: 'Wpisane wartości są zaokrąglane do najbliższych 15 minut (0,25 h); wartości bliskie zeru są usuwane.',
      },
    ],
  },
  {
    id: 'calendar-basics',
    title: 'Kalendarz i Zasobnik',
    summary: 'Godziny, bloki czasu i praca bez terminu.',
    minutes: '3 min',
    roles: EVERYONE,
    steps: [
      {
        target: 'calendar.toolbar',
        title: 'Wybierz okres i osoby',
        body: 'Przełączasz tydzień i miesiąc, wracasz do dziś oraz filtrujesz osoby bez zmieniania danych.',
        route: '/calendar',
      },
      {
        target: 'calendar.week',
        title: 'Blok to konkretna pora pracy',
        body: 'Pionowe położenie bloku oznacza godzinę startu. Jego wysokość i etykieta oznaczają zaplanowany czas.',
        route: '/calendar',
      },
      {
        target: 'calendar.bin',
        title: 'Godziny bez terminu',
        body: 'Zasobnik przechowuje pracę bez daty. Możesz ją przeciągnąć na siatkę albo otworzyć zadanie i ustawić dzienny przydział.',
        route: '/calendar',
      },
    ],
  },
  {
    id: 'calendar-advanced',
    title: 'Kalendarz: planowanie zaawansowane',
    summary: 'Ćwiczenia na żywym planie: przesuwanie, długość bloku, kolizje i przeciążenie.',
    minutes: '3 min',
    roles: EVERYONE,
    steps: [
      {
        target: 'calendar.block',
        title: 'Przećwicz przesunięcie prawdziwego bloku',
        body: 'Podświetlony blok jest realnym zadaniem z Twojego kalendarza. Przeciągnij jego środek na wolną godzinę lub inny dzień.',
        route: '/calendar',
        practice: {
          kind: 'move',
          instruction: 'Twoja kolej: przeciągnij podświetlony blok za jego środek. Zmiana zostanie zapisana jak przy normalnej pracy.',
        },
      },
      {
        target: 'calendar.block',
        title: 'Zmień długość bloku',
        body: 'Uchwyty na górnej i dolnej krawędzi bloku zmieniają czas co 15 minut. Nie nakładaj go na inną pracę tej samej osoby.',
        route: '/calendar',
        practice: {
          kind: 'resize',
          instruction: 'Twoja kolej: złap górną albo dolną krawędź podświetlonego bloku i zmień jego długość.',
        },
      },
      {
        target: 'calendar.bin-card',
        title: 'Nadaj termin pracy z Zasobnika',
        body: 'Ta karta ma przypisaną osobę i liczbę godzin, ale nie ma jeszcze daty. Przeciągnij ją na wolne miejsce w siatce albo w widoku tygodnia użyj na karcie przycisku „Zaplanuj część” i podaj dzień, start oraz liczbę godzin.',
        route: '/calendar',
        practice: {
          kind: 'bin-drop',
          instruction: 'Twoja kolej: przeciągnij podświetloną kartę z Zasobnika na godzinę w wybranym dniu.',
        },
      },
      {
        target: 'calendar.overload',
        title: 'Ostrzeżenie i kolizja to co innego',
        body: '⚠ oznacza przekroczenie dostępności i ostrzega. Nakładanie bloków tej samej osoby blokuje tylko drop lub zmianę rozmiaru w kalendarzu.',
        route: '/calendar',
        note: 'Ten element jest widoczny, gdy dzień zawiera przeciążenie.',
      },
    ],
  },
  {
    id: 'workload',
    title: 'Obciążenie zespołu',
    summary: 'Dostępność osób i rozkład pracy w tygodniu.',
    minutes: '2 min',
    roles: ['pelne'],
    steps: [
      {
        target: 'workload.table',
        title: 'Osoba i dzień',
        body: 'Komórka pokazuje liczbę zaplanowanych godzin danej osoby w danym dniu. Kliknij niepustą komórkę, aby zobaczyć bloki.',
        route: '/workload',
      },
      {
        target: 'workload.load',
        title: 'Pasek to procent dostępności',
        body: 'Pasek porównuje przypisane godziny z dostępnością. Dostępność uwzględnia capacity i dni robocze osoby.',
        route: '/workload',
      },
    ],
  },
  {
    id: 'people',
    title: 'Zespół i profil',
    summary: 'Role, dostępność, dni robocze i własny profil.',
    minutes: '2 min',
    roles: EVERYONE,
    steps: [
      {
        target: 'people.list',
        title: 'Zespół i przypisana praca',
        body: 'Lista łączy osoby, role i łączną liczbę przypisanych godzin. Profil pokazuje więcej szczegółów.',
        route: '/people',
      },
      {
        target: 'people.capacity',
        title: 'Dostępność jest progiem pracy',
        body: 'Godziny na dzień i dni robocze decydują o tym, kiedy widok Obciążenie pokaże ostrzeżenie. Godziny na dzień mają górny limit 24 h — wyższe wartości są przycinane przy zapisie.',
        route: '/people',
      },
    ],
  },
  {
    id: 'admin',
    title: 'Ustawienia',
    summary: 'Statusy lejka i wspólne słowniki.',
    minutes: '3 min',
    roles: ['pelne'],
    steps: [
      {
        target: 'admin.statuses',
        title: 'Statusy sterują lejkiem',
        body: 'Są wspólne dla projektów i zadań oraz budują kolumny Kanbana. Archiwizacja zachowuje historię.',
        route: '/admin',
      },
      {
        target: 'admin.done',
        title: 'Ukończenie jest niezależne',
        body: 'Znacznik Ukończenie decyduje, które statusy oznaczają zakończoną pracę — niezależnie od ich kolejności.',
        route: '/admin',
      },
      {
        target: 'admin.dictionaries',
        title: 'Wspólne słowniki',
        body: 'Nazwy klientów, działów, typów usług i kategorii prac zmieniasz w miejscu — Enter zatwierdza zmianę. Pustej nazwy nie da się zapisać: pole wraca wtedy do poprzedniej wartości.',
        route: '/admin',
      },
    ],
  },
];

export function modulesForRole(role: AccessRole | undefined): TutorialModule[] {
  if (!role) return TUTORIAL_MODULES.filter((module) => module.id === 'shell');
  return TUTORIAL_MODULES.filter((module) => !module.roles || module.roles.includes(role));
}

export function moduleById(id: TutorialModuleId): TutorialModule {
  const module = TUTORIAL_MODULES.find((candidate) => candidate.id === id);
  if (!module) throw new Error(`Unknown tutorial module: ${id}`);
  return module;
}
