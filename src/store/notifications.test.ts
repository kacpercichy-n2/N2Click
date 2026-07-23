// Reducer + storage tests for in-app notifications:
//   * MARK_NOTIFICATION_READ / MARK_ALL_NOTIFICATIONS_READ (with invariant 6:
//     unknown id / already-read / nothing unread => SAME state reference).
//   * MERGE_CLOUD_NOTIFICATIONS authoritative replace, fail-closed + no-op keeps
//     the reference (invariant 6).
//   * repairNotifications drops invalid rows; the same-version load coerces a
//     non-array `notifications` to [].
import { describe, expect, it } from 'vitest';
import { reducer, type CloudNotificationsPayload } from './AppStore';
import { emptyData, repairNotifications } from './storage';
import type { AppData, Notification } from '../types';

const notif = (o: Partial<Notification> & { id: string }): Notification => ({
  recipientId: 'me',
  type: 'task_assigned',
  payload: {},
  readAt: '',
  createdAt: '2026-07-07T10:00:00.000Z',
  ...o,
});

function withNotifs(notifications: Notification[]): AppData {
  return { ...emptyData(), notifications };
}

describe('MARK_NOTIFICATION_READ', () => {
  it('stamps read_at on the matching unread row', () => {
    const state = withNotifs([notif({ id: 'n1' }), notif({ id: 'n2' })]);
    const next = reducer(state, { type: 'MARK_NOTIFICATION_READ', notificationId: 'n1' });
    expect(next).not.toBe(state);
    expect(next.notifications.find((n) => n.id === 'n1')!.readAt).not.toBe('');
    expect(next.notifications.find((n) => n.id === 'n2')!.readAt).toBe('');
  });

  it('unknown id keeps the same reference (invariant 6)', () => {
    const state = withNotifs([notif({ id: 'n1' })]);
    expect(reducer(state, { type: 'MARK_NOTIFICATION_READ', notificationId: 'ghost' })).toBe(state);
  });

  it('already-read row keeps the same reference (invariant 6)', () => {
    const state = withNotifs([notif({ id: 'n1', readAt: '2026-07-07T11:00:00.000Z' })]);
    expect(reducer(state, { type: 'MARK_NOTIFICATION_READ', notificationId: 'n1' })).toBe(state);
  });
});

describe('MARK_ALL_NOTIFICATIONS_READ', () => {
  it('stamps every unread row', () => {
    const state = withNotifs([
      notif({ id: 'n1' }),
      notif({ id: 'n2', readAt: '2026-07-07T11:00:00.000Z' }),
      notif({ id: 'n3' }),
    ]);
    const next = reducer(state, { type: 'MARK_ALL_NOTIFICATIONS_READ' });
    expect(next.notifications.every((n) => n.readAt !== '')).toBe(true);
    // Already-read row keeps its original stamp.
    expect(next.notifications.find((n) => n.id === 'n2')!.readAt).toBe('2026-07-07T11:00:00.000Z');
  });

  it('nothing unread keeps the same reference (invariant 6)', () => {
    const state = withNotifs([notif({ id: 'n1', readAt: '2026-07-07T11:00:00.000Z' })]);
    expect(reducer(state, { type: 'MARK_ALL_NOTIFICATIONS_READ' })).toBe(state);
  });
});

describe('MERGE_CLOUD_NOTIFICATIONS', () => {
  const merge = (state: AppData, payload: CloudNotificationsPayload): AppData =>
    reducer(state, { type: 'MERGE_CLOUD_NOTIFICATIONS', payload });

  it('authoritatively replaces the collection', () => {
    const state = withNotifs([notif({ id: 'old' })]);
    const next = merge(state, { notifications: [notif({ id: 'fresh', recipientId: 'me' })] });
    expect(next.notifications.map((n) => n.id)).toEqual(['fresh']);
  });

  it('value-identical payload returns the ORIGINAL reference (no flicker)', () => {
    const rows = [notif({ id: 'n1' })];
    const state = withNotifs(rows);
    // A fresh array with a value-identical row => reference-preserving no-op.
    const next = merge(state, { notifications: [notif({ id: 'n1' })] });
    expect(next).toBe(state);
  });

  it('non-array payload => same reference (invariant 6)', () => {
    const state = withNotifs([notif({ id: 'n1' })]);
    expect(merge(state, { notifications: null as unknown as Notification[] })).toBe(state);
  });

  it('structurally invalid row (missing recipientId / bad type) => same reference', () => {
    const state = withNotifs([notif({ id: 'n1' })]);
    const bad = [{ ...notif({ id: 'x' }), recipientId: '' }];
    expect(merge(state, { notifications: bad })).toBe(state);
    const badType = [{ ...notif({ id: 'y' }), type: 'nope' as Notification['type'] }];
    expect(merge(state, { notifications: badType })).toBe(state);
  });
});

describe('repairNotifications (storage)', () => {
  it('drops rows without id / recipientId / known type; sanitizes payload', () => {
    const data = withNotifs([
      notif({ id: 'ok', payload: { taskId: 't1', bogus: 'x' } as never }),
      notif({ id: '' }),
      { ...notif({ id: 'noRecipient' }), recipientId: '' },
      { ...notif({ id: 'badType' }), type: 'nope' as Notification['type'] },
    ]);
    const repaired = repairNotifications(data);
    expect(repaired.notifications.map((n) => n.id)).toEqual(['ok']);
    expect(repaired.notifications[0].payload).toEqual({ taskId: 't1' });
  });

  it('legacy load without the key yields [] (additive, no throw)', () => {
    const data = { ...emptyData() } as AppData;
    // Simulate a pre-field payload where notifications is absent.
    delete (data as Partial<AppData>).notifications;
    expect(repairNotifications(data).notifications).toEqual([]);
  });
});
