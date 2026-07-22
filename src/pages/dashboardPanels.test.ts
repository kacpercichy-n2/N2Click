// Unit tests for the pure Panel helper module (dashboardPanels): the
// notification visibility cap (max 3) and the Zespół header counter label.
// Pure — no React, no localStorage.
import { describe, expect, it } from 'vitest';
import {
  MAX_NOTIFICATIONS,
  teamHeaderLabel,
  visibleNotifications,
  type NotificationEntry,
} from './dashboardPanels';

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
