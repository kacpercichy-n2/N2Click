import type { AccessRole } from '../types';
import type { TutorialModuleId } from '../utils/uiPrefs';

export type TourStep = {
  target: string;
  title: string;
  body: string;
  route: string;
  note?: string;
};

export type TutorialModule = {
  id: TutorialModuleId;
  title: string;
  summary: string;
  minutes: string;
  roles?: AccessRole[];
  steps: TourStep[];
};

const EVERYONE: AccessRole[] = ['administrator', 'pm', 'handlowiec', 'pracownik'];

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
        body: 'Tu widzisz bieżący kontekst: swoją pracę albo podsumowanie zespołu. Szczegóły zawsze otworzysz bez utraty miejsca na stronie.',
        route: '@current',
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
    summary: 'Lejek statusów projektów.',
    minutes: '2 min',
    roles: EVERYONE,
    steps: [
      {
        target: 'kanban.board',
        title: 'Kolumny opisują etap',
        body: 'Każda kolumna to status, a każda karta to projekt. Kliknięcie karty otwiera szczegóły.',
        route: '/kanban',
      },
      {
        target: 'kanban.column',
        title: 'Zmiana statusu',
        body: 'Uprawnione osoby mogą przeciągnąć kartę do innej kolumny. Jeśli nie używasz przeciągania, otwórz projekt i zmień status w szczegółach.',
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
    minutes: '3 min',
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
    summary: 'Przesuwanie, długość bloku, kolizje i przeciążenie.',
    minutes: '3 min',
    roles: EVERYONE,
    steps: [
      {
        target: 'calendar.week',
        title: 'Przesuwanie i zmiana czasu',
        body: 'Środek bloku go przesuwa, a jego krawędzie zmieniają czas w krokach 15 minut. Kliknięcie zawsze otwiera zadanie jako alternatywę dla gestu.',
        route: '/calendar',
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
    roles: ['administrator', 'pm'],
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
        body: 'Godziny na dzień i dni robocze decydują o tym, kiedy widok Obciążenie pokaże ostrzeżenie.',
        route: '/people',
      },
    ],
  },
  {
    id: 'admin',
    title: 'Administracja',
    summary: 'Statusy lejka i wspólne słowniki.',
    minutes: '3 min',
    roles: ['administrator'],
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
