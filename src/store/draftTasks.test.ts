// Szkice zadań (PKG-20260721-draft-tasks): zadanie utworzone w projekcie
// pozostaje szkicem (`Task.isDraft`), dopóki nie zostanie opublikowane. Szkic
// NIE materializuje godzin (żadnych wierszy `WorkloadEntry` — inwariant 1 + 4)
// i jest wykluczony z widoków planowania (Moja praca, pulpit, kanban).
// Publikacja przełącza flagę jedną atomową akcją (inwariant 6).
//
// Czyste testy reduktora i selektorów: bez Reacta i localStorage — fixture'y
// budujemy ręcznie z emptyData(), wzorem taskMeta.test.ts / selectors.test.ts.
import { describe, expect, it } from 'vitest';
import { reducer, type SaveTaskPayload, type TaskDraft } from './AppStore';
import { emptyData } from './storage';
import {
  isDraftTask,
  isPublishedTask,
  overdueTasksForPerson,
  unplannedTasksForPerson,
  todayAgendaForPerson,
  projectsOfPerson,
  entriesForTask,
} from './selectors';
import { buildKanbanColumns } from '../pages/kanbanBoard';
import { BIN_DATE, isBinEntry } from '../utils/time';
import type { AppData, Person, Project, Status, Task } from '../types';

const PROJECT: Project = {
  id: 'proj1',
  clientId: 'cli1',
  name: 'Projekt',
  description: '',
  statusId: 'active',
  paid: false,
  startDate: '2026-07-01',
  endDate: '2026-07-31',
  departmentId: '',
  serviceTypeId: '',
  documents: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const ACTIVE: Status = { id: 'active', name: 'W toku', slug: 'w-toku', color: '#9aa7c4', order: 0, archived: false, isDone: false };
const DONE: Status = { id: 'done', name: 'Gotowe', slug: 'gotowe', color: '#7ee0c3', order: 1, archived: false, isDone: true };

const ANNA: Person = {
  id: 'p1',
  firstName: 'Anna',
  lastName: 'Kowalska',
  name: 'Anna Kowalska',
  email: '',
  phone: '',
  role: '',
  departmentId: '',
  companyId: '',
  avatar: '',
  capacity: 8,
  accessRole: 'pelne',
  passwordHash: '',
  workDays: [1, 2, 3, 4, 5],
  workStartMinutes: 480,
  workEndMinutes: 960,
  supervisorId: '',
  birthDate: '',
};

function makeState(overrides: Partial<AppData> = {}): AppData {
  const base = emptyData();
  return {
    ...base,
    projects: [PROJECT],
    statuses: [ACTIVE, DONE],
    people: [ANNA],
    ...overrides,
  };
}

function draft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    projectId: 'proj1',
    statusId: 'active',
    title: 'Zadanie',
    description: '',
    startDate: '2026-07-06',
    endDate: '2026-07-10',
    estimatedHours: null,
    priority: 'normal',
    workCategoryId: '',
    departmentId: '',
    checklist: [],
    ...overrides,
  };
}

