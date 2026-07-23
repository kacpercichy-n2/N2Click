// Unit tests for the pure notification helpers (utils/notifications): type guard
// and payload sanitization. No store, no SDK.
import { describe, expect, it } from 'vitest';
import { isNotificationType, sanitizeNotificationPayload } from './notifications';

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
