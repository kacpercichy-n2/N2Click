// Unit tests for the pure Panel helper module (dashboardPanels): the
// notification visibility cap (max 3), the Zespół header counter label and the
// phone stack model (tile order + emptiness rule, compact workload line).
// Pure — no React, no localStorage.
import { describe, expect, it } from 'vitest';
import {
  MAX_NOTIFICATIONS,
  binPlanCtaLabel,
  dashTileView,
  mobileDashboardOrder,
  notificationEntry,
  teamHeaderLabel,
  visibleNotifications,
  workloadSummaryLine,
  type MobileDashFlags,
  type NotificationEntry,
} from './dashboardPanels';
import type { Notification } from '../types';

function entries(n: number): NotificationEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    title: `Powiadomienie ${i}`,
    preview: { who: 'Ktoś', what: '—', where: '—' },
  }));
}

describe('visibleNotifications', () => {
  it('shows nothing when there are no entries', () => {
    expect(visibleNotifications([])).toEqual([]);
  });

  it('shows all entries when there are exactly MAX (3)', () => {
    const list = entries(3);
    expect(visibleNotifications(list)).toEqual(list);
    expect(visibleNotifications(list)).toHaveLength(MAX_NOTIFICATIONS);
  });

  it('caps at MAX (3) and keeps the first entries when there are more', () => {
    const list = entries(5);
    const shown = visibleNotifications(list);
    expect(shown).toHaveLength(MAX_NOTIFICATIONS);
    expect(shown.map((e) => e.id)).toEqual(['n0', 'n1', 'n2']);
  });
});

describe('notificationEntry', () => {
  const base = (o: Partial<Notification> & { id: string; type: Notification['type'] }): Notification => ({
    recipientId: 'me',
    payload: {},
    readAt: '',
    createdAt: '2026-07-07T10:00:00.000Z',
    ...o,
  });

  it('task_assigned: kto/co + cel = zadanie, projekt jako meta', () => {
    const entry = notificationEntry(
      base({ id: 'n1', type: 'task_assigned', payload: { taskId: 't1', projectId: 'p1' } }),
      { actorName: 'Kasia', taskTitle: 'Montaż', projectName: 'Kampania', commentBody: '' },
    );
    expect(entry.title).toBe('Kasia przypisał(a) Ci zadanie „Montaż”');
    expect(entry.when).toBe('Kampania');
    expect(entry.target).toEqual({ kind: 'task', taskId: 't1' });
    expect(entry.preview).toEqual({ who: 'Kasia', what: 'Montaż', where: 'Kampania' });
    expect('body' in entry.preview).toBe(false);
    expect(entry.openLabel).toBe('Otwórz zadanie');
  });

  it('project_comment: cel = projekt', () => {
    const entry = notificationEntry(
      base({ id: 'n2', type: 'project_comment', payload: { projectId: 'p1', commentId: 'c1' } }),
      { actorName: 'Tomek', taskTitle: '', projectName: 'Kampania', commentBody: '' },
    );
    expect(entry.title).toBe('Tomek skomentował(a) projekt „Kampania”');
    expect(entry.target).toEqual({ kind: 'project', projectId: 'p1' });
  });

  it('project_comment: treść komentarza trafia do podglądu (przycięta)', () => {
    const entry = notificationEntry(
      base({ id: 'n2', type: 'project_comment', payload: { projectId: 'p1', commentId: 'c1' } }),
      {
        actorName: 'Tomek',
        taskTitle: '',
        projectName: 'Kampania',
        commentBody: '  Poprawcie proszę intro.\n',
      },
    );
    expect(entry.preview.who).toBe('Tomek');
    expect(entry.preview.what).toBe('Kampania');
    expect(entry.preview.where).toBe('Kampania');
    expect(entry.preview.body).toBe('Poprawcie proszę intro.');
    expect(entry.openLabel).toBe('Otwórz projekt');
  });

  it('project_comment: brak treści => klucz `body` NIE istnieje', () => {
    const entry = notificationEntry(
      base({ id: 'n2', type: 'project_comment', payload: { projectId: 'p1', commentId: 'c1' } }),
      { actorName: 'Tomek', taskTitle: '', projectName: 'Kampania', commentBody: '' },
    );
    expect('body' in entry.preview).toBe(false);
  });

  it('bin_item: cel = zadanie', () => {
    const entry = notificationEntry(
      base({ id: 'n3', type: 'bin_item', payload: { taskId: 't1', projectId: 'p1' } }),
      { actorName: '', taskTitle: 'Retusz', projectName: 'Kampania', commentBody: '' },
    );
    expect(entry.title).toBe('Nowa praca w zasobniku: „Retusz”');
    expect(entry.target).toEqual({ kind: 'task', taskId: 't1' });
  });

  it('bin_item: nieznany aktor => „Ktoś", nieznany projekt => „—"', () => {
    const entry = notificationEntry(
      base({ id: 'n3', type: 'bin_item', payload: { taskId: 't1' } }),
      { actorName: '', taskTitle: 'Retusz', projectName: '', commentBody: '' },
    );
    expect(entry.preview).toEqual({ who: 'Ktoś', what: 'Retusz', where: '—' });
    expect(entry.openLabel).toBe('Otwórz zadanie');
  });

  it('braki nazw degradują się miękko (aktor => „Ktoś", encja => „—")', () => {
    const entry = notificationEntry(
      base({ id: 'n4', type: 'task_assigned', payload: {} }),
      { actorName: '', taskTitle: '', projectName: '', commentBody: '' },
    );
    expect(entry.title).toBe('Ktoś przypisał(a) Ci zadanie „—”');
    expect(entry.when).toBeUndefined();
    expect(entry.target).toBeUndefined();
    expect(entry.preview).toEqual({ who: 'Ktoś', what: '—', where: '—' });
  });

  it('pusty payload: brak celu => brak etykiety „otwórz"', () => {
    const entry = notificationEntry(
      base({ id: 'n5', type: 'project_comment', payload: {} }),
      { actorName: 'Tomek', taskTitle: '', projectName: 'Kampania', commentBody: 'Hej' },
    );
    expect(entry.target).toBeUndefined();
    expect(entry.openLabel).toBeUndefined();
    expect(entry.preview.body).toBe('Hej');
  });
});

