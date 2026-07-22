// Pure read-only validation predicates for reducer command payloads. The reducer
// stays the sole mutation boundary — these only INSPECT state and reject
// (returning the original state reference) stale-ID, missing-title,
// dangling-reference and malformed-estimate commands before any activity row is
// appended. Draft types come via a TYPE-ONLY import from AppStore so there is no
// runtime import cycle (AppStore imports these functions at runtime).
import type {
  AppData,
  ClientContact,
  FilterPage,
  FilterViewKey,
  LastViewFilter,
  Project,
  SavedFilterCriteria,
  TaskPriority,
  TaskRecurrence,
} from '../types';
import {
  isProjectDocumentKind,
  normalizeProjectDocumentUrl,
} from '../utils/projectDocuments';
import { isTicketKind, isTicketPriority, isTicketStatus } from '../utils/tickets';
import { TASK_PRIORITIES } from '../utils/priority';
import { isValidDateStr } from '../utils/dates';
import { DAY_MINUTES, MINUTE_STEP } from '../utils/time';
import { isoWeekday, normalizeRecurrence } from '../utils/recurrence';
import type {
  TaskDraft,
  ProjectDraft,
  ProjectDocumentDraft,
  PersonDraft,
  TicketDraft,
  EventDraft,
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

/** True when a workload entry (day block or bin row) with this id exists. Guards
 *  SET_BLOCK_DONE next to SET_TASK_STATUS: an unknown entryId returns the same
 *  state reference (invariant 6). Separate from `hasEntity` because workload is
 *  not a RefEntityKind (a block has no display name and never gets referenced). */
export function hasWorkloadEntry(state: AppData, entryId: string): boolean {
  return state.workload.some((w) => w.id === entryId);
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
 *  SAVE_CLIENT (always present). Missing === empty. `contacts` (when present)
 *  are the DODATKOWE osoby kontaktowe; strict-validated by isValidClientContacts. */
export interface ClientContactDraft {
  name: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contacts?: unknown;
}

/** Client: name required, contact person required, and BOTH contact channels
 *  (e-mail AND phone) present — this tightened the earlier "e-mail OR phone"
 *  rule. Deliberately NO e-mail format/regex check — this is a data-completeness
 *  rule, not a format or security boundary, so a legacy value must never be
 *  rejected for its shape (valid-legacy rule); only NEW writes are gated, and a
 *  legacy client is simply asked to complete the missing channel on its next
 *  edit. `contacts`, when present, must pass strict isValidClientContacts. */
export function isValidClientDraft(draft: ClientContactDraft): boolean {
  return (
    isRequiredName(draft.name) &&
    isRequiredName(draft.contactName ?? '') &&
    isRequiredName(draft.contactEmail ?? '') &&
    isRequiredName(draft.contactPhone ?? '') &&
    (draft.contacts === undefined || isValidClientContacts(draft.contacts))
  );
}

/** STRICT reducer gate for the additional-contacts array: an array whose every
 *  row is an object with a non-empty unique string `id`, non-blank `firstName`
 *  and `lastName` (after trim), and string `phone`/`email` (missing === ''). No
 *  shape checks on phone/e-mail (valid-legacy). An empty array is valid — the
 *  reducer only STORES a non-empty array, but the gate accepts []. */
export function isValidClientContacts(value: unknown): value is ClientContact[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return false;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id === '' || ids.has(r.id)) return false;
    ids.add(r.id);
    if (typeof r.firstName !== 'string' || r.firstName.trim() === '') return false;
    if (typeof r.lastName !== 'string' || r.lastName.trim() === '') return false;
    if (r.phone !== undefined && typeof r.phone !== 'string') return false;
    if (r.email !== undefined && typeof r.email !== 'string') return false;
  }
  return true;
}

/** LENIENT load/hydration cleaner for the additional-contacts array. Non-array →
 *  undefined. Per row: drop unless an object with a non-empty string `id`;
 *  coerce non-string firstName/lastName/phone/email to ''; trim all four; drop a
 *  row whose firstName AND lastName are both empty; dedupe by id (first wins).
 *  Empty result → undefined (canonical key-omitted-when-empty). Deterministic
 *  and idempotent: sanitize(sanitize(x)) ≡ sanitize(x). */
