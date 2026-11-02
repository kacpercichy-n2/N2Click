// Unit tests for the pure notification helpers (utils/notifications): type guard
// and payload sanitization. No store, no SDK.
import { describe, expect, it } from 'vitest';
import {
  isNotificationType,
  notificationMessageCount,
  sanitizeNotificationPayload,
  taskConversationNotificationTitle,
} from './notifications';

describe('isNotificationType', () => {
  it('accepts the three known types', () => {
    expect(isNotificationType('task_assigned')).toBe(true);
    expect(isNotificationType('project_comment')).toBe(true);
    expect(isNotificationType('bin_item')).toBe(true);
  });

  it('rejects unknown / non-string values', () => {
    expect(isNotificationType('other')).toBe(false);
    expect(isNotificationType('')).toBe(false);
    expect(isNotificationType(null)).toBe(false);
    expect(isNotificationType(42)).toBe(false);
    expect(isNotificationType(undefined)).toBe(false);
  });
});

describe('sanitizeNotificationPayload', () => {
  it('keeps only known non-empty string keys', () => {
    expect(
      sanitizeNotificationPayload({
        taskId: 't1',
        projectId: 'p1',
        commentId: 'c1',
        actorId: 'a1',
      }),
    ).toEqual({ taskId: 't1', projectId: 'p1', commentId: 'c1', actorId: 'a1' });
  });

  it('drops unknown keys and empty / non-string values', () => {
    expect(
      sanitizeNotificationPayload({
        taskId: 't1',
        projectId: '',
        actorId: 5,
        extra: 'nope',
      }),
    ).toEqual({ taskId: 't1' });
  });

  it('returns {} for non-object input', () => {
    expect(sanitizeNotificationPayload(null)).toEqual({});
    expect(sanitizeNotificationPayload('x')).toEqual({});
    expect(sanitizeNotificationPayload([1, 2])).toEqual({});
    expect(sanitizeNotificationPayload(undefined)).toEqual({});
  });
});

it('accepts task chat types and preserves server message references', () => {
  expect(isNotificationType('task_message')).toBe(true);
  expect(isNotificationType('task_mention')).toBe(true);
  expect(sanitizeNotificationPayload({ taskId: 't', conversationId: 'c', messageId: 'm', actorId: 'a' }))
    .toEqual({ taskId: 't', conversationId: 'c', messageId: 'm', actorId: 'a' });
});

describe('zbiorczy task_message (count)', () => {
  it('sanitizer zachowuje dodatnią całkowitą liczbę wiadomości, odrzuca resztę', () => {
    expect(sanitizeNotificationPayload({ taskId: 't', count: 4 })).toEqual({ taskId: 't', count: 4 });
    for (const bad of [0, -1, 1.5, '3', Number.NaN, null]) {
      expect(sanitizeNotificationPayload({ taskId: 't', count: bad })).toEqual({ taskId: 't' });
    }
  });

  it('notificationMessageCount: brak albo zła wartość = 1', () => {
    expect(notificationMessageCount({ count: 7 })).toBe(7);
    expect(notificationMessageCount({})).toBe(1);
    expect(notificationMessageCount({ count: 0 })).toBe(1);
    expect(notificationMessageCount(null)).toBe(1);
  });

  it('polskie zdania z odmianą liczebnika', () => {
    const t = (count: number, actor = 'Ola Nowak') =>
      taskConversationNotificationTitle('task_message', actor, 'Key visual', count);
    expect(t(1)).toBe('Nowa wiadomość od Ola Nowak w zadaniu: Key visual');
    expect(t(1, '')).toBe('Nowa wiadomość w zadaniu: Key visual');
    expect(t(2)).toBe('2 nowe wiadomości w zadaniu: Key visual');
    expect(t(3)).toBe('3 nowe wiadomości w zadaniu: Key visual');
    expect(t(5)).toBe('5 nowych wiadomości w zadaniu: Key visual');
    expect(t(12)).toBe('12 nowych wiadomości w zadaniu: Key visual');
    expect(t(22)).toBe('22 nowe wiadomości w zadaniu: Key visual');
    expect(t(114)).toBe('114 nowych wiadomości w zadaniu: Key visual');
    expect(taskConversationNotificationTitle('task_mention', 'Ola Nowak', 'Key visual', 4)).toBe(
      'Ola Nowak wspomniał(a) Cię w zadaniu: Key visual',
    );
    expect(taskConversationNotificationTitle('task_mention', '', 'Key visual', 1)).toBe(
      'Ktoś wspomniał(a) Cię w zadaniu: Key visual',
    );
  });
});
