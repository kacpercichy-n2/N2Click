// C — per-page context-hint dismissal: dismissing one page's first-time hint
// must not suppress every other page's hint.
import { describe, expect, it } from 'vitest';
import { dismissHintFor, isHintDismissed } from './hintState';

describe('context-hint per-page dismissal', () => {
  it('dismissing one page leaves other pages showable', () => {
    const dismissed = dismissHintFor(new Set<string>(), 'projects');
    expect(isHintDismissed(dismissed, 'projects')).toBe(true);
    expect(isHintDismissed(dismissed, 'kanban')).toBe(false);
    expect(isHintDismissed(dismissed, 'timeline')).toBe(false);
  });

  it('accumulates dismissals independently per module', () => {
    let dismissed = dismissHintFor(new Set<string>(), 'projects');
    dismissed = dismissHintFor(dismissed, 'kanban');
    expect(isHintDismissed(dismissed, 'projects')).toBe(true);
    expect(isHintDismissed(dismissed, 'kanban')).toBe(true);
    expect(isHintDismissed(dismissed, 'people')).toBe(false);
  });

  it('treats an undefined module (no route hint) as not dismissed', () => {
    expect(isHintDismissed(new Set<string>(), undefined)).toBe(false);
  });

  it('does not mutate the input set', () => {
    const original = new Set<string>();
    dismissHintFor(original, 'projects');
    expect(original.size).toBe(0);
  });
});
