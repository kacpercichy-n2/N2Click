// Pure read-only validation predicates for reducer command payloads. The reducer
// stays the sole mutation boundary — these only INSPECT state and reject
// (returning the original state reference) stale-ID, missing-title,
// dangling-reference and malformed-estimate commands before any activity row is
// appended. Draft types come via a TYPE-ONLY import from AppStore so there is no
// runtime import cycle (AppStore imports these functions at runtime).
import type { AppData, Project } from '../types';
import {
  isProjectDocumentKind,
  normalizeProjectDocumentUrl,
} from '../utils/projectDocuments';
import { isTicketKind, isTicketPriority, isTicketStatus } from '../utils/tickets';
import type {
  TaskDraft,
  ProjectDraft,
  ProjectDocumentDraft,
  PersonDraft,
  TicketDraft,
} from './AppStore';

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
 *  - create: draft.clientId must reference an existing client (client creation
 *    lives ONLY in the Klienci module);
 *  - edit: draft.clientId must exist OR be strictly EQUAL to existing.clientId
 *    (a legacy orphan project must remain editable, but a SWITCH to a dangling
 *    client is rejected). */
export function isValidProjectDraft(
  state: AppData,
  draft: ProjectDraft,
  existing: Project | null,
): boolean {
  if (!isRequiredName(draft.name)) return false;
  if (!hasEntity(state, 'status', draft.statusId)) return false;
  if (hasEntity(state, 'client', draft.clientId)) return true;
  return existing !== null && draft.clientId === existing.clientId;
}

/** Contact-carrying client payload shared by ADD_CLIENT (optional fields) and
 *  SAVE_CLIENT (always present). Missing === empty. */
export interface ClientContactDraft {
  name: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}

/** Client: name required, contact person required, and AT LEAST ONE contact
 *  channel (e-mail OR phone). Deliberately NO e-mail format/regex check —
 *  this is a data-completeness rule, not a format or security boundary, so a
 *  legacy value must never be rejected for its shape (valid-legacy rule).
 *  Only NEW writes are gated: load/repair never routes through the reducer, so
 *  clients persisted before this rule stay readable and untouched. */
export function isValidClientDraft(draft: ClientContactDraft): boolean {
  return (
    isRequiredName(draft.name) &&
    isRequiredName(draft.contactName ?? '') &&
    (isRequiredName(draft.contactEmail ?? '') || isRequiredName(draft.contactPhone ?? ''))
  );
}

/**
 * Dokument projektu: `kind` ze stałego zbioru i `url`, który przechodzi
 * normalizację schematu (`normalizeProjectDocumentUrl`: wymagany niepusty adres
 * o schemacie `http:`/`https:`, adres bez schematu dostaje `https://`).
 * `label` jest opcjonalna — UI pokazuje wtedy sam adres.
 *
 * Schemat jest walidowany CELOWO: projekty są danymi współdzielonymi w
 * organizacji, więc adres jednej osoby renderuje się jako klikalny `href` u
 * innych — dopuszczenie `javascript:`/`data:` byłoby przechowywanym XSS-em.
 *
 * Zwraca ZNORMALIZOWANY draft (przycięta etykieta, adres ze schematem) albo
 * `null`, gdy komenda ma zostać odrzucona => reduktor oddaje TĘ SAMĄ referencję
 * stanu (inwariant 6). Jedno źródło prawdy: reduktor bierze stąd wartość do
 * zapisu, UI tę samą regułę w postaci `isValidProjectDocumentDraft`.
 */
export function normalizeProjectDocumentDraft(
  draft: ProjectDocumentDraft,
): { kind: ProjectDocumentDraft['kind']; label: string; url: string } | null {
  if (!isProjectDocumentKind(draft.kind)) return null;
  const url = normalizeProjectDocumentUrl(draft.url);
  if (url === null) return null;
  return { kind: draft.kind, label: draft.label.trim(), url };
}

export function isValidProjectDocumentDraft(draft: ProjectDocumentDraft): boolean {
  return normalizeProjectDocumentDraft(draft) !== null;
}

/** firstName required (non-empty after trim). Nothing else: capacity already
 *  self-heals to DEFAULT_CAPACITY, supervisor cycles are guarded elsewhere. */
export function isValidPersonDraft(draft: PersonDraft): boolean {
  return isRequiredName(draft.firstName);
}

/**
 * Zgłoszenie: wymagane `title` i `description` (po trim), `reporterId` musi
 * wskazywać istniejącą osobę, a `kind`/`priority` muszą należeć do swoich
 * zbiorów. `area` jest opcjonalne. Niespełnienie => reduktor zwraca TĘ SAMĄ
 * referencję stanu (inwariant 6). `status` nie jest częścią draftu: nowe
 * zgłoszenie startuje jako 'nowe', a zmianę statusu robi SET_TICKET_STATUS.
 */
export function isValidTicketDraft(state: AppData, draft: TicketDraft): boolean {
  return (
    isRequiredName(draft.title) &&
    isRequiredName(draft.description) &&
    hasEntity(state, 'person', draft.reporterId) &&
    isTicketKind(draft.kind) &&
    isTicketPriority(draft.priority)
  );
}

/** Status zgłoszenia należy do stałego zbioru wartości. */
export function isValidTicketStatus(value: unknown): boolean {
  return isTicketStatus(value);
}
