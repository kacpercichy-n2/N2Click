// Regression tests for the admin status-name draft commit (prompt 215): the
// input edits a local draft and hits the store only on commit — empty drafts
// revert (the reducer would reject them), unchanged names never dispatch (no
// per-keystroke persistence/cloud-sync spam), changed names save trimmed.
import { describe, expect, it } from 'vitest';
import { commitStatusName } from './statusNameDraft';

describe('commitStatusName', () => {
  it('reverts an empty or whitespace-only draft instead of dispatching', () => {
    expect(commitStatusName('', 'W toku')).toEqual({ kind: 'revert' });
    expect(commitStatusName('   ', 'W toku')).toEqual({ kind: 'revert' });
  });

  it('is a noop when the trimmed draft equals the store name', () => {
    expect(commitStatusName('W toku', 'W toku')).toEqual({ kind: 'noop', name: 'W toku' });
    expect(commitStatusName('  W toku  ', 'W toku')).toEqual({ kind: 'noop', name: 'W toku' });
  });

  it('saves a changed name trimmed', () => {
    expect(commitStatusName('  Akcept klienta ', 'W toku')).toEqual({
      kind: 'save',
      name: 'Akcept klienta',
    });
  });
});