export function sanitizeClientContacts(value: unknown): ClientContact[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const out: ClientContact[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id === '' || seen.has(r.id)) continue;
    const firstName = str(r.firstName).trim();
    const lastName = str(r.lastName).trim();
    if (firstName === '' && lastName === '') continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      firstName,
      lastName,
      phone: str(r.phone).trim(),
      email: str(r.email).trim(),
    });
  }
  return out.length > 0 ? out : undefined;
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

// ---- Wydarzenia kalendarza (spotkania) --------------------------------------

/** Minuta startu na siatce 15 min, w dobie z miejscem na min. 15-minutowy czas
 *  (0..1425). */
function isValidStartMinutes(m: unknown): m is number {
  return (
    typeof m === 'number' &&
    Number.isInteger(m) &&
    m >= 0 &&
    m <= DAY_MINUTES - MINUTE_STEP &&
    m % MINUTE_STEP === 0
  );
}

/** Czas trwania na siatce 15 min (15..1440). */
function isValidDurationMinutes(m: unknown): m is number {
  return (
    typeof m === 'number' &&
    Number.isInteger(m) &&
    m >= MINUTE_STEP &&
    m <= DAY_MINUTES &&
    m % MINUTE_STEP === 0
  );
}

/**
 * FORMA KANONICZNA cykliczności wydarzenia (decyzja 2). Czas wydarzenia JEST
 * czasem reguły — nadpisujemy `startMinutes`/`durationMinutes` reguły wartościami
 * wydarzenia PRZED normalizacją. Zwraca kanoniczną regułę TYLKO gdy jest poprawna
 * strukturalnie i `daysOfWeek` zawiera dzień tygodnia kotwicy (baza zawsze
 * widoczna); inaczej `undefined` (repair/hydracja USUWAJĄ klucz, reduktor
 * odrzuca draft). REUŻYWA `normalizeRecurrence` — bez drugiej implementacji.
 */
export function canonicalEventRecurrence(
  raw: unknown,
  date: string,
  startMinutes: number,
  durationMinutes: number,
): TaskRecurrence | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  if (!isValidDateStr(date)) return undefined;
  const forced = { ...(raw as Record<string, unknown>), startMinutes, durationMinutes };
  const rule = normalizeRecurrence(forced, date);
  if (rule === undefined) return undefined;
  // Baza (dzień tygodnia kotwicy) musi być wśród dni reguły, inaczej wydarzenie
  // bazowe nie byłoby wystąpieniem własnej reguły.
  if (!rule.daysOfWeek.includes(isoWeekday(date))) return undefined;
  return rule;
}

/** Znormalizowany draft wydarzenia gotowy do zapisania przez reduktor. */
export interface NormalizedEventDraft {
  title: string;
  description: string;
  location: string;
  meetingUrl: string;
  date: string;
  startMinutes: number;
  durationMinutes: number;
  attendeeIds: string[];
  recurrence?: TaskRecurrence;
}

/**
 * Waliduje i normalizuje draft wydarzenia. Zwraca ZNORMALIZOWANY ładunek (trim
 * tytułu/opisu/lokalizacji, dedupe uczestników, adres znormalizowany, reguła
 * kanoniczna) albo `null`, gdy komenda ma zostać ODRZUCONA => reduktor oddaje TĘ
 * SAMĄ referencję stanu (inwariant 6). Odrzucenia: pusty tytuł, zła data, czas
 * poza siatką 15 min / poza dobą, `attendeeIds` niebędące tablicą stringów
 * istniejących w `people`, `meetingUrl` niepusty odrzucony przez schemat,
 * cykliczność zażądana lecz niekanoniczna (brak dnia kotwicy albo strukturalnie
 * zła).
 */