describe('SAVE_TASK — tworzenie szkicu', () => {
  it('szkic zapisuje zadanie + przypisania, ale NIE materializuje żadnych godzin, mimo allocations/binTotals', () => {
    const state = makeState();
    const payload: SaveTaskPayload = {
      taskId: null,
      draft: draft({ isDraft: true }),
      assigneeIds: ['p1'],
      // Modal mógłby przysłać przydziały i cele zasobnika — szkic je IGNORUJE.
      allocations: [{ personId: 'p1', date: '2026-07-06', plannedHours: 4 }],
      binTotals: [{ personId: 'p1', hours: 6 }],
      newUnassigned: [{ personId: 'p1', hours: 3 }],
    };

    const next = reducer(state, { type: 'SAVE_TASK', payload });

    expect(next.tasks).toHaveLength(1);
    const task = next.tasks[0];
    expect(task.isDraft).toBe(true);
    // Przypisanie powstaje (osoby można wybrać na etapie szkicu).
    expect(next.assignments.map((a) => a.personId)).toEqual(['p1']);
    // ŻADNYCH wierszy workload — ani datowanych, ani zasobnika (inwariant 1 + 4).
    expect(next.workload).toEqual([]);
    expect(entriesForTask(next, task.id)).toEqual([]);
  });

  it('zwykłe tworzenie (bez isDraft) publikuje natychmiast i materializuje godziny — brak regresji', () => {
    const state = makeState();
    const payload: SaveTaskPayload = {
      taskId: null,
      draft: draft(), // brak isDraft => opublikowane
      assigneeIds: ['p1'],
      allocations: [{ personId: 'p1', date: '2026-07-06', plannedHours: 4 }],
      binTotals: [{ personId: 'p1', hours: 6 }],
    };

    const next = reducer(state, { type: 'SAVE_TASK', payload });
    const task = next.tasks[0];

    expect(task.isDraft).toBe(false);
    // 4h w kalendarzu + 6h absolutnego celu zasobnika = dwa wiersze, razem 10h.
    const rows = entriesForTask(next, task.id);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.reduce((s, w) => s + w.plannedHours, 0)).toBe(10);
  });
});

describe('SAVE_TASK — edycja szkicu i zadania', () => {
  it('edycja szkicu zachowuje isDraft i nadal nie tworzy godzin', () => {
    const created = reducer(makeState(), {
      type: 'SAVE_TASK',
      payload: { taskId: null, draft: draft({ isDraft: true }), assigneeIds: ['p1'], allocations: [] },
    });
    const id = created.tasks[0].id;

    const edited = reducer(created, {
      type: 'SAVE_TASK',
      payload: {
        taskId: id,
        // Formularz mógłby przysłać isDraft:false — edycja IGNORUJE to pole.
        draft: draft({ isDraft: false, title: 'Zmieniony' }),
        assigneeIds: ['p1'],
        allocations: [{ personId: 'p1', date: '2026-07-06', plannedHours: 4 }],
        binTotals: [{ personId: 'p1', hours: 6 }],
      },
    });

    const task = edited.tasks.find((t) => t.id === id)!;
    expect(task.title).toBe('Zmieniony');
    expect(task.isDraft).toBe(true); // publikacji nie da się zrobić przez formularz
    expect(edited.workload).toEqual([]);
  });

  it('edycja OPUBLIKOWANEGO zadania rekonciliuje godziny jak dotąd — brak regresji', () => {
    const created = reducer(makeState(), {
      type: 'SAVE_TASK',
      payload: {
        taskId: null,
        draft: draft(),
        assigneeIds: ['p1'],
        allocations: [{ personId: 'p1', date: '2026-07-06', plannedHours: 4 }],
      },
    });
    const id = created.tasks[0].id;
    expect(created.workload.reduce((s, w) => s + w.plannedHours, 0)).toBe(4);

    const edited = reducer(created, {
      type: 'SAVE_TASK',
      payload: {
        taskId: id,
        draft: draft(),
        assigneeIds: ['p1'],
        allocations: [{ personId: 'p1', date: '2026-07-06', plannedHours: 7 }],
      },
    });
    expect(edited.workload.reduce((s, w) => s + w.plannedHours, 0)).toBe(7);
  });
});

