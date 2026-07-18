// Pure commit decision for the admin status-name draft (AdminPage). Statuses
// get the same local-draft treatment as SimpleListRow: the input edits a draft
// freely (including clearing it to retype) and hits the store ONLY on commit
// (blur/Enter) — never per keystroke, which previously spammed persistence and
// the cloud mirror while the reducer's empty-name rejection snapped the field
// back mid-edit.

export type StatusNameCommit =
  | { kind: 'revert' } // empty/whitespace — the reducer would reject; reseed from the store
  | { kind: 'noop'; name: string } // unchanged after trim — no dispatch
  | { kind: 'save'; name: string }; // dispatch SAVE_STATUS with the trimmed name

export function commitStatusName(draft: string, storeName: string): StatusNameCommit {
  const trimmed = draft.trim();
  if (trimmed === '') return { kind: 'revert' };
  if (trimmed === storeName) return { kind: 'noop', name: trimmed };
  return { kind: 'save', name: trimmed };
}