export function normalizeEventDraft(
  state: AppData,
  draft: EventDraft,
): NormalizedEventDraft | null {
  const title = draft.title.trim();
  if (title === '') return null;
  if (!isValidDateStr(draft.date)) return null;
  if (!isValidStartMinutes(draft.startMinutes)) return null;
  if (!isValidDurationMinutes(draft.durationMinutes)) return null;
  if (draft.startMinutes + draft.durationMinutes > DAY_MINUTES) return null;

  if (!Array.isArray(draft.attendeeIds)) return null;
  const attendeeIds: string[] = [];
  const seen = new Set<string>();
  for (const id of draft.attendeeIds) {
    if (typeof id !== 'string') return null;
    if (!hasEntity(state, 'person', id)) return null; // dangling => odrzuć (reduktor)
    if (seen.has(id)) continue;
    seen.add(id);
    attendeeIds.push(id);
  }

  let meetingUrl = '';
  if (draft.meetingUrl.trim() !== '') {
    const normalized = normalizeProjectDocumentUrl(draft.meetingUrl);
    if (normalized === null) return null;
    meetingUrl = normalized;
  }

  let recurrence: TaskRecurrence | undefined;
  if (draft.recurrence !== null && draft.recurrence !== undefined) {
    recurrence = canonicalEventRecurrence(
      draft.recurrence,
      draft.date,
      draft.startMinutes,
      draft.durationMinutes,
    );
    if (recurrence === undefined) return null; // zażądano cykliczności, ale zła
  }

  return {
    title,
    description: draft.description.trim(),
    location: draft.location.trim(),
    meetingUrl,
    date: draft.date,
    startMinutes: draft.startMinutes,
    durationMinutes: draft.durationMinutes,
    attendeeIds,
    ...(recurrence ? { recurrence } : {}),
  };
}

/** UI-owa forma reguły dla bramki „Zapisz” (jedno źródło prawdy z reduktorem). */
export function isValidEventDraft(state: AppData, draft: EventDraft): boolean {
  return normalizeEventDraft(state, draft) !== null;
}

// ---- Filtry: sanityzacja kryteriów i „ostatnio użytego” filtra ---------------
// Czyste helpery współdzielone przez reduktor (`SET_LAST_FILTER`,
// `SAVE_FILTER_PRESET`) i repair wczytania (storage.ts). Trzymane TU (a nie w
// selectors/storage), bo storage może je reużyć bez cyklu importów: ten moduł
// zależy tylko od `types` (type-only), `utils/*` — nigdy od `storage`/`selectors`.

/** Widoki zapamiętywanych filtrów — stały zbiór (patrz `FilterViewKey`). */
export const FILTER_VIEW_KEYS: readonly FilterViewKey[] = [
  'projects',
  'tasks',
  'kanban',
  'workload',
  'calendar',
  'timeline',
];

export function isFilterViewKey(value: unknown): value is FilterViewKey {
  return typeof value === 'string' && (FILTER_VIEW_KEYS as readonly string[]).includes(value);
}

/** Strony obsługujące nazwane presety filtrów (`SavedFilter.page`). */
const FILTER_PAGES: readonly FilterPage[] = ['projects', 'tasks', 'kanban'];

export function isFilterPage(value: unknown): value is FilterPage {
  return typeof value === 'string' && (FILTER_PAGES as readonly string[]).includes(value);
}