describe('PUBLISH_PROJECT_DRAFTS', () => {
  function withTwoDrafts(): AppData {
    let s = reducer(makeState(), {
      type: 'SAVE_TASK',
      payload: { taskId: null, draft: draft({ title: 'Szkic A', isDraft: true }), assigneeIds: ['p1'], allocations: [] },
    });
    s = reducer(s, {
      type: 'SAVE_TASK',
      payload: { taskId: null, draft: draft({ title: 'Szkic B', isDraft: true }), assigneeIds: [], allocations: [] },
    });
    return s;
  }

  it('publikuje WSZYSTKIE szkice projektu jedną akcją; przypisania nietknięte', () => {
    const s = withTwoDrafts();
    expect(s.tasks.every((t) => t.isDraft === true)).toBe(true);
    const assignmentsBefore = s.assignments;

    const next = reducer(s, { type: 'PUBLISH_PROJECT_DRAFTS', projectId: 'proj1' });

    expect(next.tasks.every((t) => t.isDraft === false)).toBe(true);
    expect(next.assignments).toEqual(assignmentsBefore);
  });

  it('nie rusza szkiców INNEGO projektu', () => {
    const other: Project = { ...PROJECT, id: 'proj2', name: 'Inny' };
    let s = makeState({ projects: [PROJECT, other] });
    s = reducer(s, {
      type: 'SAVE_TASK',
      payload: { taskId: null, draft: draft({ isDraft: true }), assigneeIds: [], allocations: [] },
    });
    s = reducer(s, {
      type: 'SAVE_TASK',
      payload: { taskId: null, draft: draft({ projectId: 'proj2', isDraft: true }), assigneeIds: [], allocations: [] },
    });

    const next = reducer(s, { type: 'PUBLISH_PROJECT_DRAFTS', projectId: 'proj1' });

    expect(next.tasks.find((t) => t.projectId === 'proj1')!.isDraft).toBe(false);
    expect(next.tasks.find((t) => t.projectId === 'proj2')!.isDraft).toBe(true);
  });

  it('nieistniejący projekt albo brak szkiców => ta sama referencja stanu (inwariant 6)', () => {
    const s = withTwoDrafts();
    expect(reducer(s, { type: 'PUBLISH_PROJECT_DRAFTS', projectId: 'ghost' })).toBe(s);

    const published = reducer(s, { type: 'PUBLISH_PROJECT_DRAFTS', projectId: 'proj1' });
    // Drugie wywołanie: brak szkiców => ta sama referencja.
    expect(reducer(published, { type: 'PUBLISH_PROJECT_DRAFTS', projectId: 'proj1' })).toBe(published);
  });
});

describe('PUBLISH_TASK (pojedynczy szkic)', () => {
  it('publikuje jeden szkic; zadanie nie-szkic lub nieistniejące => ta sama referencja', () => {
    const s = reducer(makeState(), {
      type: 'SAVE_TASK',
      payload: { taskId: null, draft: draft({ isDraft: true }), assigneeIds: [], allocations: [] },
    });
    const id = s.tasks[0].id;

    const next = reducer(s, { type: 'PUBLISH_TASK', taskId: id });
    expect(next.tasks[0].isDraft).toBe(false);

    // Już opublikowane => ta sama referencja.
    expect(reducer(next, { type: 'PUBLISH_TASK', taskId: id })).toBe(next);
    // Nieistniejące => ta sama referencja.
    expect(reducer(s, { type: 'PUBLISH_TASK', taskId: 'ghost' })).toBe(s);
  });
});

const BOLEK: Person = { ...ANNA, id: 'p2', firstName: 'Bolek', lastName: 'Nowak', name: 'Bolek Nowak' };

