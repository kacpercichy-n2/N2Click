// Pure read-only validation predicates for reducer command payloads. The reducer
// stays the sole mutation boundary — these only INSPECT state and reject
// (returning the original state reference) stale-ID, missing-title,
// dangling-reference and malformed-estimate commands before any activity row is
// appended. Draft types come via a TYPE-ONLY import from AppStore so there is no
// runtime import cycle (AppStore imports these functions at runtime).
import type { AppData, Project } from '../types';
import type { TaskDraft, ProjectDraft, PersonDraft } from './AppStore';

export type RefEntityKind = 'task' | 'project' | 'milestone' | 'status' | 'person' | 'client';

/** True when an entity of `kind` with this id exists in state. */
export function hasEntity(state: AppData, kind: RefEntityKind, id: string): boolean {
  switch (kind) {
    case 'task':
      return state.tasks.some((t) => t.id === id);
    case 'project':
      return state.projects.some((p) => p.id === id);
    case 'milestone':
      return state.milestones.some((m) => m.id === id);
    case 'status':
      return state.statuses.some((s) => s.id === id);
    case 'person':
      return state.people.some((p) => p.id === id);
    case 'client':
      return state.clients.some((c) => c.id === id);
  }
}

/** Required display name/title: non-empty after trim. */
export function isRequiredName(value: string): boolean {
  return value.trim() !== '';
}

/** Task estimate: null (no estimate) OR a finite number >= 0. Deliberately NO
 *  quarter-grid check — legacy off-grid estimates (e.g. 5.1h) must keep
 *  round-tripping through an edit (valid-legacy rule). */
export function isValidEstimate(value: number | null): boolean {
  return value === null || (Number.isFinite(value) && value >= 0);
}

/** Title required; draft.projectId and draft.statusId must exist; estimate valid.
 *  Does NOT check dates — the existing periodError guard in saveTask owns that
 *  (compose, never duplicate). Does NOT check workCategoryId — saveTask
 *  self-heals a stale one to '' and that behavior must stay. */
export function isValidTaskDraft(state: AppData, draft: TaskDraft): boolean {
  return (
    isRequiredName(draft.title) &&
    hasEntity(state, 'project', draft.projectId) &&
    hasEntity(state, 'status', draft.statusId) &&
    isValidEstimate(draft.estimatedHours)
  );
}

/** Name required; draft.statusId must exist. Client rule:
 *  - create or edit: draft.clientId may exist, OR be '' with a non-empty
 *    trimmed newClientName (the atomic create/reuse-client path);
 *  - edit: draft.clientId must exist OR be strictly EQUAL to existing.clientId
 *    (a legacy orphan project must remain editable, but a SWITCH to a dangling
 *    client is rejected). */
export function isValidProjectDraft(
  state: AppData,
  draft: ProjectDraft,
  existing: Project | null,
  newClientName?: string,
): boolean {
  if (!isRequiredName(draft.name)) return false;
  if (!hasEntity(state, 'status', draft.statusId)) return false;
  if (hasEntity(state, 'client', draft.clientId)) return true;
  if (draft.clientId === '' && isRequiredName(newClientName ?? '')) return true;
  return existing !== null && draft.clientId === existing.clientId;
}

/** firstName required (non-empty after trim). Nothing else: capacity already
 *  self-heals to DEFAULT_CAPACITY, supervisor cycles are guarded elsewhere. */
export function isValidPersonDraft(draft: PersonDraft): boolean {
  return isRequiredName(draft.firstName);
}