describe('teamHeaderLabel', () => {
  it('is bare when there are no coworkers', () => {
    expect(teamHeaderLabel(0)).toBe('Zespół');
  });

  it('counts a single coworker', () => {
    expect(teamHeaderLabel(1)).toBe('Zespół (1)');
  });

  it('counts many coworkers', () => {
    expect(teamHeaderLabel(7)).toBe('Zespół (7)');
  });
});

describe('dashTileView (kafelek pusty => belka)', () => {
  it('Powiadomienia z treścią: pełna karta, sam tytuł', () => {
    expect(dashTileView('notifications', true)).toEqual({
      collapsed: false,
      label: 'Powiadomienia',
    });
  });

  it('Powiadomienia bez treści: belka z opisem stanu', () => {
    expect(dashTileView('notifications', false)).toEqual({
      collapsed: true,
      label: 'Powiadomienia — brak nowych',
    });
  });

  it('Alerty z treścią: pełna karta, sam tytuł', () => {
    expect(dashTileView('alerts', true)).toEqual({ collapsed: false, label: 'Alerty' });
  });

  it('Alerty bez treści: belka „czysto ✓"', () => {
    expect(dashTileView('alerts', false)).toEqual({ collapsed: true, label: 'Alerty — czysto ✓' });
  });

  it('zwinięcie zależy WYŁĄCZNIE od braku treści, nie od kafelka', () => {
    for (const id of ['notifications', 'alerts'] as const) {
      expect(dashTileView(id, true).collapsed).toBe(false);
      expect(dashTileView(id, false).collapsed).toBe(true);
      expect(dashTileView(id, false).label).not.toBe(dashTileView(id, true).label);
    }
  });
});

describe('binPlanCtaLabel', () => {
  it('bez wiersza (pusty zasobnik) => etykieta ogólna', () => {
    expect(binPlanCtaLabel()).toBe('Zaplanuj w kalendarzu');
  });

  it('konkret: godziny + tytuł zadania', () => {
    expect(binPlanCtaLabel({ title: 'Montaż', hours: 2 })).toBe('Zaplanuj 2h — Montaż');
  });

  it('godziny formatuje wspólny helper (kwadranse)', () => {
    expect(binPlanCtaLabel({ title: 'Retusz', hours: 1.25 })).toBe('Zaplanuj 1h 15m — Retusz');
  });

  it('pusty tytuł albo zerowe godziny => etykieta ogólna (CTA nie kłamie)', () => {
    expect(binPlanCtaLabel({ title: '   ', hours: 2 })).toBe('Zaplanuj w kalendarzu');
    expect(binPlanCtaLabel({ title: 'Montaż', hours: 0 })).toBe('Zaplanuj w kalendarzu');
    expect(binPlanCtaLabel({ title: 'Montaż', hours: -1 })).toBe('Zaplanuj w kalendarzu');
  });

  it('bardzo długi tytuł skraca się wielokropkiem', () => {
    const label = binPlanCtaLabel({ title: 'A'.repeat(60), hours: 3 });
    expect(label.startsWith('Zaplanuj 3h — ')).toBe(true);
    expect(label.endsWith('…')).toBe(true);
    expect(label).toBe(`Zaplanuj 3h — ${'A'.repeat(39)}…`);
  });

  it('tytuł na granicy długości zostaje nietknięty', () => {
    const title = 'B'.repeat(40);
    expect(binPlanCtaLabel({ title, hours: 1 })).toBe(`Zaplanuj 1h — ${title}`);
  });
});