describe('SAVE_TASK — godziny szkicu (draftHours)', () => {
  it('zapisuje draftHours przefiltrowane po przypisaniach i snapowane; ZERO wierszy workload', () => {
    const state = makeState({ people: [ANNA, BOLEK] });
    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: {
        taskId: null,
        draft: draft({ isDraft: true }),
        assigneeIds: ['p1'],
        allocations: [],
        // p2 nieprzypisany => odpada; 4,3h snapuje się do 4,25h.
        binTotals: [
          { personId: 'p1', hours: 4.3 },
          { personId: 'p2', hours: 6 },
        ],
      },
    });
    const task = next.tasks[0];
    expect(task.draftHours).toEqual([{ personId: 'p1', hours: 4.25 }]);
    expect(next.workload).toEqual([]);
  });

  it('wyczyszczenie godzin przy edycji szkicu USUWA klucz draftHours', () => {
    const created = reducer(makeState(), {
      type: 'SAVE_TASK',
      payload: { taskId: null, draft: draft({ isDraft: true }), assigneeIds: ['p1'], allocations: [], binTotals: [{ personId: 'p1', hours: 5 }] },
    });
    const id = created.tasks[0].id;
    expect(created.tasks[0].draftHours).toEqual([{ personId: 'p1', hours: 5 }]);

    const cleared = reducer(created, {
      type: 'SAVE_TASK',
      payload: { taskId: id, draft: draft({ isDraft: true }), assigneeIds: ['p1'], allocations: [], binTotals: [{ personId: 'p1', hours: 0 }] },
    });
    expect('draftHours' in cleared.tasks[0]).toBe(false);
  });

  it('niepoprawne binTotals (NaN/ujemne) na zapisie szkicu => TA SAMA referencja (inwariant 6)', () => {
    const state = makeState();
    const nan = reducer(state, {
      type: 'SAVE_TASK',
      payload: { taskId: null, draft: draft({ isDraft: true }), assigneeIds: ['p1'], allocations: [], binTotals: [{ personId: 'p1', hours: Number.NaN }] },
    });
    expect(nan).toBe(state);
    const neg = reducer(state, {
      type: 'SAVE_TASK',
      payload: { taskId: null, draft: draft({ isDraft: true }), assigneeIds: ['p1'], allocations: [], binTotals: [{ personId: 'p1', hours: -2 }] },
    });
    expect(neg).toBe(state);
  });
});

describe('PUBLISH_TASK — materializacja godzin szkicu', () => {
  it('tworzy dokładnie jeden wiersz zasobnika na osobę, usuwa draftHours', () => {
    const created = reducer(makeState({ people: [ANNA, BOLEK] }), {
      type: 'SAVE_TASK',
      payload: {
        taskId: null,
        draft: draft({ isDraft: true }),
        assigneeIds: ['p1', 'p2'],
        allocations: [],
        binTotals: [{ personId: 'p1', hours: 4 }, { personId: 'p2', hours: 2.5 }],
      },
    });
    const id = created.tasks[0].id;

    const published = reducer(created, { type: 'PUBLISH_TASK', taskId: id });
    const task = published.tasks[0];
    expect(task.isDraft).toBe(false);
    expect('draftHours' in task).toBe(false);

    const rows = published.workload.filter((w) => w.taskId === id);
    expect(rows).toHaveLength(2);
    for (const w of rows) {
      expect(isBinEntry(w)).toBe(true);
      expect(w.date).toBe(BIN_DATE);
      expect(w.startMinutes).toBe(0);
    }
    expect(rows.find((w) => w.personId === 'p1')!.plannedHours).toBe(4);
    expect(rows.find((w) => w.personId === 'p2')!.plannedHours).toBe(2.5);
    // Jeden wiersz na parę (inwariant 4).
    expect(new Set(rows.map((w) => w.personId)).size).toBe(2);
  });

  it('pomija wpis osoby, która nie jest już przypisana do zadania', () => {
    // Szkic z godzinami dla p1; ręcznie osieroćmy draftHours dodatkowym p2.
    const created = reducer(makeState({ people: [ANNA, BOLEK] }), {
      type: 'SAVE_TASK',
      payload: { taskId: null, draft: draft({ isDraft: true }), assigneeIds: ['p1'], allocations: [], binTotals: [{ personId: 'p1', hours: 3 }] },
    });
    const id = created.tasks[0].id;
    // Wstrzyknij nieprzypisany wpis (symulacja nieaktualnego wiersza z chmury).
    const tampered: AppData = {
      ...created,
      tasks: created.tasks.map((t) =>
        t.id === id ? { ...t, draftHours: [{ personId: 'p1', hours: 3 }, { personId: 'p2', hours: 9 }] } : t,
      ),
    };

    const published = reducer(tampered, { type: 'PUBLISH_TASK', taskId: id });
    const rows = published.workload.filter((w) => w.taskId === id);
    expect(rows.map((w) => w.personId)).toEqual(['p1']);
  });
});

