// Unit tests for the pure Panel helper module (dashboardPanels): the
// notification visibility cap (max 3) and the Zespół header counter label.
// Pure — no React, no localStorage.
import { describe, expect, it } from 'vitest';
import {
  MAX_NOTIFICATIONS,
  notificationEntry,
  teamHeaderLabel,
  visibleNotifications,
  type NotificationEntry,
} from './dashboardPanels';
import type { Notification } from '../types';

function entries(n: number): NotificationEntry[] {
  return Array.from({ length: n }, (_, i) => ({ id: `n${i}`, title: `Powiadomienie ${i}` }));
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
      { actorName: 'Kasia', taskTitle: 'Montaż', projectName: 'Kampania' },
    );
    expect(entry.title).toBe('Kasia przypisał(a) Ci zadanie „Montaż”');
    expect(entry.when).toBe('Kampania');
    expect(entry.target).toEqual({ kind: 'task', taskId: 't1' });
  });

  it('project_comment: cel = projekt', () => {
    const entry = notificationEntry(
      base({ id: 'n2', type: 'project_comment', payload: { projectId: 'p1', commentId: 'c1' } }),
      { actorName: 'Tomek', taskTitle: '', projectName: 'Kampania' },
    );
    expect(entry.title).toBe('Tomek skomentował(a) projekt „Kampania”');
    expect(entry.target).toEqual({ kind: 'project', projectId: 'p1' });
  });

  it('bin_item: cel = zadanie', () => {
    const entry = notificationEntry(
      base({ id: 'n3', type: 'bin_item', payload: { taskId: 't1', projectId: 'p1' } }),
      { actorName: '', taskTitle: 'Retusz', projectName: 'Kampania' },
    );
    expect(entry.title).toBe('Nowa praca w zasobniku: „Retusz”');
    expect(entry.target).toEqual({ kind: 'task', taskId: 't1' });
  });

  it('braki nazw degradują się miękko (aktor => „Ktoś", encja => „—")', () => {
    const entry = notificationEntry(
      base({ id: 'n4', type: 'task_assigned', payload: {} }),
      { actorName: '', taskTitle: '', projectName: '' },
    );
    expect(entry.title).toBe('Ktoś przypisał(a) Ci zadanie „—”');
    expect(entry.when).toBeUndefined();
    expect(entry.target).toBeUndefined();
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