describe('mobileDashboardOrder', () => {
  const noFlags: MobileDashFlags = {
    hasToday: false,
    hasAlerts: false,
    hasNotifications: false,
    hasBin: false,
    hasCoworkers: false,
  };
  const allFlags: MobileDashFlags = {
    hasToday: true,
    hasAlerts: true,
    hasNotifications: true,
    hasBin: true,
    hasCoworkers: true,
  };

  it('renders every tile in the purpose order when everything has content', () => {
    expect(mobileDashboardOrder(allFlags)).toEqual([
      'today',
      'alerts',
      'notifications',
      'workload',
      'bin',
      'week',
      'team',
    ]);
  });

  it('keeps only obciążenie + tydzień when every tile would be an empty state', () => {
    expect(mobileDashboardOrder(noFlags)).toEqual(['workload', 'week']);
  });

  it('adds Zadania na dziś in front of the always-on tiles', () => {
    expect(mobileDashboardOrder({ ...noFlags, hasToday: true })).toEqual([
      'today',
      'workload',
      'week',
    ]);
  });

  it('slots Alerty before the workload line', () => {
    expect(mobileDashboardOrder({ ...noFlags, hasAlerts: true })).toEqual([
      'alerts',
      'workload',
      'week',
    ]);
  });

  it('slots Powiadomienia before the workload line', () => {
    expect(mobileDashboardOrder({ ...noFlags, hasNotifications: true })).toEqual([
      'notifications',
      'workload',
      'week',
    ]);
  });

  it('slots Zasobnik between the workload line and the week', () => {
    expect(mobileDashboardOrder({ ...noFlags, hasBin: true })).toEqual([
      'workload',
      'bin',
      'week',
    ]);
  });

  it('puts Zespół last', () => {
    expect(mobileDashboardOrder({ ...noFlags, hasCoworkers: true })).toEqual([
      'workload',
      'week',
      'team',
    ]);
  });

  it('keeps attention tiles in the Alerty → Powiadomienia order', () => {
    expect(mobileDashboardOrder({ ...allFlags, hasToday: false, hasBin: false })).toEqual([
      'alerts',
      'notifications',
      'workload',
      'week',
      'team',
    ]);
  });
});

describe('workloadSummaryLine', () => {
  const calm = { booked: 4, available: 8, over: false };

  it('joins both segments with a middle dot', () => {
    expect(workloadSummaryLine(calm, { booked: 22, available: 40, over: false })).toBe(
      'Dziś 4h / 8h · Ten tydzień 22h / 40h',
    );
  });

  it('marks only the overloaded day', () => {
    expect(
      workloadSummaryLine({ booked: 9, available: 8, over: true }, { booked: 22, available: 40, over: false }),
    ).toBe('⚠ Dziś 9h / 8h · Ten tydzień 22h / 40h');
  });

  it('marks only the overloaded week', () => {
    expect(workloadSummaryLine(calm, { booked: 44, available: 40, over: true })).toBe(
      'Dziś 4h / 8h · ⚠ Ten tydzień 44h / 40h',
    );
  });

  it('marks both segments when both are overloaded', () => {
    expect(
      workloadSummaryLine({ booked: 4, available: 0, over: true }, { booked: 44, available: 40, over: true }),
    ).toBe('⚠ Dziś 4h / 0h · ⚠ Ten tydzień 44h / 40h');
  });

  it('formats partial hours with the shared duration helper', () => {
    expect(workloadSummaryLine({ booked: 2.75, available: 8, over: false }, calm)).toBe(
      'Dziś 2h 45m / 8h · Ten tydzień 4h / 8h',
    );
  });
});