// Dozwolone wartości filtra planowania. Kopia `PLANNING_STATUSES` z selectors.ts —
// tu jako stały zbiór, bo import selectors dałby cykl (selectors → storage →
// commandValidation). Jeśli etykiety planowania kiedyś się zmienią, zaktualizuj
// oba miejsca.
const PLANNING_FILTER_VALUES: readonly string[] = [
  'nie rozplanowano',
  'częściowo',
  'rozplanowano',
  'przekroczono',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function dedupeStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== 'string' || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Buduje poprawne `SavedFilterCriteria` z surowej wartości (nieznane pola pomijane,
 * brakujące dostają wartość „wszystko”). Sanityzacja referencji jak w
 * `normalizeTaskMeta`: dangling `projectId`/`workCategoryId` → '', `priority` spoza
 * enuma → '', niepoprawne `from`/`to` → ''. Deterministyczne i idempotentne po
 * wartości. Nie importuje `DEFAULT_FILTER_CRITERIA` (unika cyklu ze storage) —
 * pola są wypisane jawnie.
 */
export function sanitizeFilterCriteria(state: AppData, raw: unknown): SavedFilterCriteria {
  const obj = isPlainObject(raw) ? raw : {};
  const paid: SavedFilterCriteria['paid'] =
    obj.paid === 'paid' || obj.paid === 'unpaid' ? obj.paid : 'all';
  const priorityRaw = obj.priority;
  const priority: '' | TaskPriority =
    typeof priorityRaw === 'string' && (TASK_PRIORITIES as readonly string[]).includes(priorityRaw)
      ? (priorityRaw as TaskPriority)
      : '';
  const rawProjectId = asString(obj.projectId);
  const projectId =
    rawProjectId !== '' && hasEntity(state, 'project', rawProjectId) ? rawProjectId : '';
  const rawCategory = asString(obj.workCategoryId);
  const workCategoryId =
    rawCategory !== '' && state.workCategories.some((c) => c.id === rawCategory) ? rawCategory : '';
  // Spółka (additive 2026-07-22): dangling id → '' — jak workCategoryId.
  const rawCompany = asString(obj.companyId);
  const companyId =
    rawCompany !== '' && state.companies.some((c) => c.id === rawCompany) ? rawCompany : '';
  const from = isValidDateStr(asString(obj.from)) ? asString(obj.from) : '';
  const to = isValidDateStr(asString(obj.to)) ? asString(obj.to) : '';
  return {
    paid,
    clientId: asString(obj.clientId),
    projectId,
    statusId: asString(obj.statusId),
    personId: asString(obj.personId),
    priority,
    workCategoryId,
    companyId,
    from,
    to,
  };
}

/**
 * Sanityzuje jeden `LastViewFilter`: kryteria przez `sanitizeFilterCriteria`,
 * `personIds` do zdeduplikowanej tablicy stringów, `departmentId`/`serviceTypeId`
 * do stringów, `planning` do wartości z enuma (nieznane → ''). Zawsze zwraca
 * poprawny obiekt (leniwie koeruje) — struktury pilnuje `isStructuralLastViewFilter`.
 */
export function sanitizeLastViewFilter(state: AppData, raw: unknown): LastViewFilter {
  const obj = isPlainObject(raw) ? raw : {};
  const personIds = Array.isArray(obj.personIds) ? dedupeStrings(obj.personIds) : [];
  const planning = PLANNING_FILTER_VALUES.includes(asString(obj.planning))
    ? asString(obj.planning)
    : '';
  return {
    criteria: sanitizeFilterCriteria(state, obj.criteria),
    personIds,
    departmentId: asString(obj.departmentId),
    serviceTypeId: asString(obj.serviceTypeId),
    planning,
  };
}

/**
 * Strażnik STRUKTURY dla ładunku reduktora `SET_LAST_FILTER`: obiekt z obiektowym
 * `criteria` i tablicowym `personIds`. Strukturalnie zniekształcony ładunek =>
 * reduktor zwraca TĘ SAMĄ referencję stanu (inwariant 6). (Repair wczytania jest
 * leniwy i nie używa tego strażnika.)
 */
export function isStructuralLastViewFilter(raw: unknown): boolean {
  return isPlainObject(raw) && isPlainObject(raw.criteria) && Array.isArray(raw.personIds);
}

/** Równość PO WARTOŚCI dwóch `LastViewFilter` — do wykrywania no-op zapisu. */
export function lastViewFilterEqual(a: LastViewFilter, b: LastViewFilter): boolean {
  if (a.departmentId !== b.departmentId) return false;
  if (a.serviceTypeId !== b.serviceTypeId) return false;
  if (a.planning !== b.planning) return false;
  if (a.personIds.length !== b.personIds.length) return false;
  for (let i = 0; i < a.personIds.length; i++) {
    if (a.personIds[i] !== b.personIds[i]) return false;
  }
  const ca = a.criteria;
  const cb = b.criteria;
  return (
    ca.paid === cb.paid &&
    ca.clientId === cb.clientId &&
    ca.projectId === cb.projectId &&
    ca.statusId === cb.statusId &&
    ca.personId === cb.personId &&
    ca.priority === cb.priority &&
    ca.workCategoryId === cb.workCategoryId &&
    ca.companyId === cb.companyId &&
    ca.from === cb.from &&
    ca.to === cb.to
  );
}