describe('PUBLISH_PROJECT_DRAFTS — materializacja atomowa', () => {
  it('materializuje wszystkie szkice projektu w jednej transakcji', () => {
    let s = reducer(makeState({ people: [ANNA, BOLEK] }), {
      type: 'SAVE_TASK',
      payload: { taskId: null, draft: draft({ title: 'A', isDraft: true }), assigneeIds: ['p1'], allocations: [], binTotals: [{ personId: 'p1', hours: 4 }] },
    });
    s = reducer(s, {
      type: 'SAVE_TASK',
      payload: { taskId: null, draft: draft({ title: 'B', isDraft: true }), assigneeIds: ['p2'], allocations: [], binTotals: [{ personId: 'p2', hours: 6 }] },
    });

    const next = reducer(s, { type: 'PUBLISH_PROJECT_DRAFTS', projectId: 'proj1' });
    expect(next.tasks.every((t) => t.isDraft === false)).toBe(true);
    expect(next.tasks.every((t) => !('draftHours' in t))).toBe(true);
    // Dwa wiersze zasobnika — po jednym na zadanie/osobę.
    expect(next.workload).toHaveLength(2);
    expect(next.workload.every((w) => isBinEntry(w))).toBe(true);
    expect(next.workload.reduce((sum, w) => sum + w.plannedHours, 0)).toBe(10);
  });
});

describe('selektory — szkice wykluczone z planowania', () => {
  const draftTask: Task = {
    id: 'td', projectId: 'proj1', statusId: 'active', title: 'Szkic', description: '',
    startDate: '2026-06-01', endDate: '2026-06-02', estimatedHours: null, priority: 'normal',
    workCategoryId: '', departmentId: '', checklist: [], orderIndex: 0, isDraft: true,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const pubTask: Task = { ...draftTask, id: 'tp', title: 'Opublikowane', isDraft: false };

  function stateWithBoth(): AppData {
    return makeState({
      tasks: [draftTask, pubTask],
      assignments: [
        { id: 'a1', taskId: 'td', personId: 'p1' },
        { id: 'a2', taskId: 'tp', personId: 'p1' },
      ],
    });
  }

  it('isDraftTask / isPublishedTask', () => {
    expect(isDraftTask(draftTask)).toBe(true);
    expect(isPublishedTask(draftTask)).toBe(false);
    // Legacy bez pola => opublikowane.
    expect(isPublishedTask({ ...draftTask, isDraft: undefined })).toBe(true);
  });

  it('overdue / unplanned / todayAgenda(dateless) / projectsOfPerson pomijają szkic', () => {
    const s = stateWithBoth();
    const today = '2026-07-15';

    expect(overdueTasksForPerson(s, 'p1', today).map((t) => t.id)).toEqual(['tp']);
    expect(unplannedTasksForPerson(s, 'p1').map((t) => t.id)).toEqual(['tp']);
    // Zadania mają deadline 2026-06-02; agenda „na dziś” pokazuje dateless tylko w dniu terminu.
    const agenda = todayAgendaForPerson(s, 'p1', '2026-06-02');
    expect(agenda.dateless.map((t) => t.id)).toEqual(['tp']);
    // Osoba jest przypisana tylko przez szkic + opublikowane => projekt raz.
    expect(projectsOfPerson(s, 'p1').map((p) => p.id)).toEqual(['proj1']);
    // A gdyby przypisanie było TYLKO do szkicu — projekt nie wchodzi.
    const onlyDraft = makeState({
      tasks: [draftTask],
      assignments: [{ id: 'a1', taskId: 'td', personId: 'p1' }],
    });
    expect(projectsOfPerson(onlyDraft, 'p1')).toEqual([]);
  });

  it('kanban pomija szkice', () => {
    const s = stateWithBoth();
    const board = buildKanbanColumns(s, {
      paid: 'all',
      clientId: '',
      personIds: new Set<string>(),
    });
    const allBoardTaskIds = board.columns.flatMap((c) => c.tasks.map((t) => t.id));
    expect(allBoardTaskIds).toContain('tp');
    expect(allBoardTaskIds).not.toContain('td');
  });
});
