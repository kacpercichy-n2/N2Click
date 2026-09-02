// Single AppStore provider: Context + useReducer, persisting on every action.
// Every mutation is one reducer action; activity-log rows are appended inside
// the same action so the log can never drift from the data.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type {
  AccessRole,
  ActivityEntityType,
  ActivityEvent,
  AppData,
  CalendarEvent,
  ChecklistItem,
  ClientContact,
  ContentPlanBrand,
  ContentPlanComment,
  ContentPlanHistoryEntry,
  ContentPlanPost,
  CommentEntityType,
  Company,
  Department,
  FilterPage,
  FilterViewKey,
  JobTitle,
  LastViewFilter,
  Milestone,
  Notification,
  Person,
  Project,
  ProjectDocument,
  ProjectDocumentKind,
  ServiceType,
  Status,
  SavedFilterCriteria,
  Task,
  TaskAssignment,
  TaskPriority,
  TicketKind,
  TicketPriority,
  TicketStatus,
  WorkCategory,
  WorkloadEntry,
  TimeEntry,
  TimeEntrySource,
} from '../types';
import type { CloudMergePayload } from '../supabase/plannerData';
import type { CloudPersonMergeRow } from '../supabase/referenceData';
import { normalizeEmail } from '../auth/profile';
import {
  DEFAULT_CAPACITY,
  isOwnLastWrite,
  loadDataResult,
  sanitizeWorkDays,
  saveData,
  slugify,
  subscribeExternalChanges,
  type SaveFailureReason,
} from './storage';
import { anyDirty } from '../utils/dirtyRegistry';
import { createExternalStore, shallowEqual, type ExternalStore } from './externalStore';
import { createPersistCoalescer, PERSIST_COALESCE_MS } from './persistCoalescer';
import { shouldSkipLocalPersist } from './persistGate';
import {
  hasEntity,
  hasWorkloadEntry,
  isFilterPage,
  isFilterViewKey,
  isRequiredName,
  isStructuralLastViewFilter,
  isValidClientDraft,
  isValidPersonDraft,
  isValidProjectDraft,
  isValidTaskDraft,
  isValidTicketDraft,
  isValidTicketStatus,
  normalizeEventDraft,
  lastViewFilterEqual,
  normalizeProjectDocumentDraft,
  sanitizeClientContacts,
  sanitizeFilterCriteria,
  sanitizeLastViewFilter,
} from './commandValidation';
import {
  DEFAULT_TICKET_STATUS,
  isTicketKind,
  isTicketPriority,
  isTicketStatus,
} from '../utils/tickets';
import { isNotificationType } from '../utils/notifications';
import {
  contentPlanUid,
  isContentPlanReviewDecision,
  isContentPlanStatus,
  isContentPlanVisibility,
  isMonthKey,
  isPostInMonth,
  normalizeContentPlanBrandDraft,
  normalizeContentPlanPostDraft,
  reviewHistoryLabel,
  uniqueBrandId,
  validatePostForPublication,
  type ContentPlanBrandDraft,
  type ContentPlanPostDraft,
  type ContentPlanReviewDecision,
} from '../contentplan/domain';
import {
  activeStatuses,
  assignmentNotificationId,
  blockCollidesWithEvent,
  eventDraftConflicts,
  isDoneStatus,
  isDraftTask,
  mergeCoversEventOrRecurrence,
  notificationsForPerson,
  personHourlyVacationIntervals,
  personVacationOnDate,
  wouldCreateSupervisorCycle,
} from './selectors';
import { isOccurrenceDate, normalizeEventRsvps, normalizeRecurrence } from '../utils/recurrence';
import { copyTitle } from '../utils/taskCopyName';
import { isBoardMember } from './confidentiality';
import { ROLE_LABELS } from './permissions';
import { registerPersonOrder } from '../utils/colors';
import {
  MAX_TASK_PERIOD_DAYS,
  addDaysStr,
  eachDayInclusive,
  inclusiveDayCount,
  isValidDateStr,
  periodError,
} from '../utils/dates';
import {
  BIN_DATE,
  DAY_MINUTES,
  HOURS_STEP,
  MINUTE_STEP,
  blockEndMinutes,
  clampBlockStart,
  findFreeStart,
  formatDuration,
  formatMinutes,
  hasCollision,
  hoursToMinutes,
  isBinEntry,
  nextFreeStart,
  planRippleInsert,
  rangesOverlap,
  snapHours,
} from '../utils/time';
import { findOverlappingEntry, isValidTimeRange } from '../utils/timeTracking';
import {
  carveSpan,
  entryMatchesBlock,
  freeRangesWithin,
  planGrowth,
  portionFill,
  trackingBalance,
  uncoveredEntryGaps,
} from './timeTrackingSync';

// ---- Payload shapes ----

export interface TaskDraft {
  projectId: string;
  statusId: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  estimatedHours: number | null;
  priority: TaskPriority;
  workCategoryId: string;
  departmentId: string; // dział zadania; '' = brak (miękki fallback jak kategoria)
  checklist: ChecklistItem[];
  // Sygnał TWORZENIA szkicu (tylko przy taskId === null). Zadanie utworzone z
  // widoku projektu przychodzi z `isDraft: true` i NIE materializuje godzin.
  // Przy EDYCJI ignorowane — reduktor zachowuje `isDraft` istniejącego zadania,
  // więc formularz nie może przypadkiem opublikować ani cofnąć publikacji
  // (jedyna droga to akcje PUBLISH_*). Brak pola = zadanie opublikowane.
  isDraft?: boolean;
  // Utajnij treść (zarząd). Obecne = żądana wartość; brak = zachowaj istniejącą
  // (edycja) / publiczne (tworzenie). Honorowane WYŁĄCZNIE gdy bieżący
  // użytkownik jest zarządem (isBoardMember) — inaczej reduktor ignoruje pole
  // i zachowuje stan encji (obrona w głąb; UI i tak chowa checkbox).
  isConfidential?: boolean;
}

export interface ProjectDraft {
  clientId: string;
  name: string;
  description: string;
  statusId: string;
  paid: boolean;
  startDate: string;
  endDate: string;
  departmentId: string;
  serviceTypeId: string;
  /** Spółka wykonawcza ('' = brak); nieznane id jest koercjonowane do ''. */
  companyId: string;
  /** Utajnij treść — semantyka i bramka zarządu jak w `TaskDraft.isConfidential`. */
  isConfidential?: boolean;
}

/** Draft odnośnika do dokumentu projektu (karta „Dokumenty”). `id` NIE jest
 *  częścią draftu — nadaje go reduktor przy dodaniu, edycja adresuje wiersz
 *  osobnym `documentId`. */
export interface ProjectDocumentDraft {
  kind: ProjectDocumentKind;
  label: string;
  url: string;
}

/** Draft zgłoszenia (modal „Zgłoszenia”). `status` NIE jest częścią draftu:
 *  nowe zgłoszenie startuje jako 'nowe', zmianę robi SET_TICKET_STATUS. */
export interface TicketDraft {
  title: string;
  area: string;
  description: string;
  kind: TicketKind;
  priority: TicketPriority;
  reporterId: string;
}

/** Draft wydarzenia kalendarza (modal „Wydarzenia”). Pola modelu bez
 *  id/createdAt/updatedAt. `recurrence` niesie surową regułę z UI albo `null`
 *  (jednorazowe) — reduktor kanonikalizuje ją przez `normalizeEventDraft`.
 *  `kind: 'urlop'` przełącza draft w tryb urlopu: czasy są wtedy narzucane
 *  (0/1440), `endDate` niesie koniec zakresu, a cykliczność jest zabroniona. */
export interface EventDraft {
  title: string;
  description: string;
  location: string;
  meetingUrl: string;
  date: string;
  startMinutes: number;
  durationMinutes: number;
  attendeeIds: string[];
  recurrence: unknown | null;
  kind?: 'urlop';
  endDate?: string | null;
  /** Utajnij treść — semantyka i bramka zarządu jak w `TaskDraft.isConfidential`.
   *  Dla urlopu (`kind: 'urlop'`) zawsze ignorowane (flaga zabroniona). */
  isConfidential?: boolean;
}

export interface PersonDraft {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
  departmentId: string;
  // Spółka (przypisanie administratora). Wymagana w draftcie jak supervisorId;
  // '' = brak. `Person.companyId` pozostaje opcjonalne (zaszłości).
  companyId: string;
  avatar: string;
  capacity: number;
  accessRole: AccessRole;
  workDays: number[];
  workStartMinutes: number;
  workEndMinutes: number;
  supervisorId: string;
  // Data urodzenia (yyyy-MM-dd); '' gdy nieustawiona. Opcjonalna, walidowana na
  // repair przy wczytaniu (patrz migratePerson w storage.ts).
  birthDate: string;
  // Opt-in na powiadomienia mailowe. OPCJONALNE w draftcie (brak => false),
  // spójnie z `Person.emailNotifications`.
  emailNotifications?: boolean;
  // NOTE: passwordHash is intentionally NOT part of the draft — it is set only
  // via SET_PASSWORD so a profile save can never clobber a stored hash.
}

/**
 * One allocation cell to persist. `plannedHours` is the DESIRED DAY TOTAL for
 * that person on that date across ALL of the task's blocks on that day — not a
 * single block. `saveTask` reconciles this target against the pair's existing
 * blocks by delta (grow the last block / trim from the end / create / delete),
 * so multi-block days survive with byte-identical identity when unchanged.
 */
export interface AllocationCell {
  personId: string;
  date: string;
  plannedHours: number;
  /** OPCJONALNA przypięta godzina startu (minuty od północy, siatka 15 min).
   *  Brak => automatyczne umiejscowienie jak dotąd (findFreeStart). Stosowana
   *  tylko, gdy para (osoba, dzień) ma po zapisie DOKŁADNIE jeden blok. */
  startMinutes?: number;
}

export interface SaveTaskPayload {
  taskId: string | null; // null => create
  draft: TaskDraft;
  assigneeIds: string[]; // final set of assigned people
  allocations: AllocationCell[]; // full desired allocation for this task
  // Extra dateless hours to append to the bin (per person). Existing bin
  // entries pass through untouched; these are added on top.
  newUnassigned?: Array<{ personId: string; hours: number }>;
  // ABSOLUTNY cel zasobnika per osoba (godziny bez terminu po zapisie).
  // Wiersz zasobnika zachowuje tożsamość (invariant 4); cel 0 usuwa wiersz,
  // brak wiersza przy celu > 0 tworzy dokładnie jeden. Osoby spoza listy
  // przechodzą bez zmian. Stosowane PO newUnassigned (nadpisuje jego wynik).
  binTotals?: Array<{ personId: string; hours: number }>;
}

/**
 * Wpis czasu pracy (tracker). `newTask` zakłada zadanie W TEJ SAMEJ akcji
 * (atomowo, reużywa `saveTask`): tytuł + projekt (+ opcjonalna kategoria),
 * okres = dzień wpisu, status = pierwszy aktywny, bez godzin planowanych
 * (tracker nie planuje). `taskId` i `newTask` wykluczają się.
 */
export interface AddTimeEntryPayload {
  personId: string;
  taskId?: string;
  newTask?: { title: string; projectId: string; workCategoryId?: string };
  date: string;
  startMinutes: number;
  endMinutes: number;
  source: TimeEntrySource;
  eventId?: string;
  /**
   * Zgoda na „ponad sprzedane": gdy wykonanie pary (zadanie, osoba, dzień)
   * przekroczy plan, a zasobnik osoby i wolne sprzedane zadania nie pokrywają
   * nadwyżki, reduktor ODRZUCA wpis bez tej flagi (UI pyta dialogiem, patrz
   * `planGrowth`). Z flagą nadwyżka zapisuje się jako `overrunMinutes`.
   */
  acceptOverrun?: boolean;
}

export interface InsertBlockPayload {
  refEntryId: string; // the right-clicked block
  position: 'before' | 'after';
  taskId: string; // task the new block belongs to
  hours: number;
}

export type Action =
  | { type: 'SAVE_TASK'; payload: SaveTaskPayload }
  | { type: 'DELETE_TASK'; taskId: string }
  // Duplikat zadania — kopia treści + przypisań, godziny osób jako świeże
  // wiersze zasobnika (bez umiejscowienia w kalendarzu). `newTaskId` od
  // wywołującego, żeby UI mogło od razu otworzyć kopię.
  | { type: 'DUPLICATE_TASK'; taskId: string; newTaskId: string }
  | { type: 'MOVE_TASK'; taskId: string; dayDelta: number }
  | { type: 'SET_TASK_DATES'; taskId: string; startDate: string; endDate: string }
  | { type: 'SET_TASK_STATUS'; taskId: string; statusId: string }
  | { type: 'SET_BLOCK_DONE'; entryId: string; done: boolean }
  | { type: 'REORDER_PROJECT_TASK'; taskId: string; direction: -1 | 1 }
  // Cykliczność zadania: reguła (create / „edytuj wszystkie” / clear) i per-datowy
  // wyjątek („edytuj to wystąpienie”). Wystąpienia są WYŁĄCZNIE prezentacyjne —
  // nie tworzą wierszy workload (inwariant 1). Niepoprawne wejście => TA SAMA
  // referencja stanu (inwariant 6).
  | {
      type: 'SET_TASK_RECURRENCE';
      taskId: string;
      recurrence:
        | { daysOfWeek: number[]; startMinutes: number; durationMinutes: number; until?: string }
        | null;
    }
  | {
      type: 'SET_RECURRENCE_OVERRIDE';
      taskId: string;
      date: string;
      override: { skip: true } | { startMinutes: number; durationMinutes: number } | null;
    }
  // Wykonanie POJEDYNCZEGO wystąpienia (flaga `done` w wyjątku danej daty).
  // NIGDY nie zmienia `Task.statusId` (całą serię przełącza SET_TASK_STATUS) i
  // nie tworzy wierszy workload (inwariant 1).
  | { type: 'SET_OCCURRENCE_DONE'; taskId: string; date: string; done: boolean }
  // Publikacja szkiców: całego projektu (atomowo) lub pojedynczego zadania.
  | { type: 'PUBLISH_PROJECT_DRAFTS'; projectId: string }
  | { type: 'PUBLISH_TASK'; taskId: string }
  | { type: 'SAVE_PROJECT'; projectId: string | null; draft: ProjectDraft }
  | { type: 'DELETE_PROJECT'; projectId: string }
  | { type: 'SET_PROJECT_STATUS'; projectId: string; statusId: string }
  | { type: 'SET_PROJECT_PAID'; projectId: string; paid: boolean }
  | { type: 'SET_PROJECT_DATES'; projectId: string; startDate: string; endDate: string }
  // Dokumenty handlowe projektu (karta „Dokumenty”) — same odnośniki, bez plików.
  | { type: 'ADD_PROJECT_DOCUMENT'; projectId: string; draft: ProjectDocumentDraft }
  | { type: 'SAVE_PROJECT_DOCUMENT'; projectId: string; documentId: string; draft: ProjectDocumentDraft }
  | { type: 'DELETE_PROJECT_DOCUMENT'; projectId: string; documentId: string }
  | { type: 'SAVE_MILESTONE'; milestoneId: string | null; projectId: string; name: string; date: string }
  | { type: 'MOVE_MILESTONE'; milestoneId: string; date: string }
  | { type: 'DELETE_MILESTONE'; milestoneId: string }
  | { type: 'ADD_COMMENT'; entityType: CommentEntityType; entityId: string; body: string; mentionIds: string[] }
  // Oznacza feed powiadomień zalogowanej osoby jako przeczytany do teraz
  // (watermark) i czyści zbiór pojedynczych oznaczeń — ten sam stan wyraża
  // wtedy sam znacznik.
  | { type: 'MARK_NOTIFICATIONS_SEEN' }
  // Oznacza JEDEN wpis pochodnego feedu jako przeczytany ('mention:<commentId>'
  // / 'assignment:<taskId>:<personId>'); id spoza feedu albo już przeczytane => no-op.
  | { type: 'MARK_NOTIFICATION_ENTRY_READ'; entryId: string }
  // Tracker czasu pracy (wykonanie, osobno od planu). Straże => TA SAMA
  // referencja (inwariant 6): brak osoby/zadania/statusu, szkic albo zadanie
  // „zrobione", zły dzień lub zakres poza siatką 15 min, nachodzenie na inny
  // wpis tej osoby tego dnia. Bez wpisu w dzienniku aktywności.
  | { type: 'ADD_TIME_ENTRY'; payload: AddTimeEntryPayload }
  | {
      type: 'UPDATE_TIME_ENTRY';
      entryId: string;
      taskId: string;
      startMinutes: number;
      endMinutes: number;
      acceptOverrun?: boolean;
    }
  | { type: 'DELETE_TIME_ENTRY'; entryId: string }
  // „Przeszłość w kalendarzu = fakty": dla OSOBY i DNIA, które ona śledzi
  // (ma tego dnia ≥1 wpis), każdy niewykonany blok, którego koniec minął
  // o ≥15 min (`nowMinutes`; `null` = dzień miniony w całości), oddaje
  // niepokrytą część do zasobnika (blok kurczy się do pokrycia albo znika).
  // Bez zmian => TA SAMA referencja.
  | { type: 'SETTLE_TRACKED_DAY'; personId: string; date: string; nowMinutes: number | null }
  // Zgłoszenia zespołu („Zgłoszenia”). Kolekcja addytywna, bez powiązań kaskadowych.
  | { type: 'ADD_TICKET'; draft: TicketDraft }
  | { type: 'SAVE_TICKET'; ticketId: string; draft: TicketDraft }
  | { type: 'SET_TICKET_STATUS'; ticketId: string; status: TicketStatus }
  | { type: 'DELETE_TICKET'; ticketId: string }
  | { type: 'ADD_EVENT'; draft: EventDraft }
  | { type: 'SAVE_EVENT'; eventId: string; draft: EventDraft }
  | { type: 'DELETE_EVENT'; eventId: string }
  // Odpowiedź RSVP per (wystąpienie, osoba) wydarzenia CYKLICZNEGO:
  // 'yes' = potwierdzam, 'no' = nie biorę udziału (zwalnia slot),
  // null = wyczyść odpowiedź (powrót do „oczekuje").
  | {
      type: 'SET_EVENT_RSVP';
      eventId: string;
      date: string;
      personId: string;
      status: 'yes' | 'no' | null;
    }
  // Content Plan — marki i publikacje modułu. Kolekcje ADDYTYWNE; jedyna kaskada
  // to DELETE_CP_BRAND (marka zabiera swoje publikacje). Cała walidacja i
  // normalizacja żyje w `src/contentplan/domain.ts`; każdy niepoprawny ładunek
  // zwraca TĘ SAMĄ referencję stanu (inwariant 6).
  | { type: 'SAVE_CP_BRAND'; brandId: string | null; draft: ContentPlanBrandDraft }
  | { type: 'DELETE_CP_BRAND'; brandId: string }
  | {
      type: 'SAVE_CP_POST';
      postId: string | null; // null => utworzenie
      draft: ContentPlanPostDraft;
      /** Etykieta wpisu historii; pusta/brak => domyślna polska etykieta. */
      historyLabel?: string;
    }
  | { type: 'DELETE_CP_POST'; postId: string }
  // Decyzja klienta na UDOSTĘPNIONEJ publikacji (Akceptacja / Uwagi).
  | {
      type: 'REVIEW_CP_POST';
      postId: string;
      decision: ContentPlanReviewDecision;
      author: string;
    }
  // Udostępnienie CAŁEGO miesiąca marki — atomowe: jedna niekompletna
  // publikacja blokuje operację (ta sama referencja stanu).
  | { type: 'PUBLISH_CP_MONTH'; brandId: string; monthKey: string }
  | {
      type: 'ADD_CP_COMMENT';
      postId: string;
      author: string;
      body: string;
      parentId?: string;
    }
  | { type: 'ADD_PERSON'; person: PersonDraft }
  | { type: 'UPDATE_PERSON'; personId: string; person: PersonDraft }
  | { type: 'DELETE_PERSON'; personId: string }
  | { type: 'SET_CURRENT_USER'; personId: string }
  | { type: 'SET_PASSWORD'; personId: string; passwordHash: string }
  | { type: 'LOGOUT' }
  | { type: 'ADD_CLIENT'; name: string; contactName?: string; contactEmail?: string; contactPhone?: string; notes?: string; contacts?: ClientContact[] }
  | { type: 'RENAME_CLIENT'; clientId: string; name: string }
  | { type: 'SAVE_CLIENT'; clientId: string; name: string; contactName: string; contactEmail: string; contactPhone: string; notes: string; contacts?: ClientContact[] }
  | { type: 'SET_CLIENT_ARCHIVED'; clientId: string; archived: boolean }
  | { type: 'DELETE_CLIENT'; clientId: string }
  | { type: 'ADD_DEPARTMENT'; name: string }
  | { type: 'RENAME_DEPARTMENT'; departmentId: string; name: string }
  | { type: 'DELETE_DEPARTMENT'; departmentId: string }
  | { type: 'ADD_JOB_TITLE'; name: string }
  | { type: 'RENAME_JOB_TITLE'; jobTitleId: string; name: string }
  | { type: 'DELETE_JOB_TITLE'; jobTitleId: string }
  | { type: 'ADD_COMPANY'; name: string }
  | { type: 'RENAME_COMPANY'; companyId: string; name: string }
  | { type: 'DELETE_COMPANY'; companyId: string }
  | { type: 'ADD_SERVICE_TYPE'; name: string }
  | { type: 'RENAME_SERVICE_TYPE'; serviceTypeId: string; name: string }
  | { type: 'DELETE_SERVICE_TYPE'; serviceTypeId: string }
  | { type: 'ADD_WORK_CATEGORY'; name: string }
  | { type: 'RENAME_WORK_CATEGORY'; workCategoryId: string; name: string }
  | { type: 'DELETE_WORK_CATEGORY'; workCategoryId: string }
  | { type: 'SAVE_STATUS'; statusId: string | null; name: string; color: string }
  | { type: 'REORDER_STATUS'; statusId: string; direction: -1 | 1 }
  | { type: 'SET_STATUS_ARCHIVED'; statusId: string; archived: boolean }
  | { type: 'SET_STATUS_DONE'; statusId: string; isDone: boolean }
  | { type: 'DELETE_STATUS'; statusId: string }
  | { type: 'INSERT_BLOCK'; payload: InsertBlockPayload }
  | { type: 'REASSIGN_ENTRY'; entryId: string; toPersonId: string }
  | { type: 'SET_BLOCK_TIME'; entryId: string; date: string; startMinutes: number; plannedHours: number }
  | { type: 'MOVE_BLOCK_TO_BIN'; entryId: string }
  | { type: 'SPLIT_BLOCK'; entryId: string; parts: 2 | 4 }
  | { type: 'SCHEDULE_BIN_PART'; entryId: string; date: string; startMinutes: number; hours: number }
  | { type: 'DELETE_BLOCK'; entryId: string }
  | { type: 'SAVE_FILTER_PRESET'; name: string; page: FilterPage; criteria: SavedFilterCriteria }
  | { type: 'DELETE_FILTER_PRESET'; filterId: string }
  // Zapamiętanie ostatnio użytego (nienazwanego) filtra dla widoku. LOKALNE ONLY.
  // Sanityzowany → porównany po wartości → no-op zwraca TĘ SAMĄ referencję; nieznany
  // widok lub strukturalnie zniekształcony ładunek też => ta sama referencja.
  | { type: 'SET_LAST_FILTER'; view: FilterViewKey; filter: LastViewFilter }
  | { type: 'LOAD_SAMPLE'; data: AppData }
  | { type: 'DISMISS_SAMPLE_BANNER' }
  | { type: 'RESET_ALL'; data: AppData }
  // In-place replacement of the whole store with a fresh loadData() result,
  // triggered when another same-browser tab wrote and this tab is clean. Not a
  // user mutation — no activity row (mirrors RESET_ALL).
  | { type: 'REPLACE_FROM_STORAGE'; data: AppData }
  // Cloud hydration (supabase mode only): merge the seven mirrored planner
  // groups read from Supabase into local state. NEVER destroys local work —
  // same-id rows are replaced, cloud-only rows appended, local-only rows kept.
  // workload and every non-mirrored collection pass through untouched. An
  // invalid payload returns the ORIGINAL state reference (invariant 6).
  | { type: 'MERGE_CLOUD_ENTITIES'; payload: CloudMergePayload }
  // Pełna synchronizacja osób: AUTORYTATYWNA hydracja lokalnej listy z
  // RLS-owych profili chmury (upsert po e-mailu, nowe wiersze z id profilu
  // chmury, osoby bez konta chmury usuwane). Brak zmian => ta sama referencja.
  | { type: 'MERGE_CLOUD_PEOPLE'; payload: CloudPersonMergeRow[] }
  // AUTORYTATYWNA hydracja słowników organizacji (działy, statusy, typy usług,
  // kategorie prac) z chmury. Fail-closed na invariancie statusów.
  | { type: 'MERGE_CLOUD_DICTIONARIES'; payload: CloudDictionariesPayload }
  // Powiadomienia in-app: oznaczenie jako przeczytane (pojedynczo / wszystkie)
  // oraz AUTORYTATYWNA hydracja własnych powiadomień odbiorcy z chmury. Nieznane
  // id / brak nieprzeczytanych / niepoprawny ładunek => TA SAMA referencja
  // (inwariant 6).
  | { type: 'MARK_NOTIFICATION_READ'; notificationId: string }
  | { type: 'MARK_ALL_NOTIFICATIONS_READ' }
  | { type: 'MERGE_CLOUD_NOTIFICATIONS'; payload: CloudNotificationsPayload }
  // AUTORYTATYWNA hydracja modułu Content Plan z jego WŁASNEGO schematu
  // (`contentplan`): obie kolekcje lustrzane są podmieniane ładunkiem. Niepoprawny
  // ładunek => TA SAMA referencja stanu (inwariant 6).
  | { type: 'MERGE_CLOUD_CONTENT_PLAN'; payload: CloudContentPlanPayload };

function uid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---- Activity log helper ----

// Local, user-editable activity log for attribution/UX. localStorage is
// client-mutable, so this is NOT a security audit trail. Every row carries the
// acting identity, so the log stays honest about who did what. `as` overrides
// the stamp for session events where the pre-transition `currentUserId` is not
// the honest author. `impersonatorId` is always '' on new rows — it survives
// only as a read-only historical attribution field on old/cloud rows.
function withActivity(
  state: AppData,
  entityType: ActivityEntityType,
  entityId: string,
  message: string,
  as?: { actorId: string },
  options?: { collapse?: boolean },
): ActivityEvent[] {
  const actorId = as ? as.actorId : state.currentUserId;
  // collapse: identyczny wpis (encja+treść+aktor) bezpośrednio na końcu listy
  // dostaje świeży znacznik czasu zamiast duplikatu — auto-zapis nie zaśmieca
  // dziennika serią „zaktualizował(a)”.
  if (options?.collapse) {
    const last = state.activity[state.activity.length - 1];
    if (
      last &&
      last.entityType === entityType &&
      last.entityId === entityId &&
      last.message === message &&
      last.actorId === actorId &&
      (last.impersonatorId ?? '') === ''
    ) {
      return [...state.activity.slice(0, -1), { ...last, createdAt: nowIso() }];
    }
  }
  return [
    ...state.activity,
    {
      id: uid(),
      entityType,
      entityId,
      actorId,
      impersonatorId: '',
      message,
      createdAt: nowIso(),
    },
  ];
}

// ---- Workload ordering helpers ----

function dayKey(personId: string, date: string): string {
  return `${personId}|${date}`;
}

/** Next free sortIndex on a person's day, given the current entry list. */
function nextSortIndex(
  workload: WorkloadEntry[],
  personId: string,
  date: string,
): number {
  let max = -1;
  for (const w of workload) {
    if (w.personId === personId && w.date === date && w.sortIndex > max) {
      max = w.sortIndex;
    }
  }
  return max + 1;
}

/** Re-number sortIndex 0..n on each affected person-day, preserving order. */
function reindexDays(workload: WorkloadEntry[], keys: Set<string>): WorkloadEntry[] {
  if (keys.size === 0) return workload;
  const byDay = new Map<string, WorkloadEntry[]>();
  for (const w of workload) {
    const key = dayKey(w.personId, w.date);
    if (!keys.has(key)) continue;
    const list = byDay.get(key);
    if (list) list.push(w);
    else byDay.set(key, [w]);
  }
  const newIndex = new Map<string, number>(); // entryId -> sortIndex
  for (const list of byDay.values()) {
    // sortIndex is derived from time order: rank by startMinutes, ties by old index.
    list.sort((a, b) => a.startMinutes - b.startMinutes || a.sortIndex - b.sortIndex);
    list.forEach((w, i) => newIndex.set(w.id, i));
  }
  return workload.map((w) => {
    const idx = newIndex.get(w.id);
    return idx === undefined || idx === w.sortIndex ? w : { ...w, sortIndex: idx };
  });
}

/**
 * Kanoniczne `Task.draftHours` z celów zasobnika szkicu (`binTotals`): tylko
 * osoby przypisane, `snapHours` na wpis, wpisy `<= 0` odpadają, jeden wpis na
 * osobę (pierwszy wygrywa). Pusty wynik => `undefined` (klucz NIEOBECNY, forma
 * kanoniczna — patrz `Task.draftHours`).
 */
function draftHoursFromBinTotals(
  binTotals: Array<{ personId: string; hours: number }> | undefined,
  assigneeIds: string[],
): Array<{ personId: string; hours: number }> | undefined {
  const assigned = new Set(assigneeIds);
  const byPerson = new Map<string, number>();
  for (const item of binTotals ?? []) {
    if (!assigned.has(item.personId)) continue;
    if (byPerson.has(item.personId)) continue; // pierwszy wpis osoby wygrywa
    const hours = snapHours(item.hours);
    if (hours <= 0) continue;
    byPerson.set(item.personId, hours);
  }
  if (byPerson.size === 0) return undefined;
  return [...byPerson].map(([personId, hours]) => ({ personId, hours }));
}

/**
 * Materializacja `draftHours` szkicu w wiersze ZASOBNIKA przy publikacji
 * (mirror ścieżki „świeży wiersz” z binTotals). Dla każdego wpisu, którego
 * osoba istnieje, jest przypisana do zadania i ma `snapHours(hours) > 0`,
 * powstaje DOKŁADNIE jeden wiersz `{ date: BIN_DATE, startMinutes: 0 }`. Obrona
 * inwariantu 4: pomijamy osobę już wyemitowaną dla zadania oraz parę mającą już
 * wiersz zasobnika w stanie. `accumulated` niesie stan + dotychczas dopisane
 * wiersze (świeży `sortIndex`). Wpisy niepoprawne/osierocone są cicho pomijane
 * — publikacja nie może paść przez nieaktualny wiersz z chmury.
 */
function materializeDraftBin(
  state: AppData,
  accumulated: WorkloadEntry[],
  task: Task,
): WorkloadEntry[] {
  const assignedToTask = new Set(
    state.assignments.filter((a) => a.taskId === task.id).map((a) => a.personId),
  );
  const emitted = new Set<string>();
  const existingBinPair = new Set(
    accumulated
      .filter((w) => w.taskId === task.id && isBinEntry(w))
      .map((w) => w.personId),
  );
  const rows: WorkloadEntry[] = [];
  for (const entry of task.draftHours ?? []) {
    const personId = entry.personId;
    if (emitted.has(personId) || existingBinPair.has(personId)) continue;
    if (!hasEntity(state, 'person', personId)) continue;
    if (!assignedToTask.has(personId)) continue;
    const hours = snapHours(entry.hours);
    if (hours <= 0) continue;
    emitted.add(personId);
    const around = [...accumulated, ...rows];
    rows.push({
      id: uid(),
      taskId: task.id,
      personId,
      date: BIN_DATE,
      plannedHours: hours,
      startMinutes: 0,
      sortIndex: nextSortIndex(around, personId, BIN_DATE),
    });
  }
  return rows;
}

// ---- Task handlers ----

/** Wholesale-replace the checklist from the draft: trim texts, drop empty ones. */
function cleanChecklist(items: ChecklistItem[]): ChecklistItem[] {
  return items
    .map((item) => ({ ...item, text: item.text.trim() }))
    .filter((item) => item.text !== '');
}

/** Czy zadanie przyjmuje czas: istnieje i nie jest szkicem. Zadanie ze statusem
 *  „zrobione" TEŻ przyjmuje czas (2026-09-02, zgłoszenie „Odhaczanie tasków w
 *  widoku dnia"): praca po zamknięciu jest faktem do zapisania, a status zostaje
 *  bez zmian — inwariant 5: status jest jedynym znacznikiem zamknięcia i nic go
 *  tu nie przestawia w żadną stronę. */
function timeEntryTaskAccepts(state: AppData, taskId: string): boolean {
  const task = state.tasks.find((t) => t.id === taskId);
  return task !== undefined && !isDraftTask(task);
}

/**
 * ADD_TIME_ENTRY: jeden wpis wykonania. Z `newTask` najpierw powstaje zadanie
 * (pełna walidacja `saveTask`: projekt, status, tytuł), potem wpis — oba albo
 * żadne. Nachodzenie na inny wpis tej osoby tego dnia => TA SAMA referencja.
 */
function addTimeEntry(state: AppData, payload: AddTimeEntryPayload): AppData {
  const { personId, date, startMinutes, endMinutes, source, eventId } = payload;
  if (!hasEntity(state, 'person', personId)) return state;
  if (!isValidDateStr(date)) return state;
  if (!isValidTimeRange(startMinutes, endMinutes)) return state;
  if (!['manual', 'draw', 'timer', 'event'].includes(source)) return state;
  if (eventId !== undefined && (typeof eventId !== 'string' || eventId === '' || source !== 'event')) return state;
  if ((payload.taskId === undefined) === (payload.newTask === undefined)) return state;
  if (findOverlappingEntry(state.timeEntries, personId, date, startMinutes, endMinutes) !== undefined) return state;

  let base = state;
  let taskId: string;
  if (payload.newTask !== undefined) {
    const title = payload.newTask.title.trim();
    const firstActive = activeStatuses(state).find((st) => !st.isDone);
    if (title === '' || firstActive === undefined) return state;
    const after = saveTask(state, {
      taskId: null,
      draft: {
        projectId: payload.newTask.projectId,
        statusId: firstActive.id,
        title,
        description: '',
        startDate: date,
        endDate: date,
        estimatedHours: null,
        priority: 'normal',
        workCategoryId: payload.newTask.workCategoryId ?? '',
        departmentId: '',
        checklist: [],
      },
      assigneeIds: [personId],
      allocations: [],
    });
    if (after === state) return state;
    // `saveTask` dopisuje nowe zadanie NA KOŃCU kolekcji.
    taskId = after.tasks[after.tasks.length - 1].id;
    base = after;
  } else {
    taskId = payload.taskId as string;
    if (!timeEntryTaskAccepts(state, taskId)) return state;
  }
  const growth = planGrowth(base, taskId, personId, date, endMinutes - startMinutes);
  if (growth.overrunMinutes > 0 && payload.acceptOverrun !== true) return state;
  const entry: TimeEntry = {
    id: uid(),
    personId,
    taskId,
    date,
    startMinutes,
    endMinutes,
    source,
    ...(eventId !== undefined ? { eventId } : {}),
    ...(growth.overrunMinutes > 0 ? { overrunMinutes: growth.overrunMinutes } : {}),
    createdAt: nowIso(),
  };
  return materializeTracking({ ...base, timeEntries: [...base.timeEntries, entry] }, entry, growth);
}

/** Zwrot ćwiartek do JEDNEGO wiersza zasobnika pary (inwariant 4): istniejący
 *  wiersz rośnie, inaczej powstaje nowy na końcu zasobnika osoby. */
function returnQuartersToBin(workload: WorkloadEntry[], taskId: string, personId: string, quarters: number): WorkloadEntry[] {
  if (quarters <= 0) return workload;
  const bin = workload
    .filter((w) => w.taskId === taskId && w.personId === personId && isBinEntry(w))
    .sort((a, b) => a.sortIndex - b.sortIndex)[0];
  if (bin !== undefined) {
    return workload.map((w) =>
      w.id === bin.id ? { ...w, plannedHours: (toQuarters(w.plannedHours) + quarters) * HOURS_STEP } : w,
    );
  }
  return [
    ...workload,
    {
      id: uid(),
      taskId,
      personId,
      date: BIN_DATE,
      plannedHours: quarters * HOURS_STEP,
      startMinutes: 0,
      sortIndex: nextSortIndex(workload, personId, BIN_DATE),
    },
  ];
}

/**
 * WCIĘCIE planu pod fakt (2026-09-02, zgłoszenie „duży task w planie a krótki"):
 * wpis `entry` (zadanie T) w godzinach CUDZEGO datowanego bloku (inne zadanie,
 * ta sama osoba i dzień) tnie ten blok wokół wpisu na głowę i ogon — „duży
 * task 9-17, w środku 15 min rozmowy" daje trzy bloki: 9-15, rozmowa, 15:15-17.
 * Wycięte minuty wracają do JEDNEGO wiersza zasobnika pary bloku (inwariant 4):
 * plan mówi prawdę o godzinach, a sprzedane godziny nie giną (to samo robi
 * rozliczenie dnia z niewykonaną częścią). Głowa zachowuje id bloku (księgowość
 * `planGrowth` cudzych wpisów nadal ma cel), ogon dostaje nowe id; oba
 * dziedziczą `done`. Wpisy TEGO SAMEGO zadania nie wcinają (pokrycie liczy pula
 * pary). Bez cudzego bloku w godzinach wpisu => TA SAMA referencja. Wcięcie jest
 * jednokierunkowe: skasowanie wpisu nie skleja bloku z powrotem (plan po fakcie
 * to zapis historii, nie automat).
 */
function carvePlanAroundEntry(state: AppData, entry: TimeEntry): AppData {
  const { personId, date, taskId, startMinutes, endMinutes } = entry;
  let workload = state.workload;
  let timeEntries = state.timeEntries;
  const touched = new Set<string>();
  const binBackQ = new Map<string, number>();
  for (const b of state.workload) {
    if (b.personId !== personId || b.date !== date || b.taskId === taskId || isBinEntry(b)) continue;
    const bEnd = b.startMinutes + hoursToMinutes(b.plannedHours);
    const { head, tail, cutMinutes } = carveSpan(
      { startMinutes: b.startMinutes, endMinutes: bEnd },
      { startMinutes, endMinutes },
    );
    if (cutMinutes <= 0) continue;
    touched.add(dayKey(personId, date));
    binBackQ.set(b.taskId, (binBackQ.get(b.taskId) ?? 0) + toQuarters(cutMinutes / 60));
    const headId = head !== null ? b.id : null;
    const tailId = tail !== null ? (head !== null ? uid() : b.id) : null;
    const pieces: WorkloadEntry[] = [];
    if (head !== null) pieces.push({ ...b, plannedHours: toQuarters((head[1] - head[0]) / 60) * HOURS_STEP });
    if (tail !== null && tailId !== null) {
      pieces.push({
        ...b,
        id: tailId,
        startMinutes: tail[0],
        plannedHours: toQuarters((tail[1] - tail[0]) / 60) * HOURS_STEP,
        sortIndex: nextSortIndex(workload, personId, date),
      });
    }
    workload = [...workload.filter((w) => w.id !== b.id), ...pieces];
    timeEntries = repointGrowthAfterCarve(
      timeEntries,
      b,
      headId,
      head === null ? 0 : head[1] - head[0],
      tailId,
      tail === null ? 0 : tail[1] - tail[0],
      cutMinutes,
    );
  }
  if (touched.size === 0) return state;
  for (const [pairTaskId, quarters] of binBackQ) {
    workload = returnQuartersToBin(workload, pairTaskId, personId, quarters);
    touched.add(dayKey(personId, BIN_DATE));
  }
  return { ...state, workload: reindexDays(workload, touched), timeEntries };
}

/**
 * Księgowość wzrostu po wcięciu (review Codex 2026-09-02): rekordy `planGrowth`
 * wskazujące pocięty blok muszą wskazywać KAWAŁKI, inaczej odwrót (kasowanie
 * wpisu-właściciela) zdejmowałby pełne minuty wzrostu z samej głowy — gubiąc
 * ręczny plan głowy i zostawiając dorośnięty ogon. Wzrost dokleja się na
 * KOŃCU bloku, więc rekordy rozdziela się od końca: najpierw ogon, potem
 * wycięcie (te minuty przepadają razem z wyciętymi — wróciły do zasobnika),
 * na końcu głowa; najpóźniejszy wpis i najpóźniejszy kawałek jako pierwsze.
 * Minuty z zasobnika idą w ślad za minutami (najpierw ogon, potem głowa).
 * Bez rekordów na ten blok => TA SAMA referencja listy wpisów.
 */
function repointGrowthAfterCarve(
  entries: TimeEntry[],
  block: WorkloadEntry,
  headId: string | null,
  headMinutes: number,
  tailId: string | null,
  tailMinutes: number,
  cutMinutes: number,
): TimeEntry[] {
  const owners = entries
    .map((e, index) => ({ e, index }))
    .filter(
      ({ e }) =>
        e.taskId === block.taskId &&
        e.personId === block.personId &&
        e.date === block.date &&
        (e.planGrowth ?? []).some((p) => p.blockId === block.id),
    )
    .sort((a, b) => b.e.startMinutes - a.e.startMinutes);
  if (owners.length === 0) return entries;
  let tailRoom = tailMinutes;
  let cutRoom = cutMinutes;
  let headRoom = headMinutes;
  const replaced = new Map<number, TimeEntry>();
  for (const { e, index } of owners) {
    const own = e.planGrowth ?? [];
    const pieces: NonNullable<TimeEntry['planGrowth']> = [];
    for (let k = own.length - 1; k >= 0; k--) {
      const p = own[k];
      if (p.blockId !== block.id) {
        pieces.unshift(p);
        continue;
      }
      let minutes = p.minutes;
      let fromBin = p.fromBinMinutes;
      const toTail = Math.min(minutes, tailRoom);
      tailRoom -= toTail;
      minutes -= toTail;
      const toCut = Math.min(minutes, cutRoom);
      cutRoom -= toCut;
      minutes -= toCut;
      const toHead = Math.min(minutes, headRoom);
      headRoom -= toHead;
      const binTail = Math.min(fromBin, toTail);
      fromBin -= binTail;
      const binHead = Math.min(fromBin, toHead);
      if (toHead > 0 && headId !== null) pieces.unshift({ blockId: headId, minutes: toHead, fromBinMinutes: binHead });
      if (toTail > 0 && tailId !== null) pieces.unshift({ blockId: tailId, minutes: toTail, fromBinMinutes: binTail });
    }
    const { planGrowth: _drop, ...rest } = e;
    replaced.set(index, pieces.length > 0 ? { ...rest, planGrowth: pieces } : rest);
  }
  return entries.map((e, index) => replaced.get(index) ?? e);
}

/**
 * Wykonanie → plan (po dodaniu/poprawce wpisu `entry`, z policzonym `growth`):
 *   1. nadwyżka ponad plan pary rośnie w planie jak przy rozciąganiu bloku:
 *      `fromBinMinutes` schodzi z wiersza zasobnika (osoba, zadanie; wiersz
 *      znika przy zerze, inwariant 4), reszta `growMinutes` z wolnych sprzedanych;
 *      wypełnia luki zegarowe (unia wpisów pary minus datowane bloki osoby —
 *      geometria, więc wynik NIE zależy od kolejności dodawania wpisów)
 *      chronologicznie, kawałek po kawałku, PO GRANICACH WPISÓW: kawałek za
 *      końcem bloku pary rozciąga ten blok, inny dostaje nowy blok w godzinach
 *      luki (wykonany); każdy wpis-właściciel niesie własny (akumulowany)
 *      rekord `planGrowth`, więc odwrót cofa dokładnie swoje. Dopiero resztka
 *      bez żadnej wolnej minuty wraca do godzin wpisu wyzwalającego — nakładka
 *      jest wtedy faktem, nie artefaktem (świadoma alokacja: fakt, nie zamiar);
 *   2. bloki pary w pełni pokryte wykonaniem (po kolei od najwcześniejszego)
 *      dostają `done: true` (nigdy nie odznacza — to robi odznaczenie/kasowanie);
 *   3. zadanie ze sprzedanymi godzinami, w którym nic nie zostało (wszystkie
 *      datowane bloki wykonane, zasobniki puste), dostaje pierwszy status
 *      `isDone` (kubełek bez estymaty nigdy — nie ma „wszystko zrobione").
 */
function materializeTracking(
  state: AppData,
  entry: TimeEntry,
  growth: { growMinutes: number; fromBinMinutes: number },
): AppData {
  // Fakt przed planem: wpis w godzinach CUDZEGO bloku wcina go (głowa/ogon),
  // ZANIM policzymy luki — wycięte minuty są wtedy wolne dla wzrostu tej pary,
  // więc nowy blok „rozmowy" wskakuje dokładnie w wycięcie zamiast nakładać się.
  state = carvePlanAroundEntry(state, entry);
  const { taskId, personId, date } = entry;
  let workload = state.workload;
  const touched = new Set<string>();
  // Księgowość per wpis-właściciel: lista kawałków na wpis, minuty akumulują
  // per blok.
  const recs = new Map<string, Array<{ blockId: string; minutes: number; fromBinMinutes: number }>>();
  if (growth.growMinutes > 0) {
    let binLeft = growth.fromBinMinutes;
    const takeBin = (minutes: number): number => {
      const t = Math.min(binLeft, minutes);
      binLeft -= t;
      return t;
    };
    if (growth.fromBinMinutes > 0) {
      const bin = workload
        .filter((w) => w.taskId === taskId && w.personId === personId && isBinEntry(w))
        .sort((a, b) => a.sortIndex - b.sortIndex)[0];
      if (bin !== undefined) {
        const leftQ = toQuarters(bin.plannedHours) - toQuarters(growth.fromBinMinutes / 60);
        workload =
          leftQ <= 0
            ? workload.filter((w) => w.id !== bin.id)
            : workload.map((w) => (w.id === bin.id ? { ...w, plannedHours: leftQ * HOURS_STEP } : w));
        touched.add(dayKey(personId, BIN_DATE));
      }
    }
    // Wzrost ląduje tam, gdzie czas FAKTYCZNIE został zalogowany, a plan go
    // nie pokrywa: geometria zegarowa (unia wpisów pary minus datowane bloki
    // osoby), więc wynik nie zależy od kolejności dodawania wpisów. Luki
    // wypełniają się chronologicznie, kawałek po kawałku, PO GRANICACH WPISÓW
    // — każdy wpis-właściciel dostaje własny kawałek planu i własny rekord
    // księgowości (akumulowany), więc odwrót cofa dokładnie swoje, nigdy
    // cudze. Dopiero resztka bez żadnej wolnej minuty wraca do godzin wpisu
    // wyzwalającego — nakładka jest wtedy faktem, nie artefaktem.
    const personBlocks = workload
      .filter((w) => w.personId === personId && w.date === date && !isBinEntry(w))
      .map((w) => ({ startMinutes: w.startMinutes, endMinutes: w.startMinutes + hoursToMinutes(w.plannedHours) }));
    const pairEntries = state.timeEntries
      .filter((e) => e.taskId === taskId && e.personId === personId && e.date === date)
      .sort((a, b) => a.startMinutes - b.startMinutes);
    const gaps = uncoveredEntryGaps(pairEntries, personBlocks);
    const addBlock = (startMinutes: number, minutes: number): WorkloadEntry => {
      const created: WorkloadEntry = {
        id: uid(),
        taskId,
        personId,
        date,
        plannedHours: toQuarters(minutes / 60) * HOURS_STEP,
        startMinutes,
        sortIndex: nextSortIndex(workload, personId, date),
        done: true,
      };
      workload = [...workload, created];
      return created;
    };
    const growById = (blockId: string, minutes: number): void => {
      workload = workload.map((w) =>
        w.id === blockId ? { ...w, plannedHours: (toQuarters(w.plannedHours) + toQuarters(minutes / 60)) * HOURS_STEP } : w,
      );
    };
    const blockEnd = (w: WorkloadEntry): number => w.startMinutes + hoursToMinutes(w.plannedHours);
    /**
     * Jeden kawałek wzrostu dla wpisu `owner`, w godzinach [start, start+minutes).
     * Kolejność prób: (1) kawałek przylega do AKTUALNEGO końca bloku z już
     * posiadanego rekordu właściciela → blok rośnie, kawałek rekordu akumuluje;
     * (2) przylega do końca bloku pary bez CUDZEJ księgowości → ten blok
     * rośnie, nowy kawałek rekordu (odwrót cudzego wpisu kurczy blok od końca,
     * więc cudzy rekord wyklucza); (3) nowy blok (wykonany) w godzinach
     * kawałka. Rozłączne kawałki jednego wpisu = osobne pozycje listy — plan
     * nigdy nie nachodzi, póki istnieje wolna zalogowana minuta.
     */
    const attachPiece = (owner: TimeEntry, start: number, minutes: number, allowHost: boolean): void => {
      const bin = takeBin(minutes);
      const pieces = recs.get(owner.id) ?? (owner.planGrowth ?? []).map((p) => ({ ...p }));
      const contiguous = pieces.find((p) => {
        const b = workload.find((w) => w.id === p.blockId && !isBinEntry(w));
        return b !== undefined && blockEnd(b) === start;
      });
      if (contiguous !== undefined) {
        growById(contiguous.blockId, minutes);
        contiguous.minutes += minutes;
        contiguous.fromBinMinutes += bin;
        recs.set(owner.id, pieces);
        return;
      }
      const host = allowHost
        ? workload.find((w) => {
            if (w.taskId !== taskId || w.personId !== personId || w.date !== date || isBinEntry(w)) return false;
            if (blockEnd(w) !== start) return false;
            const foreignOld = pairEntries.some(
              (pe) => pe.id !== owner.id && pe.planGrowth?.some((p) => p.blockId === w.id) === true,
            );
            const foreignRun = [...recs].some(([oid, ps]) => oid !== owner.id && ps.some((p) => p.blockId === w.id));
            return !foreignOld && !foreignRun;
          })
        : undefined;
      if (host !== undefined) {
        growById(host.id, minutes);
        pieces.push({ blockId: host.id, minutes, fromBinMinutes: bin });
      } else {
        const created = addBlock(start, minutes);
        pieces.push({ blockId: created.id, minutes, fromBinMinutes: bin });
      }
      recs.set(owner.id, pieces);
    };
    let remaining = growth.growMinutes;
    for (const [gapStart, gapEnd] of gaps) {
      if (remaining <= 0) break;
      const segEnd = Math.min(gapEnd, gapStart + remaining);
      for (const e of pairEntries) {
        const s = Math.max(gapStart, e.startMinutes);
        const en = Math.min(segEnd, e.endMinutes);
        if (en <= s) continue;
        attachPiece(e, s, en - s, true);
      }
      remaining -= segEnd - gapStart;
    }
    if (remaining > 0) attachPiece(entry, entry.startMinutes, remaining, false);
    touched.add(dayKey(personId, date));
  }
  let next: AppData = touched.size > 0 ? { ...state, workload: reindexDays(workload, touched) } : state;
  if (recs.size > 0) {
    // Księgowość na wpisach: każdy odwrót (kasowanie / poprawka) cofa dokładnie
    // swój kawałek planu i swoją część zasobnika.
    next = {
      ...next,
      timeEntries: next.timeEntries.map((e) => {
        const r = recs.get(e.id);
        return r !== undefined ? { ...e, planGrowth: r } : e;
      }),
    };
  }
  next = resyncBlockDone(next, taskId, personId, date);
  return autoCompleteTask(next, taskId);
}

/**
 * ODWRÓT „wykonanie → plan" jednego wpisu (kasowanie / poprawka): każdy
 * kawałek listy `planGrowth` kurczy swój blok o `minutes` (znika przy zerze),
 * a suma `fromBinMinutes` wraca do JEDNEGO wiersza zasobnika pary (inwariant
 * 4); reszta wraca do wolnych sprzedanych samą redukcją planu. Bloku kawałka
 * już nie ma (usunięty ręcznie) => ten kawałek pomijamy (nie mintujemy godzin
 * z powietrza). Bez księgowości albo bez żywych bloków => TA SAMA referencja.
 */
function revertPlanGrowth(state: AppData, entry: TimeEntry): AppData {
  const pieces = entry.planGrowth ?? [];
  if (pieces.length === 0) return state;
  const touched = new Set<string>();
  let workload = state.workload;
  let binBackQ = 0;
  let pairTaskId = '';
  let pairPersonId = '';
  for (const pg of pieces) {
    const block = workload.find((w) => w.id === pg.blockId && !isBinEntry(w));
    if (block === undefined) continue;
    pairTaskId = block.taskId;
    pairPersonId = block.personId;
    touched.add(dayKey(block.personId, block.date));
    const leftQ = toQuarters(block.plannedHours) - toQuarters(pg.minutes / 60);
    workload =
      leftQ <= 0
        ? workload.filter((w) => w.id !== block.id)
        : workload.map((w) => (w.id === block.id ? { ...w, plannedHours: leftQ * HOURS_STEP } : w));
    binBackQ += toQuarters(pg.fromBinMinutes / 60);
  }
  if (touched.size === 0) return state;
  if (binBackQ > 0) {
    const bin = workload
      .filter((w) => w.taskId === pairTaskId && w.personId === pairPersonId && isBinEntry(w))
      .sort((a, b) => a.sortIndex - b.sortIndex)[0];
    workload =
      bin !== undefined
        ? workload.map((w) =>
            w.id === bin.id ? { ...w, plannedHours: (toQuarters(w.plannedHours) + binBackQ) * HOURS_STEP } : w,
          )
        : [
            ...workload,
            {
              id: uid(),
              taskId: pairTaskId,
              personId: pairPersonId,
              date: BIN_DATE,
              plannedHours: binBackQ * HOURS_STEP,
              startMinutes: 0,
              sortIndex: nextSortIndex(workload, pairPersonId, BIN_DATE),
            },
          ];
    touched.add(dayKey(pairPersonId, BIN_DATE));
  }
  return {
    ...state,
    workload: reindexDays(workload, touched),
    timeEntries: state.timeEntries.map((e) => {
      if (e.id !== entry.id) return e;
      const { planGrowth: _drop, ...rest } = e;
      return rest;
    }),
  };
}

/**
 * PRZYCIĘCIE wzrostu pary do wykonania (po kasowaniu / poprawce wpisu):
 * gdy plan pary przewyższa zalogowany czas, nadmiar schodzi WYŁĄCZNIE z
 * kawałków `planGrowth` żywych bloków (plan ułożony ręcznie jest nietykalny),
 * od najpóźniejszego wpisu i kawałka (LIFO — rósł od najwcześniejszej luki).
 * Dzięki temu skasowanie wpisu WYZWALAJĄCEGO wzrost zdejmuje plan dorośnięty
 * na godzinach INNEGO wpisu (tam księgowany), zamiast go osierocać. Zasobnik
 * odzyskuje część kawałka ponad pozostałe minuty. Bez nadmiaru albo bez
 * kawałków => TA SAMA referencja.
 */
function trimPlanGrowth(state: AppData, taskId: string, personId: string, date: string): AppData {
  const carriers = state.timeEntries
    .filter((e) => e.taskId === taskId && e.personId === personId && e.date === date && (e.planGrowth?.length ?? 0) > 0)
    .sort((a, b) => b.startMinutes - a.startMinutes);
  if (carriers.length === 0) return state;
  const b = trackingBalance(state, taskId, personId, date);
  // Plan ma pokrywać wykonanie BEZ minut „ponad sprzedane" (te z definicji
  // planu nie dostały) — symetrycznie do wzoru nadwyżki w `planGrowth`.
  let excess = b.plannedMinutes - (b.loggedMinutes - b.recordedOverrunMinutes);
  if (excess <= 0) return state;
  let workload = state.workload;
  let binBackQ = 0;
  const touched = new Set<string>();
  const trimmed = new Map<string, TimeEntry['planGrowth']>();
  for (const e of carriers) {
    if (excess <= 0) break;
    const pieces = [...(e.planGrowth ?? [])];
    for (let i = pieces.length - 1; i >= 0 && excess > 0; i--) {
      const pg = pieces[i];
      const blk = workload.find((w) => w.id === pg.blockId && !isBinEntry(w));
      if (blk === undefined) continue;
      const cut = Math.min(excess, pg.minutes, hoursToMinutes(blk.plannedHours));
      if (cut <= 0) continue;
      excess -= cut;
      touched.add(dayKey(personId, blk.date));
      const leftQ = toQuarters(blk.plannedHours) - toQuarters(cut / 60);
      workload =
        leftQ <= 0
          ? workload.filter((w) => w.id !== blk.id)
          : workload.map((w) => (w.id === blk.id ? { ...w, plannedHours: leftQ * HOURS_STEP } : w));
      const remaining = pg.minutes - cut;
      const binBack = Math.max(0, pg.fromBinMinutes - remaining);
      binBackQ += toQuarters(binBack / 60);
      if (remaining <= 0) pieces.splice(i, 1);
      else pieces[i] = { blockId: pg.blockId, minutes: remaining, fromBinMinutes: pg.fromBinMinutes - binBack };
    }
    trimmed.set(e.id, pieces.length > 0 ? pieces : undefined);
  }
  if (touched.size === 0) return state;
  if (binBackQ > 0) {
    const bin = workload
      .filter((w) => w.taskId === taskId && w.personId === personId && isBinEntry(w))
      .sort((a, b2) => a.sortIndex - b2.sortIndex)[0];
    workload =
      bin !== undefined
        ? workload.map((w) =>
            w.id === bin.id ? { ...w, plannedHours: (toQuarters(w.plannedHours) + binBackQ) * HOURS_STEP } : w,
          )
        : [
            ...workload,
            {
              id: uid(),
              taskId,
              personId,
              date: BIN_DATE,
              plannedHours: binBackQ * HOURS_STEP,
              startMinutes: 0,
              sortIndex: nextSortIndex(workload, personId, BIN_DATE),
            },
          ];
    touched.add(dayKey(personId, BIN_DATE));
  }
  return {
    ...state,
    workload: reindexDays(workload, touched),
    timeEntries: state.timeEntries.map((e) => {
      if (!trimmed.has(e.id)) return e;
      const next = trimmed.get(e.id);
      const { planGrowth: _drop, ...rest } = e;
      return next !== undefined ? { ...rest, planGrowth: next } : rest;
    }),
  };
}

/**
 * Bloki pary: `done` = „w pełni pokryty wykonaniem" (po kolei od
 * najwcześniejszego). DWUKIERUNKOWO: pokryty dostaje `done`, niepokryty traci
 * — dzięki temu skasowanie wpisu nie zostawia „wykonanego" bloku bez pokrycia.
 * (Jedyny wyjątek poza tą ścieżką: `SET_BLOCK_DONE true`, gdy godziny bloku
 * zajmuje inny wpis — blok jest wykonany bez własnego wpisu do czasu kolejnej
 * zmiany wpisów pary.)
 */
function resyncBlockDone(state: AppData, taskId: string, personId: string, date: string): AppData {
  const b = trackingBalance(state, taskId, personId, date);
  if (b.blocks.length === 0) return state;
  const fill = portionFill(b.blocks, b.loggedMinutes);
  let changed = false;
  const workload = state.workload.map((w) => {
    if (w.taskId !== taskId || w.personId !== personId || w.date !== date || isBinEntry(w)) return w;
    const covered = (fill.get(w.id) ?? 0) >= hoursToMinutes(w.plannedHours);
    if (covered !== (w.done === true)) {
      changed = true;
      return { ...w, done: covered };
    }
    return w;
  });
  return changed ? { ...state, workload } : state;
}

/** Zadanie, w którym nie ma nic do zrobienia (wszystkie bloki wykonane, zasobnik
 *  pusty, a przy estymacie brak wolnych sprzedanych godzin), staje się „zrobione".
 *  Bez estymaty zaplanowane bloki SĄ całym zakresem, ale zamyka je wyłącznie
 *  jawne kliknięcie „wykonane" (`closeWithoutEstimate` z SET_BLOCK_DONE) — sam
 *  wpis czasu nie zamyka zadania bez kontraktu (np. świeżego zadania z paska
 *  trackera). Serii cyklicznej nigdy nie zamyka — nią rządzi `SET_TASK_STATUS`. */
function autoCompleteTask(state: AppData, taskId: string, closeWithoutEstimate = false): AppData {
  const task = state.tasks.find((t) => t.id === taskId);
  if (task === undefined || task.recurrence !== undefined || isDoneStatus(state, task.statusId)) return state;
  const rows = state.workload.filter((w) => w.taskId === taskId);
  if (rows.length === 0) return state;
  if (rows.some((w) => isBinEntry(w) || w.done !== true)) return state;
  if (task.estimatedHours === null) {
    if (!closeWithoutEstimate) return state;
  } else {
    // Wolne sprzedane godziny (nikomu nie przydzielone) to też „coś do zrobienia".
    const plannedQ = rows.reduce((sum, w) => sum + toQuarters(w.plannedHours), 0);
    if (plannedQ < toQuarters(task.estimatedHours)) return state;
  }
  const doneStatus = activeStatuses(state).find((st) => st.isDone) ?? state.statuses.find((st) => st.isDone);
  if (doneStatus === undefined) return state;
  return {
    ...state,
    tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, statusId: doneStatus.id, updatedAt: nowIso() } : t)),
    activity: withActivity(
      state,
      'task',
      taskId,
      `zadanie zamknięte automatycznie: wszystkie bloki wykonane (status „${doneStatus.name}”)`,
    ),
  };
}

/**
 * „Wykonane" na bloku = wpis 1:1 w jego godzinach, jeśli te minuty są wolne.
 * Godziny CZĘŚCIOWO zajęte (2026-09-02, zgłoszenie „duży task w planie a
 * krótki"): cudze wpisy (inne zadanie) WCINAJĄ blok jak przy dodaniu wpisu, a
 * każdy wolny kawałek godzin bloku dostaje własny wpis „z bloku" swojego kawałka
 * planu (głowa 9-15 → wpis 9-15, ogon 15:15-17 → wpis 15:15-17). Wpisy TEGO
 * SAMEGO zadania w godzinach bloku liczą się do pokrycia i nie wcinają. Całość
 * zajęta => blok wykonany bez własnego wpisu (jak dotąd).
 */
function linkEntryForBlock(state: AppData, block: WorkloadEntry): AppData {
  if (isBinEntry(block)) return state;
  const end = block.startMinutes + hoursToMinutes(block.plannedHours);
  if (!isValidTimeRange(block.startMinutes, end)) return state;
  if (!timeEntryTaskAccepts(state, block.taskId)) return state;
  const occupied = state.timeEntries.filter(
    (e) => e.personId === block.personId && e.date === block.date && e.startMinutes < end && e.endMinutes > block.startMinutes,
  );
  const free = freeRangesWithin(block.startMinutes, end, occupied);
  if (free.length === 0) return state;
  let next = state;
  for (const foreign of occupied) {
    if (foreign.taskId !== block.taskId) next = carvePlanAroundEntry(next, foreign);
  }
  // Wpis z bloku nigdy nie jest nadwyżką: pokrywa dokładnie swój plan. Każdy
  // wolny kawałek wskazuje kawałek planu, w którym leży (głowa = id bloku).
  const stamp = nowIso();
  const created: TimeEntry[] = free.map(([startMinutes, endMinutes]) => {
    const piece = next.workload.find(
      (w) =>
        w.taskId === block.taskId &&
        w.personId === block.personId &&
        w.date === block.date &&
        !isBinEntry(w) &&
        w.startMinutes <= startMinutes &&
        w.startMinutes + hoursToMinutes(w.plannedHours) >= endMinutes,
    );
    return {
      id: uid(),
      personId: block.personId,
      taskId: block.taskId,
      date: block.date,
      startMinutes,
      endMinutes,
      source: 'block',
      blockId: piece?.id ?? block.id,
      createdAt: stamp,
    };
  });
  return { ...next, timeEntries: [...next.timeEntries, ...created] };
}

/** Odznaczenie bloku kasuje jego wpisy „z bloku": 1:1 z blokiem ALBO kawałki
 *  z wolnych godzin (blok częściowo zajęty). Wpis poprawiony ręcznie traci
 *  `blockId` w UPDATE_TIME_ENTRY, więc nigdy tu nie wpada. */
function unlinkEntryForBlock(state: AppData, block: WorkloadEntry): AppData {
  const end = block.startMinutes + hoursToMinutes(block.plannedHours);
  const linked = state.timeEntries.filter(
    (e) =>
      e.source === 'block' &&
      e.blockId === block.id &&
      (entryMatchesBlock(e, block) || (e.startMinutes >= block.startMinutes && e.endMinutes <= end)),
  );
  if (linked.length === 0) return state;
  const ids = new Set(linked.map((e) => e.id));
  return { ...state, timeEntries: state.timeEntries.filter((e) => !ids.has(e.id)) };
}

/**
 * SETTLE_TRACKED_DAY: przeszłość w kalendarzu = fakty. Każdy NIEwykonany
 * datowany blok, którego koniec minął o ≥15 min, oddaje niepokrytą część do
 * zasobnika: blok kurczy się do pokrycia (i jest wtedy wykonany) albo znika,
 * a minuty dochodzą do JEDNEGO wiersza zasobnika pary (inwariant 4). Zadania
 * „zrobione" pomijane. `nowMinutes` podane = AUTOMAT (dzisiaj, co minutę) —
 * działa wyłącznie na dniu śledzonym (≥1 wpis osoby). `nowMinutes: null` =
 * JAWNE rozliczenie z popoutu widoku dnia — działa też na dniu bez wpisów
 * (pusty miniony dzień z blokiem dodanym wstecz musi dać się rozliczyć).
 */
const SETTLE_GRACE_MINUTES = 15;
function settleTrackedDay(state: AppData, personId: string, date: string, nowMinutes: number | null): AppData {
  if (!isValidDateStr(date) || !hasEntity(state, 'person', personId)) return state;
  if (nowMinutes !== null && !state.timeEntries.some((e) => e.personId === personId && e.date === date)) return state;
  const blocks = state.workload.filter(
    (w) => w.personId === personId && w.date === date && !isBinEntry(w) && w.done !== true,
  );
  if (blocks.length === 0) return state;
  let workload = state.workload;
  const touched = new Set<string>();
  const byTask = new Map<string, WorkloadEntry[]>();
  for (const b of blocks) {
    const end = b.startMinutes + hoursToMinutes(b.plannedHours);
    if (nowMinutes !== null && end + SETTLE_GRACE_MINUTES > nowMinutes) continue;
    const task = state.tasks.find((t) => t.id === b.taskId);
    if (task === undefined || isDoneStatus(state, task.statusId)) continue;
    const list = byTask.get(b.taskId);
    if (list) list.push(b);
    else byTask.set(b.taskId, [b]);
  }
  for (const [taskId, due] of byTask) {
    const bal = trackingBalance(state, taskId, personId, date);
    const fill = portionFill(bal.blocks, bal.loggedMinutes);
    let returnQ = 0;
    for (const b of due) {
      const coveredQ = toQuarters((fill.get(b.id) ?? 0) / 60);
      const plannedQ = toQuarters(b.plannedHours);
      if (coveredQ >= plannedQ) continue;
      returnQ += plannedQ - coveredQ;
      workload =
        coveredQ === 0
          ? workload.filter((w) => w.id !== b.id)
          : workload.map((w) => (w.id === b.id ? { ...w, plannedHours: coveredQ * HOURS_STEP, done: true } : w));
      touched.add(dayKey(personId, date));
    }
    if (returnQ > 0) {
      const bin = workload
        .filter((w) => w.taskId === taskId && w.personId === personId && isBinEntry(w))
        .sort((a, b) => a.sortIndex - b.sortIndex)[0];
      workload =
        bin !== undefined
          ? workload.map((w) =>
              w.id === bin.id ? { ...w, plannedHours: (toQuarters(w.plannedHours) + returnQ) * HOURS_STEP } : w,
            )
          : [
              ...workload,
              {
                id: uid(),
                taskId,
                personId,
                date: BIN_DATE,
                plannedHours: returnQ * HOURS_STEP,
                startMinutes: 0,
                sortIndex: nextSortIndex(workload, personId, BIN_DATE),
              },
            ];
      touched.add(dayKey(personId, BIN_DATE));
    }
  }
  if (touched.size === 0) return state;
  return { ...state, workload: reindexDays(workload, touched) };
}

/**
 * Migracja starych kluczy „przeczytane" feedu przy utracie wierszy przypisań:
 * WYŁĄCZNIE u zalogowanej osoby (`meId`) każdy `assignment:<TaskAssignment.id>`
 * wskazujący wiersz z `dropped` zostaje ZASTĄPIONY kluczem pary
 * `assignment:<taskId>:<personId>` (bez duplikatów, kolejność zachowana).
 * Tylko własny wiersz: stare klucze innych osób wskazują uid ICH przeglądarek
 * (tu nic nie znaczą), a zmiana cudzego `Person` poszłaby lustrem jako
 * `UPDATE profiles` cudzego profilu (RLS odrzuca / admin nadpisałby zbiór).
 * Brak trafienia => TA SAMA referencja listy (inwariant 6 / brak echo-write).
 */
function upgradeLegacyAssignmentReadIds(
  people: readonly Person[],
  meId: string,
  dropped: readonly TaskAssignment[],
): Person[] {
  if (meId === '' || dropped.length === 0) return people as Person[];
  const me = people.find((p) => p.id === meId);
  const ids = me?.notificationsReadIds;
  if (!me || !ids) return people as Person[];
  const pairKeyByLegacy = new Map<string, string>();
  for (const a of dropped) {
    pairKeyByLegacy.set(`assignment:${a.id}`, assignmentNotificationId(a.taskId, a.personId));
  }
  if (!ids.some((id) => pairKeyByLegacy.has(id))) return people as Person[];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const mapped = pairKeyByLegacy.get(id) ?? id;
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    out.push(mapped);
  }
  return people.map((p) => (p.id === meId ? { ...p, notificationsReadIds: out } : p));
}

function saveTask(state: AppData, payload: SaveTaskPayload): AppData {
  const { taskId, draft, assigneeIds, allocations } = payload;
  // Reject an invalid/empty/reversed/over-cap period so no bad date is ever
  // persisted (render-side format() would throw a blank-screen RangeError).
  if (periodError(draft.startDate, draft.endDate, { maxDays: MAX_TASK_PERIOD_DAYS }) !== null) {
    return state;
  }
  // Treat the command payload as untrusted. The editor normally emits valid
  // cells, but reducers are also reached by imports, stale tabs, and tests.
  // Reject atomically so malformed input cannot create invalid workload rows.
  if (
    allocations.some(
      (cell) =>
        !isValidDateStr(cell.date) ||
        cell.date < draft.startDate ||
        cell.date > draft.endDate ||
        !Number.isFinite(cell.plannedHours) ||
        cell.plannedHours < 0 ||
        cell.plannedHours > 24 ||
        // Opcjonalna przypięta godzina startu: gdy obecna, musi być całkowitą
        // minutą w dobie i na siatce 15 min (obrona w głąb — edytor snapuje).
        (cell.startMinutes !== undefined &&
          (!Number.isInteger(cell.startMinutes) ||
            cell.startMinutes < 0 ||
            cell.startMinutes >= DAY_MINUTES ||
            cell.startMinutes % MINUTE_STEP !== 0)),
    ) ||
    (payload.newUnassigned ?? []).some(
      (item) => !Number.isFinite(item.hours) || item.hours < 0,
    ) ||
    (payload.binTotals ?? []).some(
      (item) => !Number.isFinite(item.hours) || item.hours < 0,
    )
  ) {
    return state;
  }
  // Reject a stale edit id: without this the task map skips the ghost id but
  // assignments/workload are STILL rebuilt for it and an activity row appended —
  // the worst live corruption path. Reject before any of that runs.
  if (taskId !== null && !hasEntity(state, 'task', taskId)) return state;
  // Title required; projectId/statusId must exist; estimate null or finite >= 0.
  if (!isValidTaskDraft(state, draft)) return state;
  // A dangling person reference covers every persistable person id: allocations
  // and newUnassigned are filtered by the assignee set below. Reject atomically.
  if (assigneeIds.some((id) => !hasEntity(state, 'person', id))) return state;
  const ts = nowIso();
  const checklist = cleanChecklist(draft.checklist);
  // A category can disappear while an edit modal is still open. Persist only a
  // live dictionary reference so state never needs a later reload to self-heal.
  const workCategoryId = state.workCategories.some((c) => c.id === draft.workCategoryId)
    ? draft.workCategoryId
    : '';
  const departmentId = state.departments.some((d) => d.id === draft.departmentId)
    ? draft.departmentId
    : '';
  // Utajnianie honorujemy tylko od zarządu; poza tym draft nie ma głosu
  // (obrona w głąb — UI chowa checkbox przed nie-zarządem).
  const confidentialAllowed = isBoardMember(state);

  let tasks = state.tasks;
  let realTaskId: string;
  let created = false;

  if (taskId === null) {
    const task: Task = {
      id: uid(),
      projectId: draft.projectId,
      statusId: draft.statusId,
      title: draft.title,
      description: draft.description,
      startDate: draft.startDate,
      endDate: draft.endDate,
      estimatedHours: draft.estimatedHours,
      priority: draft.priority,
      workCategoryId,
      departmentId,
      checklist,
      // Nowe zadanie ląduje NA KOŃCU swojego projektu.
      orderIndex: maxOrderIndexOfProject(state, draft.projectId) + 1,
      // Szkic tylko przy tworzeniu z widoku projektu; wszędzie indziej publikacja
      // natychmiastowa (brak flagi). Szkic pomija materializację godzin poniżej.
      isDraft: draft.isDraft === true,
      // Autor zadania — sygnał dla feedu powiadomień. Klucz obecny tylko gdy jest
      // zalogowany użytkownik (spójnie z chmurowym DEFAULT auth.uid()).
      ...(state.currentUserId ? { createdBy: state.currentUserId } : {}),
      // Forma kanoniczna: klucz tylko jako literalne `true`, tylko od zarządu.
      ...(confidentialAllowed && draft.isConfidential === true
        ? { isConfidential: true as const }
        : {}),
      createdAt: ts,
      updatedAt: ts,
    };
    tasks = [...tasks, task];
    realTaskId = task.id;
    created = true;
  } else {
    realTaskId = taskId;
    const prev = state.tasks.find((t) => t.id === taskId)!;
    // Zmiana projektu (edycja) => dopisz na końcu projektu docelowego; ten sam
    // projekt => zachowaj dotychczasową rangę (kolejność jest kosmetyczna).
    const orderIndex =
      prev.projectId === draft.projectId
        ? prev.orderIndex
        : maxOrderIndexOfProject(state, draft.projectId) + 1;
    // Cykliczność jest zachowywana jak `isDraft` (edycja jej nie tyka), Z JEDNYM
    // WYJĄTKIEM: zmiana `startDate` przesuwa kotwicę reguły, więc re-kanonikalizuj
    // wartość względem nowej daty (reguła przeżywa; wyjątki sprzed nowego startu i
    // niepoprawny `until` odpadają). Bez zmiany daty referencja zostaje nietknięta.
    const recurrence =
      prev.recurrence !== undefined && draft.startDate !== prev.startDate
        ? normalizeRecurrence(prev.recurrence, draft.startDate)
        : prev.recurrence;
    tasks = tasks.map((t) => {
      if (t.id !== taskId) return t;
      const next: Task = {
        ...t,
        projectId: draft.projectId,
        statusId: draft.statusId,
        title: draft.title,
        description: draft.description,
        startDate: draft.startDate,
        endDate: draft.endDate,
        estimatedHours: draft.estimatedHours,
        priority: draft.priority,
        workCategoryId,
        departmentId,
        checklist,
        orderIndex,
        // Edycja NIGDY nie zmienia stanu publikacji: zachowaj `isDraft`
        // istniejącego zadania (publikację robią wyłącznie akcje PUBLISH_*).
        isDraft: t.isDraft,
        updatedAt: ts,
      };
      if (recurrence) next.recurrence = recurrence;
      else delete next.recurrence;
      // Utajnienie: wartość z draftu tylko od zarządu; brak pola / nie-zarząd
      // zachowuje stan zadania. Forma kanoniczna (klucz albo `true`, albo go
      // nie ma) — wzorzec delete-key jak `recurrence` wyżej.
      const confidential =
        confidentialAllowed && draft.isConfidential !== undefined
          ? draft.isConfidential === true
          : t.isConfidential === true;
      if (confidential) next.isConfidential = true;
      else delete next.isConfidential;
      return next;
    });
  }

  // Czy WYNIK zapisu jest szkicem? Tworzenie bierze sygnał z draftu, edycja
  // zachowuje stan zadania. Szkic pomija CAŁĄ materializację godzin (zasobnik,
  // kalendarz), bo planowane godziny żyją wyłącznie w `WorkloadEntry` i powstają
  // dopiero po publikacji (inwariant 1 + 4). Przypisania powstają normalnie.
  const resultIsDraft =
    taskId === null
      ? draft.isDraft === true
      : state.tasks.find((t) => t.id === taskId)!.isDraft === true;

  // Rebuild assignments for this task from the desired set.
  const assignmentsOther = state.assignments.filter(
    (a) => a.taskId !== realTaskId,
  );
  const assignmentsForTask: TaskAssignment[] = assigneeIds.map((personId) => ({
    id: uid(),
    taskId: realTaskId,
    personId,
  }));
  // Wiersze przypisań tego zadania dostają NOWE uid, więc stare klucze
  // „przeczytane" feedu (`assignment:<TaskAssignment.id>`, format sprzed
  // 2026-08-19) straciłyby tu odniesienie — przepisujemy je na klucz pary
  // (`assignmentNotificationId`) w tym samym przejściu (patrz helper).
  const people = upgradeLegacyAssignmentReadIds(
    state.people,
    state.currentUserId,
    state.assignments.filter((a) => a.taskId === realTaskId),
  );

  if (resultIsDraft) {
    // Szkic: godziny NIE materializują się w workload (inwariant 1 + 4).
    // Workload zostaje nietknięty — dla świeżego szkicu jest pusty, a przy
    // edycji szkicu nadal pusty. allocations / newUnassigned z modalu są celowo
    // pomijane; plan powstaje dopiero po publikacji. Zapisujemy natomiast
    // INTENCJĘ godzin sprzedanych per osoba (`draftHours`) wyprowadzoną z
    // `binTotals` — w formie kanonicznej (klucz obecny tylko przy ≥1 wpisie).
    // Pusty wynik usuwa klucz (wyczyszczenie godzin przy edycji szkicu).
    const draftHours = draftHoursFromBinTotals(payload.binTotals, assigneeIds);
    const draftTasks = tasks.map((t) => {
      if (t.id !== realTaskId) return t;
      if (draftHours) return { ...t, draftHours };
      if (t.draftHours === undefined) return t;
      const { draftHours: _drop, ...rest } = t;
      return rest;
    });
    return {
      ...state,
      people,
      tasks: draftTasks,
      assignments: [...assignmentsOther, ...assignmentsForTask],
      workload: state.workload,
      activity: withActivity(
        state,
        'task',
        realTaskId,
        created ? 'utworzył(a) szkic zadania' : 'zaktualizował(a) szkic zadania',
        undefined,
        { collapse: !created },
      ),
    };
  }

  // Reconcile this task's DATED workload against the desired per-(person,date)
  // day totals by DELTA — never a drop-and-recreate — so existing blocks keep
  // their identity (id, startMinutes, sortIndex) and multi-block days survive.
  // A cell's `plannedHours` is the person's desired total for that day.
  const assignedSet = new Set(assigneeIds);
  // Existing BIN entries of this task pass through untouched: kept when the
  // person is still assigned, dropped when they are unassigned. Only DATED
  // entries go through the reconciliation below.
  const taskBinKept = state.workload.filter(
    (w) => w.taskId === realTaskId && isBinEntry(w) && assignedSet.has(w.personId),
  );
  const workloadOther = state.workload.filter((w) => w.taskId !== realTaskId);

  // Group this task's existing dated entries by (person, date) pair.
  const datedByPair = new Map<string, WorkloadEntry[]>();
  for (const w of state.workload) {
    if (w.taskId !== realTaskId || isBinEntry(w)) continue;
    const key = dayKey(w.personId, w.date);
    const list = datedByPair.get(key);
    if (list) list.push(w);
    else datedByPair.set(key, [w]);
  }

  // Desired day total per pair (assigned people only; unassigned cells skipped).
  const cellByPair = new Map<string, { personId: string; date: string; totalQ: number }>();
  // Opcjonalna przypięta godzina startu per para — stosowana w JEDNYM przebiegu
  // PO rekoncyliacji (patrz niżej), więc gałęzie delty zostają nietknięte.
  const wantStartByPair = new Map<string, number>();
  for (const c of allocations) {
    if (!assignedSet.has(c.personId)) continue;
    const pairKey = dayKey(c.personId, c.date);
    // Snap to the 0.25h grid before quarter conversion (input step is UI-only).
    cellByPair.set(pairKey, {
      personId: c.personId,
      date: c.date,
      totalQ: toQuarters(snapHours(c.plannedHours)),
    });
    if (c.startMinutes !== undefined) wantStartByPair.set(pairKey, c.startMinutes);
  }

  // Union of pairs to process: existing dated pairs of STILL-ASSIGNED people
  // (unassigned people's dated entries are dropped, as before) + cell pairs.
  const pairKeys = new Set<string>();
  for (const [key, list] of datedByPair) {
    if (assignedSet.has(list[0].personId)) pairKeys.add(key);
  }
  for (const key of cellByPair.keys()) pairKeys.add(key);

  const touched = new Set<string>();
  const workloadForTask: WorkloadEntry[] = [];
  for (const key of pairKeys) {
    const blocks = (datedByPair.get(key) ?? [])
      .slice()
      .sort((a, b) => a.startMinutes - b.startMinutes || a.sortIndex - b.sortIndex);
    const cell = cellByPair.get(key);
    const personId = cell ? cell.personId : blocks[0].personId;
    const date = cell ? cell.date : blocks[0].date;
    const tNew = cell ? cell.totalQ : 0;
    const tOld = blocks.reduce((s, b) => s + toQuarters(b.plannedHours), 0);

    if (tNew === tOld) {
      // No change: keep every block byte-identical; pair NOT touched.
      for (const b of blocks) workloadForTask.push(b);
      continue;
    }
    if (tNew > 0 && tOld === 0) {
      // New pair: append exactly one entry to the end of that person's day
      // (across all tasks), matching the legacy new-cell behavior.
      const hours = tNew * HOURS_STEP;
      const around = [...workloadOther, ...taskBinKept, ...workloadForTask];
      const dayList = around.filter((w) => w.personId === personId && w.date === date);
      const durMin = hoursToMinutes(hours);
      workloadForTask.push({
        id: uid(),
        taskId: realTaskId,
        personId,
        date,
        plannedHours: hours,
        // Prefer a collision-free slot; fall back to nextFreeStart's clamp so
        // SAVE_TASK never rejects on placement (invariant 3 — editor edits may
        // create overlaps, which the week view renders side-by-side).
        startMinutes: findFreeStart(dayList, durMin) ?? nextFreeStart(dayList, durMin),
        sortIndex: nextSortIndex(around, personId, date),
      });
      touched.add(key);
      continue;
    }
    if (tNew === 0) {
      // Cell zeroed or absent (dropped by the period filter): user-explicit
      // deletion of all the pair's blocks.
      touched.add(key);
      continue;
    }
    if (tNew > tOld) {
      // Grow: add the whole delta to the LAST block (keep its id/sortIndex),
      // clamping so it still ends by 24:00.
      const deltaQ = tNew - tOld;
      const last = blocks[blocks.length - 1];
      for (const b of blocks) {
        if (b.id !== last.id) {
          workloadForTask.push(b);
          continue;
        }
        const newHours = (toQuarters(b.plannedHours) + deltaQ) * HOURS_STEP;
        const startMinutes = clampBlockStart(b.startMinutes, hoursToMinutes(newHours));
        if (startMinutes !== b.startMinutes) touched.add(key);
        workloadForTask.push({ ...b, plannedHours: newHours, startMinutes });
      }
      continue;
    }
    // 0 < tNew < tOld: trim from the end. Walk blocks descending, reducing each
    // by min(block, deficit); a block reaching 0 is deleted; survivors keep id
    // and startMinutes. Any deletion touches the pair (re-index for order).
    let deficit = tOld - tNew;
    const survivorById = new Map<string, WorkloadEntry>();
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (deficit <= 0) {
        survivorById.set(b.id, b);
        continue;
      }
      const q = toQuarters(b.plannedHours);
      const cut = Math.min(q, deficit);
      deficit -= cut;
      const remainingQ = q - cut;
      if (remainingQ <= 0) {
        touched.add(key); // deletion changes the pair's row set
      } else {
        survivorById.set(b.id, { ...b, plannedHours: remainingQ * HOURS_STEP });
      }
    }
    // Emit survivors in original ascending order.
    for (const b of blocks) {
      const s = survivorById.get(b.id);
      if (s) workloadForTask.push(s);
    }
  }

  // Opcjonalna przypięta godzina startu z komórki siatki: JEDEN przebieg po
  // wyemitowanych wpisach, wspólny dla wszystkich czterech gałęzi wyżej (przy
  // nowej parze nadpisuje wynik findFreeStart/nextFreeStart). Stosowany TYLKO
  // gdy para (osoba, dzień) ma po zapisie DOKŁADNIE jeden blok — dzień
  // wielo-blokowy zachowuje swoje upakowanie (UI nie oferuje tam pola).
  // Pin jest CLAMPOWANY do doby, nigdy odrzucany, i wolno mu tworzyć nakładkę
  // (inwariant 3 — SAVE_TASK nie odrzuca na umiejscowieniu). Bez pinów w
  // ładunku ten blok nie wykonuje żadnej pracy, więc wynik zostaje bajtowo
  // identyczny z dotychczasowym.
  if (wantStartByPair.size > 0) {
    const emittedIndexByPair = new Map<string, number[]>();
    workloadForTask.forEach((w, i) => {
      const k = dayKey(w.personId, w.date);
      const list = emittedIndexByPair.get(k);
      if (list) list.push(i);
      else emittedIndexByPair.set(k, [i]);
    });
    for (const [key, want] of wantStartByPair) {
      const indexes = emittedIndexByPair.get(key);
      if (!indexes || indexes.length !== 1) continue; // 0 lub ≥2 bloki — pomijamy
      const idx = indexes[0];
      const entry = workloadForTask[idx];
      const start = clampBlockStart(want, hoursToMinutes(entry.plannedHours));
      if (start === entry.startMinutes) continue;
      workloadForTask[idx] = { ...entry, startMinutes: start };
      touched.add(key);
    }
  }

  // Explicitly-requested bin hours (person must be assigned; snap hours, skip
  // <= 0). One-bin-row invariant: aggregate all items per person into a single
  // total, then merge into the person's passed-through bin row when present,
  // otherwise create one fresh bin row.
  const addByPersonQ = new Map<string, number>();
  for (const item of payload.newUnassigned ?? []) {
    if (!assignedSet.has(item.personId)) continue;
    const hours = snapHours(item.hours);
    if (hours <= 0) continue;
    addByPersonQ.set(
      item.personId,
      (addByPersonQ.get(item.personId) ?? 0) + Math.round(hours / HOURS_STEP),
    );
  }
  const mergedTaskBinKept = taskBinKept.map((w) => {
    const addQ = addByPersonQ.get(w.personId);
    if (addQ === undefined) return w;
    addByPersonQ.delete(w.personId); // consumed — the rest become fresh rows
    return { ...w, plannedHours: (Math.round(w.plannedHours / HOURS_STEP) + addQ) * HOURS_STEP };
  });
  const newBinEntries: WorkloadEntry[] = [];
  for (const [personId, addQ] of addByPersonQ) {
    const accumulated = [...workloadOther, ...mergedTaskBinKept, ...workloadForTask, ...newBinEntries];
    newBinEntries.push({
      id: uid(),
      taskId: realTaskId,
      personId,
      date: BIN_DATE,
      plannedHours: addQ * HOURS_STEP,
      startMinutes: 0,
      sortIndex: nextSortIndex(accumulated, personId, BIN_DATE),
    });
  }

  // Absolutne cele zasobnika (przepływ „godziny sprzedane per osoba”):
  // rekoncyliacja DO celu po ścieżce addytywnej. Pierwszy wiersz osoby
  // zachowuje tożsamość i przyjmuje cel; duplikaty pary (obrona invariantu 4)
  // i wiersze wyzerowanego celu odpadają; cel > 0 bez wiersza => jeden świeży.
  const targetByPersonQ = new Map<string, number>();
  for (const item of payload.binTotals ?? []) {
    if (!assignedSet.has(item.personId)) continue;
    targetByPersonQ.set(item.personId, Math.round(snapHours(item.hours) / HOURS_STEP));
  }
  let binAfterTargets = [...mergedTaskBinKept, ...newBinEntries];
  if (targetByPersonQ.size > 0) {
    const seenBinPerson = new Set<string>();
    const reconciled: WorkloadEntry[] = [];
    for (const w of binAfterTargets) {
      const targetQ = targetByPersonQ.get(w.personId);
      if (targetQ === undefined) {
        reconciled.push(w);
        continue;
      }
      if (seenBinPerson.has(w.personId)) continue; // duplikat pary — odpada
      seenBinPerson.add(w.personId);
      if (targetQ <= 0) continue; // cel 0 => wiersz usunięty
      const hours = targetQ * HOURS_STEP;
      reconciled.push(w.plannedHours === hours ? w : { ...w, plannedHours: hours });
    }
    for (const [personId, targetQ] of targetByPersonQ) {
      if (seenBinPerson.has(personId) || targetQ <= 0) continue;
      const accumulated = [...workloadOther, ...reconciled, ...workloadForTask];
      reconciled.push({
        id: uid(),
        taskId: realTaskId,
        personId,
        date: BIN_DATE,
        plannedHours: targetQ * HOURS_STEP,
        startMinutes: 0,
        sortIndex: nextSortIndex(accumulated, personId, BIN_DATE),
      });
    }
    binAfterTargets = reconciled;
  }

  return {
    ...state,
    people,
    tasks,
    assignments: [...assignmentsOther, ...assignmentsForTask],
    // Reindex only the touched dated pairs; untouched pairs' rows (and all bin
    // rows) come out byte-identical.
    workload: reindexDays(
      [...workloadOther, ...binAfterTargets, ...workloadForTask],
      touched,
    ),
    activity: withActivity(
      state,
      'task',
      realTaskId,
      created ? 'utworzył(a) zadanie' : 'zaktualizował(a) zadanie',
      undefined,
      // Auto-zapis zapisuje często: kolejne identyczne „zaktualizował(a)” tego
      // samego aktora scala się w jeden wpis (świeży znacznik czasu).
      { collapse: !created },
    ),
  };
}

/**
 * Duplikat zadania („Duplikuj zadanie”, zgłoszenie 2026-08-06). Kopiuje treść
 * zadania (tytuł z dopiskiem „ - kopia( N)” — `copyTitle`, unikalność w obrębie
 * PROJEKTU), przypisania osób oraz SUMĘ godzin każdej osoby (kalendarz +
 * zasobnik źródła) jako JEDEN świeży wiersz zasobnika na osobę — kopia nigdy
 * nie klonuje umiejscowienia w kalendarzu, więc nie może stworzyć kolizji
 * (inwariant 3) i respektuje jeden-wiersz-zasobnika-na-parę (inwariant 4).
 * Szkic kopiuje się jako szkic (z `draftHours`, bez workload — inwariant 1).
 * Reguła cykliczności przechodzi BEZ per-datowych wyjątków (`overrides` —
 * pominięcia/wykonania należą do źródła). Dziennik, komentarze i wykonanie
 * bloków zostają przy źródle. `newTaskId` przychodzi od wywołującego (żeby UI
 * mogło otworzyć kopię); nieznane `taskId` albo kolizja `newTaskId` => TA SAMA
 * referencja stanu (inwariant 6).
 */
function duplicateTask(state: AppData, taskId: string, newTaskId: string): AppData {
  const source = state.tasks.find((t) => t.id === taskId);
  if (!source) return state;
  if (newTaskId === '' || state.tasks.some((t) => t.id === newTaskId)) return state;
  const ts = nowIso();

  // Unikalność dopisku liczona w obrębie projektu — tam nazwy pracują obok
  // siebie na listach; identyczne tytuły w INNYCH projektach nie blokują.
  const projectTitles = state.tasks
    .filter((t) => t.projectId === source.projectId)
    .map((t) => t.title);

  const copy: Task = {
    id: newTaskId,
    projectId: source.projectId,
    statusId: source.statusId,
    title: copyTitle(projectTitles, source.title),
    description: source.description,
    startDate: source.startDate,
    endDate: source.endDate,
    estimatedHours: source.estimatedHours,
    priority: source.priority,
    workCategoryId: source.workCategoryId,
    departmentId: source.departmentId,
    // Świeże id pozycji checklisty — stan odhaczenia jedzie ze źródłem.
    checklist: source.checklist.map((item) => ({ ...item, id: uid() })),
    orderIndex: maxOrderIndexOfProject(state, source.projectId) + 1,
    isDraft: source.isDraft === true,
    ...(source.isDraft === true && source.draftHours !== undefined
      ? { draftHours: source.draftHours.map((d) => ({ ...d })) }
      : {}),
    ...(source.recurrence !== undefined
      ? {
          recurrence: {
            daysOfWeek: [...source.recurrence.daysOfWeek],
            startMinutes: source.recurrence.startMinutes,
            durationMinutes: source.recurrence.durationMinutes,
            ...(source.recurrence.intervalWeeks !== undefined
              ? { intervalWeeks: source.recurrence.intervalWeeks }
              : {}),
            ...(source.recurrence.until !== undefined ? { until: source.recurrence.until } : {}),
          },
        }
      : {}),
    ...(source.isConfidential === true ? { isConfidential: true as const } : {}),
    // Autorem KOPII jest duplikujący, nie autor źródła.
    ...(state.currentUserId ? { createdBy: state.currentUserId } : {}),
    createdAt: ts,
    updatedAt: ts,
  };

  const assignments: TaskAssignment[] = state.assignments
    .filter((a) => a.taskId === taskId)
    .map((a) => ({ id: uid(), taskId: newTaskId, personId: a.personId }));

  // Suma godzin źródła per osoba (kalendarz + zasobnik) → jeden wiersz
  // zasobnika kopii. Kwadranse (inwariant 2) przez arytmetykę na ćwiartkach.
  const workload = [...state.workload];
  if (copy.isDraft !== true) {
    const totalQByPerson = new Map<string, number>();
    for (const w of state.workload) {
      if (w.taskId !== taskId) continue;
      totalQByPerson.set(
        w.personId,
        (totalQByPerson.get(w.personId) ?? 0) + Math.round(w.plannedHours / HOURS_STEP),
      );
    }
    for (const a of assignments) {
      const q = totalQByPerson.get(a.personId) ?? 0;
      if (q <= 0) continue;
      workload.push({
        id: uid(),
        taskId: newTaskId,
        personId: a.personId,
        date: BIN_DATE,
        plannedHours: q * HOURS_STEP,
        startMinutes: 0,
        sortIndex: nextSortIndex(workload, a.personId, BIN_DATE),
      });
    }
  }

  return {
    ...state,
    tasks: [...state.tasks, copy],
    assignments: [...state.assignments, ...assignments],
    workload,
    activity: withActivity(
      state,
      'task',
      newTaskId,
      source.isConfidential === true
        ? 'utworzył(a) kopię utajnionego zadania'
        : `utworzył(a) kopię zadania „${source.title}”`,
    ),
  };
}

/**
 * „Edytuj wszystkie" / utworzenie reguły / wyczyszczenie cykliczności zadania.
 * Odrzuca (TA SAMA referencja, inwariant 6): nieznane `taskId`; zadanie-szkic
 * (szkic nie może nieść reguły); niepoprawna `task.startDate`;
 * `normalizeRecurrenceRule` zwraca null (pusty/poza zakresem `daysOfWeek`, czasy
 * poza siatką/nieskończone, duration <= 0, start+duration > 1440, `until`
 * niepoprawny lub < startu). `recurrence: null` czyści regułę I jej wyjątki.
 * Zmiana reguły ZACHOWUJE dotychczasowe wyjątki i re-kanonikalizuje je względem
 * nowej reguły (nieaktualne daty i teraz-równe przesunięcia odpadają). Zapis
 * wartościowo identyczny to no-op (ta sama referencja).
 */
function setTaskRecurrence(
  state: AppData,
  taskId: string,
  recurrence:
    | { daysOfWeek: number[]; startMinutes: number; durationMinutes: number; until?: string }
    | null,
): AppData {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return state;
  // Szkic nie może nieść reguły (forma kanoniczna); niepoprawny start = brak kotwicy.
  if (task.isDraft === true) return state;
  if (!isValidDateStr(task.startDate)) return state;

  if (recurrence === null) {
    if (task.recurrence === undefined) return state; // brak reguły => no-op
    const tasks = state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const { recurrence: _drop, ...rest } = t;
      return { ...rest, updatedAt: nowIso() };
    });
    return {
      ...state,
      tasks,
      activity: withActivity(state, 'task', taskId, 'wyłączył(a) cykliczność zadania'),
    };
  }

  // Zachowaj istniejące wyjątki i re-kanonikalizuj je względem nowej reguły.
  const next = normalizeRecurrence(
    { ...recurrence, overrides: task.recurrence?.overrides },
    task.startDate,
  );
  if (!next) return state; // reguła niepoprawna => ta sama referencja
  if (task.recurrence !== undefined && sameRowValue(task.recurrence, next)) return state;
  const tasks = state.tasks.map((t) =>
    t.id === taskId ? { ...t, recurrence: next, updatedAt: nowIso() } : t,
  );
  return {
    ...state,
    tasks,
    activity: withActivity(state, 'task', taskId, 'zmienił(a) cykliczność zadania'),
  };
}

/**
 * „Edytuj to wystąpienie": per-datowy wyjątek reguły cykliczności. Odrzuca (TA
 * SAMA referencja, inwariant 6): nieznane `taskId`; zadanie bez `recurrence`;
 * `date` niebędące datą wystąpienia (`isOccurrenceDate`); przesunięcie czasu
 * poza siatką / duration < 15 / start+duration > 1440; strukturalnie zły ładunek.
 * `override: null` usuwa CAŁY wyjątek dla `date` — razem z flagą `done`
 * pojedynczego wystąpienia („przywróć zgodnie z regułą"); brak wyjątku => no-op.
 * Przesunięcie czasu ZACHOWUJE istniejące `done` tej daty; przesunięcie równe
 * regule usuwa wyjątek, a przy zachowanym `done` zwija się do `{date, done:true}`
 * (forma kanoniczna). Gałąź `skip` z definicji nie niesie `done` (pominięty dzień
 * nie ma wystąpienia). Upsert po dacie; wynik posortowany.
 */
function setRecurrenceOverride(
  state: AppData,
  taskId: string,
  date: string,
  override: { skip: true } | { startMinutes: number; durationMinutes: number } | null,
): AppData {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return state;
  const rule = task.recurrence;
  if (rule === undefined) return state;
  if (!isOccurrenceDate(rule, task.startDate, date)) return state;

  const existing = rule.overrides ?? [];
  const others = existing.filter((o) => o.date !== date);
  let nextOverrides: unknown[];
  if (override === null) {
    if (existing.length === others.length) return state; // brak wyjątku => no-op
    nextOverrides = others;
  } else if ('skip' in override && override.skip === true) {
    nextOverrides = [...others, { date, skip: true }];
  } else {
    const rec = override as { startMinutes?: unknown; durationMinutes?: unknown };
    const { startMinutes, durationMinutes } = rec;
    const isGrid = (m: unknown): m is number =>
      typeof m === 'number' && Number.isInteger(m) && m >= 0 && m <= DAY_MINUTES && m % MINUTE_STEP === 0;
    if (
      !isGrid(startMinutes) ||
      !isGrid(durationMinutes) ||
      durationMinutes < MINUTE_STEP ||
      startMinutes + durationMinutes > DAY_MINUTES
    ) {
      return state; // poza siatką / za krótki / strukturalnie zły
    }
    // Przesunięcie czasu NIE kasuje wykonania pojedynczego wystąpienia.
    const prevDone = existing.some((o) => o.date === date && o.done === true);
    nextOverrides = [
      ...others,
      { date, ...(prevDone ? { done: true as const } : {}), startMinutes, durationMinutes },
    ];
  }

  // Re-kanonikalizacja: przesunięcie równe regule odpada, wynik sortowany.
  const next = normalizeRecurrence({ ...rule, overrides: nextOverrides }, task.startDate);
  if (!next) return state; // reguła jest już kanoniczna — guard dla TS
  if (sameRowValue(rule, next)) return state; // np. przesunięcie równe regule => no-op
  const tasks = state.tasks.map((t) =>
    t.id === taskId ? { ...t, recurrence: next, updatedAt: nowIso() } : t,
  );
  return {
    ...state,
    tasks,
    activity: withActivity(state, 'task', taskId, 'zmienił(a) wystąpienie cyklicznego zadania'),
  };
}

/**
 * Wykonanie POJEDYNCZEGO wystąpienia cyklicznego zadania: flaga `done` w
 * wyjątku danej daty (wzorzec `SET_BLOCK_DONE`). NIGDY nie zmienia
 * `Task.statusId` — całą serię przełącza `SET_TASK_STATUS` — i nie tworzy
 * żadnych wierszy workload (inwariant 1, wystąpienia zostają prezentacyjne).
 * Odrzuca (TA SAMA referencja, inwariant 6): nieznane `taskId`; zadanie bez
 * `recurrence`; `date` niebędące datą wystąpienia; data z wyjątkiem
 * `{ skip: true }` (pominięty dzień nie ma wystąpienia do oznaczenia);
 * no-op (`done: true` na już zrobionym, `done: false` na dacie bez flagi) —
 * strukturalnie domyka to strażnik `sameRowValue(rule, next)`.
 * `done: true` ZACHOWUJE istniejące przesunięcie czasu; `done: false` usuwa sam
 * klucz `done`, a wyjątek bez przesunięcia znika w całości (forma kanoniczna).
 */
function setOccurrenceDone(
  state: AppData,
  taskId: string,
  date: string,
  done: boolean,
): AppData {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return state;
  const rule = task.recurrence;
  if (rule === undefined) return state;
  if (!isOccurrenceDate(rule, task.startDate, date)) return state;

  const existing = rule.overrides ?? [];
  const current = existing.find((o) => o.date === date);
  if (current?.skip === true) return state; // pominięty dzień => brak wystąpienia
  const others = existing.filter((o) => o.date !== date);

  let nextOverrides: unknown[];
  if (done === true) {
    const { done: _drop, ...keep } = current ?? { date };
    nextOverrides = [...others, { ...keep, date, done: true as const }];
  } else {
    if (current === undefined || current.done !== true) return state; // no-op
    const { done: _drop, ...keep } = current;
    nextOverrides = [...others, { ...keep, date }];
  }

  // Re-kanonikalizacja: wyjątek bez `done` i bez przesunięcia odpada, sort po dacie.
  const next = normalizeRecurrence({ ...rule, overrides: nextOverrides }, task.startDate);
  if (!next) return state; // reguła jest już kanoniczna — strażnik dla TS
  if (sameRowValue(rule, next)) return state; // brak zmiany wartości => no-op
  const tasks = state.tasks.map((t) =>
    t.id === taskId ? { ...t, recurrence: next, updatedAt: nowIso() } : t,
  );
  return {
    ...state,
    tasks,
    activity: withActivity(
      state,
      'task',
      taskId,
      done
        ? 'oznaczył(a) wystąpienie cyklicznego zadania jako zrobione'
        : 'cofnął(-ęła) wykonanie wystąpienia cyklicznego zadania',
    ),
  };
}

/** Zadanie opublikowane ze szkicu: `isDraft: false`, świeży `updatedAt`, a klucz
 *  `draftHours` USUNIĘTY (rest-destrukturyzacja — sam spread z `isDraft: false`
 *  zostawiłby klucz; forma kanoniczna zabrania go na zadaniu opublikowanym). */
function publishedTask(task: Task, ts: string): Task {
  const { draftHours: _drop, ...rest } = task;
  return { ...rest, isDraft: false, updatedAt: ts };
}

/**
 * Publikacja WSZYSTKICH szkiców projektu jedną atomową akcją („Zapisz i
 * opublikuj”). Dla każdego szkicu: przełącza `isDraft` na `false`, USUWA
 * `draftHours` i MATERIALIZUJE jego godziny w wiersze zasobnika (jeden na
 * osobę, inwariant 4) — wszystko w JEDNEJ transakcji stanu. Nieistniejący
 * projekt albo brak szkiców => TA SAMA referencja stanu (inwariant 6).
 */
function publishProjectDrafts(state: AppData, projectId: string): AppData {
  if (!hasEntity(state, 'project', projectId)) return state;
  const drafts = state.tasks.filter((t) => t.projectId === projectId && t.isDraft === true);
  if (drafts.length === 0) return state;
  const draftIds = new Set(drafts.map((t) => t.id));
  const ts = nowIso();
  const newRows: WorkloadEntry[] = [];
  for (const task of drafts) {
    newRows.push(...materializeDraftBin(state, [...state.workload, ...newRows], task));
  }
  return {
    ...state,
    tasks: state.tasks.map((t) => (draftIds.has(t.id) ? publishedTask(t, ts) : t)),
    workload: newRows.length > 0 ? [...state.workload, ...newRows] : state.workload,
    activity: withActivity(
      state,
      'project',
      projectId,
      `opublikował(a) szkice zadań (${draftIds.size})`,
    ),
  };
}

/**
 * Publikacja pojedynczego szkicu (bonus: „opublikuj” per zadanie). Zadanie musi
 * istnieć i być szkicem — inaczej TA SAMA referencja stanu (inwariant 6).
 * Materializuje `draftHours` w wiersze zasobnika i usuwa klucz.
 */
function publishTask(state: AppData, taskId: string): AppData {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || task.isDraft !== true) return state;
  const ts = nowIso();
  const newRows = materializeDraftBin(state, state.workload, task);
  return {
    ...state,
    tasks: state.tasks.map((t) => (t.id === taskId ? publishedTask(t, ts) : t)),
    workload: newRows.length > 0 ? [...state.workload, ...newRows] : state.workload,
    activity: withActivity(state, 'task', taskId, 'opublikował(a) zadanie'),
  };
}

function deleteTask(state: AppData, taskId: string): AppData {
  return {
    ...state,
    tasks: state.tasks.filter((t) => t.id !== taskId),
    assignments: state.assignments.filter((a) => a.taskId !== taskId),
    workload: state.workload.filter((w) => w.taskId !== taskId),
    // Wpisy czasu usuniętego zadania idą za nim (każda minuta musi mieć zadanie).
    timeEntries: keepArrayIfSame(
      state.timeEntries,
      state.timeEntries.filter((e) => e.taskId !== taskId),
    ),
    comments: state.comments.filter(
      (c) => !(c.entityType === 'task' && c.entityId === taskId),
    ),
    activity: state.activity.filter(
      (e) => !(e.entityType === 'task' && e.entityId === taskId),
    ),
  };
}

/**
 * Twarda granica delty przesunięcia (dni). UI generuje najwyżej deltę rzędu
 * szerokości viewportu / ±1; wartości poza tym progiem to uszkodzony stan albo
 * ręczny dispatch — a `addDaysStr` na ekstremalnej dacie rzuca RangeError
 * (`format(Invalid Date)`), łamiąc inwariant 6. Odrzucamy komendę zamiast
 * ryzykować crash reduktora.
 */
const MAX_MOVE_DELTA_DAYS = 3650;

/** Shift a task and ALL its time blocks by whole days (timeline drag). */
function moveTask(state: AppData, taskId: string, dayDelta: number): AppData {
  if (!Number.isFinite(dayDelta) || !Number.isInteger(dayDelta) || dayDelta === 0) return state;
  if (Math.abs(dayDelta) > MAX_MOVE_DELTA_DAYS) return state;
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return state;
  const touched = new Set<string>();
  const workload = state.workload.map((w) => {
    if (w.taskId !== taskId || isBinEntry(w)) return w; // bin entries stay in the bin
    const newDate = addDaysStr(w.date, dayDelta);
    touched.add(dayKey(w.personId, w.date));
    touched.add(dayKey(w.personId, newDate));
    return { ...w, date: newDate };
  });
  return {
    ...state,
    tasks: state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const startDate = addDaysStr(t.startDate, dayDelta);
      const next: Task = {
        ...t,
        startDate,
        endDate: addDaysStr(t.endDate, dayDelta),
        updatedAt: nowIso(),
      };
      // Cykliczność jedzie z zadaniem: okno `until` przesuwa się o tę samą
      // deltę, a całość jest RE-KANONIKALIZOWANA względem nowej kotwicy —
      // reduktor nie może wypuścić stanu, który loader (repair w storage.ts)
      // odrzuci przy następnym odczycie (dotąd move poza `until` kasował regułę
      // dopiero po reloadzie, cicho). Wyjątki (overrides) zostają na swoich
      // datach wystąpień; te, które wypadną z przesuniętego okna albo fazy
      // `intervalWeeks`, odpadają w normalizacji.
      if (t.recurrence !== undefined) {
        const shifted =
          t.recurrence.until !== undefined
            ? { ...t.recurrence, until: addDaysStr(t.recurrence.until, dayDelta) }
            : t.recurrence;
        const recurrence = normalizeRecurrence(shifted, startDate);
        if (recurrence) next.recurrence = recurrence;
        else delete next.recurrence;
      }
      return next;
    }),
    workload: reindexDays(workload, touched),
    activity: withActivity(
      state,
      'task',
      taskId,
      `przesunął/przesunęła zadanie o ${dayDelta > 0 ? '+' : ''}${dayDelta} dni`,
    ),
  };
}

/**
 * Resize a task period (timeline). Blocks outside the new period are dropped
 * from the calendar, but their hours are NOT lost: they are folded per person
 * into the (task, person) bin row (CAL-01 — "the sold total is the contract",
 * parity with moveBlockToBin). One-bin-row invariant holds: an existing bin
 * row absorbs the sum (its id survives), a missing one is created from the
 * first dropped entry of that person.
 */
function setTaskDates(
  state: AppData,
  taskId: string,
  startDate: string,
  endDate: string,
): AppData {
  if (periodError(startDate, endDate, { maxDays: MAX_TASK_PERIOD_DAYS }) !== null) return state;
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || (task.startDate === startDate && task.endDate === endDate)) return state;
  const inPeriod = new Set(eachDayInclusive(startDate, endDate));

  // Usuwane datowane wpisy: suma kwadransów per osoba + pierwszy wpis osoby
  // (dawca tożsamości nowego binu, gdy para (task, person) binu nie ma).
  const droppedQuartersByPerson = new Map<string, number>();
  const donorByPerson = new Map<string, WorkloadEntry>();
  for (const w of state.workload) {
    if (w.taskId !== taskId || isBinEntry(w) || inPeriod.has(w.date)) continue;
    droppedQuartersByPerson.set(
      w.personId,
      (droppedQuartersByPerson.get(w.personId) ?? 0) + toQuarters(w.plannedHours),
    );
    if (!donorByPerson.has(w.personId)) donorByPerson.set(w.personId, w);
  }

  const touched = new Set<string>();
  let workload = state.workload.filter(
    (w) => w.taskId !== taskId || isBinEntry(w) || inPeriod.has(w.date),
  );
  for (const [personId, quarters] of droppedQuartersByPerson) {
    if (quarters <= 0) continue;
    touched.add(dayKey(personId, BIN_DATE));
    const existingBin = workload.find(
      (w) => w.taskId === taskId && w.personId === personId && isBinEntry(w),
    );
    if (existingBin) {
      const sumQ = toQuarters(existingBin.plannedHours) + quarters;
      workload = workload.map((w) =>
        w.id === existingBin.id ? { ...w, plannedHours: sumQ * HOURS_STEP } : w,
      );
    } else {
      const donor = donorByPerson.get(personId)!;
      workload = [
        ...workload,
        {
          ...donor,
          date: BIN_DATE,
          plannedHours: quarters * HOURS_STEP,
          startMinutes: 0,
          sortIndex: nextSortIndex(workload, personId, BIN_DATE),
        },
      ];
    }
  }

  return {
    ...state,
    tasks: state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const next: Task = { ...t, startDate, endDate, updatedAt: nowIso() };
      // Zmiana startu przesuwa kotwicę reguły — re-kanonikalizacja jak w
      // SAVE_TASK (AppStore ~755): stan na żywo musi być tym samym stanem,
      // który przetrwa reload (loader odrzuca `until` < start, kasując CAŁĄ
      // regułę — lepiej zrobić to jawnie teraz niż cicho po restarcie).
      if (t.recurrence !== undefined) {
        const recurrence = normalizeRecurrence(t.recurrence, startDate);
        if (recurrence) next.recurrence = recurrence;
        else delete next.recurrence;
      }
      return next;
    }),
    workload: touched.size > 0 ? reindexDays(workload, touched) : workload,
    activity: withActivity(
      state,
      'task',
      taskId,
      `zmienił(a) okres zadania na ${startDate} – ${endDate}`,
    ),
  };
}

// ---- Project handlers ----

function saveProject(
  state: AppData,
  projectId: string | null,
  draft: ProjectDraft,
): AppData {
  // Reject an invalid/empty/reversed period (no max-days cap for projects).
  if (periodError(draft.startDate, draft.endDate) !== null) return state;
  // Reject a stale edit id (a ghost id would append a garbage activity row).
  if (projectId !== null && !hasEntity(state, 'project', projectId)) return state;
  const existing = projectId === null ? null : state.projects.find((p) => p.id === projectId) ?? null;
  // Name required; statusId must exist; client rule (strict on create, an
  // UNCHANGED dangling clientId stays editable on a legacy orphan project).
  if (!isValidProjectDraft(state, draft, existing)) return state;
  const ts = nowIso();
  // Spółka wykonawcza: nieznane id nie może wejść do stanu (kaskada
  // DELETE_COMPANY utrzymuje potem czystość) — koercja do '' zamiast odmowy.
  const companyId = state.companies.some((c) => c.id === draft.companyId)
    ? draft.companyId
    : '';
  // Utajnienie idzie OSOBNĄ ścieżką (forma kanoniczna: klucz albo `true`, albo
  // nieobecny), więc nie może wejść do stanu spreadem draftu jako boolean.
  const { isConfidential: draftConfidential, ...projectFields } = { ...draft, companyId };
  const confidentialAllowed = isBoardMember(state);

  if (projectId === null) {
    // `documents` nie jest częścią draftu — nowy projekt startuje bez odnośników,
    // a edycja projektu (niżej) przenosi istniejącą listę bez zmian.
    const project: Project = {
      id: uid(),
      ...projectFields,
      documents: [],
      ...(confidentialAllowed && draftConfidential === true
        ? { isConfidential: true as const }
        : {}),
      createdAt: ts,
      updatedAt: ts,
    };
    return {
      ...state,
      projects: [...state.projects, project],
      activity: withActivity(state, 'project', project.id, 'utworzył(a) projekt'),
    };
  }
  return {
    ...state,
    projects: state.projects.map((p) => {
      if (p.id !== projectId) return p;
      // Wartość z draftu tylko od zarządu; brak pola / nie-zarząd zachowuje
      // stan projektu (wzorzec delete-key jak `recurrence` w saveTask).
      const confidential =
        confidentialAllowed && draftConfidential !== undefined
          ? draftConfidential === true
          : p.isConfidential === true;
      const next: Project = { ...p, ...projectFields, updatedAt: ts };
      if (confidential) next.isConfidential = true;
      else delete next.isConfidential;
      return next;
    }),
    activity: withActivity(state, 'project', projectId, 'zaktualizował(a) projekt', undefined, {
      collapse: true, // auto-zapis: seria edycji = jeden wpis
    }),
  };
}

/** Etykieta dokumentu w dzienniku aktywności: nazwa, a gdy jej brak — adres. */
function documentTitle(doc: Pick<ProjectDocument, 'label' | 'url'>): string {
  return doc.label.trim() || doc.url.trim();
}

function deleteProject(state: AppData, projectId: string): AppData {
  const taskIds = new Set(
    state.tasks.filter((t) => t.projectId === projectId).map((t) => t.id),
  );
  return {
    ...state,
    projects: state.projects.filter((p) => p.id !== projectId),
    milestones: state.milestones.filter((m) => m.projectId !== projectId),
    tasks: state.tasks.filter((t) => !taskIds.has(t.id)),
    assignments: state.assignments.filter((a) => !taskIds.has(a.taskId)),
    workload: state.workload.filter((w) => !taskIds.has(w.taskId)),
    timeEntries: keepArrayIfSame(
      state.timeEntries,
      state.timeEntries.filter((e) => !taskIds.has(e.taskId)),
    ),
    comments: state.comments.filter((c) =>
      c.entityType === 'project'
        ? c.entityId !== projectId
        : !taskIds.has(c.entityId),
    ),
    activity: state.activity.filter((e) =>
      e.entityType === 'project'
        ? e.entityId !== projectId
        : !taskIds.has(e.entityId),
    ),
    // Kaskada filtrów: preset/ostatni filtr wskazujący usuwany projekt traci
    // `criteria.projectId` (→ ''), jak kaskada DELETE_WORK_CATEGORY dla kategorii.
    // Niepowiązane filtry zachowują SWOJĄ referencję (brak migotania widoków).
    savedFilters: state.savedFilters.map((f) =>
      f.criteria.projectId === projectId
        ? { ...f, criteria: { ...f.criteria, projectId: '' } }
        : f,
    ),
    lastFilters: clearProjectIdInLastFilters(state.lastFilters, projectId),
  };
}

/** Czyści jedno pole `criteria` (→ '') w każdym zapamiętanym filtrze wskazującym
 *  usuwaną encję; niepowiązane wpisy zachowują SWOJĄ referencję. Wspólne dla
 *  kaskady projektu i kategorii pracy. */
function clearCriteriaFieldInLastFilters(
  lastFilters: AppData['lastFilters'],
  field: 'projectId' | 'workCategoryId' | 'companyId',
  value: string,
): AppData['lastFilters'] {
  const next: AppData['lastFilters'] = {};
  for (const key of Object.keys(lastFilters) as Array<keyof AppData['lastFilters']>) {
    const entry = lastFilters[key];
    if (entry === undefined) continue;
    next[key] =
      entry.criteria[field] === value
        ? { ...entry, criteria: { ...entry.criteria, [field]: '' } }
        : entry;
  }
  return next;
}

function clearProjectIdInLastFilters(
  lastFilters: AppData['lastFilters'],
  projectId: string,
): AppData['lastFilters'] {
  return clearCriteriaFieldInLastFilters(lastFilters, 'projectId', projectId);
}

function clearWorkCategoryIdInLastFilters(
  lastFilters: AppData['lastFilters'],
  workCategoryId: string,
): AppData['lastFilters'] {
  return clearCriteriaFieldInLastFilters(lastFilters, 'workCategoryId', workCategoryId);
}

function clearCompanyIdInLastFilters(
  lastFilters: AppData['lastFilters'],
  companyId: string,
): AppData['lastFilters'] {
  return clearCriteriaFieldInLastFilters(lastFilters, 'companyId', companyId);
}

// ---- Insert block (calendar right-click) ----

function insertBlock(state: AppData, payload: InsertBlockPayload): AppData {
  const ref = state.workload.find((w) => w.id === payload.refEntryId);
  if (!ref || !Number.isFinite(payload.hours) || payload.hours <= 0 || isBinEntry(ref)) {
    return state; // no ripple insert around a bin block
  }
  const task = state.tasks.find((t) => t.id === payload.taskId);
  if (!task) return state;
  // Szkic nie materializuje godzin (inwariant 1 + 4): żadna ścieżka kalendarza
  // nie może wstawić bloku dla nieopublikowanego zadania. Ta sama referencja.
  if (task.isDraft === true) return state;
  // URLOP jest twardą blokadą przypisania czasu (D6). Ripple-insert nie idzie
  // przez `setBlockTime`, więc pełnodniowe wystąpienie musi mieć tu JAWNĄ straż;
  // celowo tylko urlop, żeby zachowanie wobec zwykłych spotkań się nie zmieniło.
  if (personVacationOnDate(state, ref.personId, ref.date) !== null) return state;

  // Snap to the 0.25h grid on write (input `step` is UI-only).
  const hours = snapHours(payload.hours);
  if (!Number.isFinite(hours) || hours <= 0) return state;

  // Budget enforcement (PKG-20260708-b2): a right-click insert may never mint
  // hours past the task's plan. Draw from the inserted task's same-person bin
  // row (note: `payload.taskId` may differ from `ref.taskId` when the picker
  // chose another task), plus the task's headroom when it carries an estimate.
  const binRow = state.workload.find(
    (w) => w.taskId === payload.taskId && w.personId === ref.personId && isBinEntry(w),
  );
  const binQ = binRow ? toQuarters(binRow.plannedHours) : 0;
  const totalAllQ = state.workload
    .filter((w) => w.taskId === payload.taskId)
    .reduce((sum, w) => sum + toQuarters(w.plannedHours), 0);
  const headroomQ =
    task.estimatedHours === null ? 0 : Math.max(0, toQuarters(task.estimatedHours) - totalAllQ);
  const hoursQ = toQuarters(hours);
  // Safety net — the UI package adds the live warning/disable.
  if (hoursQ > binQ + headroomQ) return state;
  const takenFromBinQ = Math.min(hoursQ, binQ); // bin first, then headroom

  // Ripple insert. "Przed": take the ref's start; "Po": start at the ref's end.
  const dur = hoursToMinutes(hours);
  const rawStart =
    payload.position === 'before'
      ? ref.startMinutes
      : blockEndMinutes(ref.startMinutes, ref.plannedHours);

  // Plan the sweep without clamping: reject atomically (state unchanged) if the
  // inserted block or any pushed block would cross 24:00. No hidden overlaps.
  const dayBlocks = state.workload.filter(
    (w) => w.personId === ref.personId && w.date === ref.date,
  );
  const moves = planRippleInsert(dayBlocks, rawStart, dur);
  if (moves === null) return state;

  // URLOP GODZINOWY (2026-08-24): okno nieobecności to ta sama twarda blokada
  // co pełna doba, tylko krótsza — ani wstawiany blok, ani żaden PRZEPCHNIĘTY
  // nie może na nim wylądować; odrzucamy atomowo. Bloki NIERUSZANE pomijamy:
  // praca zaplanowana przed zgłoszeniem urlopu zostaje (inwariant 3) i nie
  // może zablokować wstawek w innych godzinach dnia. Spotkań ta straż celowo
  // nadal nie obejmuje (parytet z pełnodniową strażą wyżej).
  const vacationWindows = personHourlyVacationIntervals(state, ref.personId, ref.date);
  if (vacationWindows.length > 0) {
    const onVacationWindow = (start: number, durMin: number): boolean =>
      vacationWindows.some((iv) =>
        rangesOverlap(start, start + durMin, iv.startMinutes, iv.endMinutes),
      );
    if (onVacationWindow(rawStart, dur)) return state;
    for (const b of dayBlocks) {
      const pushed = moves.get(b.id);
      if (pushed !== undefined && onVacationWindow(pushed, hoursToMinutes(b.plannedHours))) {
        return state;
      }
    }
  }

  // planRippleInsert only pushes blocks AT/AFTER the insert point. A same-person
  // block that STARTS BEFORE `rawStart` but ENDS AFTER it (reachable after a
  // SAVE_TASK grow-clamp overlap) is never inspected, so the inserted block would
  // land inside its span — a NEW collision the calendar must never create. Reject
  // atomically. Touching edges do not overlap, so the "po" ref (end === rawStart)
  // and any block ending exactly at rawStart are not flagged.
  const spansInsertPoint = dayBlocks.some(
    (w) => w.startMinutes < rawStart && blockEndMinutes(w.startMinutes, w.plannedHours) > rawStart,
  );
  if (spansInsertPoint) return state;

  // Task period must cover ref.date; reject if the widening exceeds the 92-day
  // cap (mirrors setBlockTime). Validated BEFORE any mutation so the action is
  // atomic — the task picker can pick ANY task, so this cannot be skipped.
  const newStartDate = ref.date < task.startDate ? ref.date : task.startDate;
  const newEndDate = ref.date > task.endDate ? ref.date : task.endDate;
  const periodWidens = newStartDate !== task.startDate || newEndDate !== task.endDate;
  if (periodWidens && inclusiveDayCount(newStartDate, newEndDate) > MAX_TASK_PERIOD_DAYS) {
    return state;
  }

  const entry: WorkloadEntry = {
    id: uid(),
    taskId: payload.taskId,
    personId: ref.personId,
    date: ref.date,
    plannedHours: hours,
    startMinutes: rawStart, // un-clamped; planRippleInsert guaranteed it fits
    sortIndex: 0, // fixed by reindexDays below
  };
  let shifted = state.workload.map((w) => {
    const m = moves.get(w.id);
    return m === undefined ? w : { ...w, startMinutes: m };
  });

  // Draw the consumed hours from the same-task bin row (delete it at 0h). The
  // bin row is dateless (BIN_DATE) so it never collides with the ripple sweep.
  const touchedKeys = new Set([dayKey(ref.personId, ref.date)]);
  if (takenFromBinQ > 0 && binRow) {
    const remainingQ = binQ - takenFromBinQ;
    shifted =
      remainingQ <= 0
        ? shifted.filter((w) => w.id !== binRow.id)
        : shifted.map((w) =>
            w.id === binRow.id ? { ...w, plannedHours: remainingQ * HOURS_STEP } : w,
          );
    touchedKeys.add(dayKey(ref.personId, BIN_DATE));
  }

  // Keep invariants: the person must be assigned to the task, and the task
  // period must cover the block's date.
  const alreadyAssigned = state.assignments.some(
    (a) => a.taskId === payload.taskId && a.personId === ref.personId,
  );
  const assignments = alreadyAssigned
    ? state.assignments
    : [...state.assignments, { id: uid(), taskId: payload.taskId, personId: ref.personId }];
  const tasks = periodWidens
    ? state.tasks.map((t) =>
        t.id === payload.taskId
          ? { ...t, startDate: newStartDate, endDate: newEndDate, updatedAt: nowIso() }
          : t,
      )
    : state.tasks;

  const person = state.people.find((p) => p.id === ref.personId);
  // Treść wpisu jest niemutowalnym stringiem widocznym dla wszystkich — tytuł
  // utajnionego zadania nie może do niej wejść (etykieta „#N" też nie, bo
  // numeracja się przesuwa; rzeczownik ogólny jest jedyną stabilną maską).
  const refTask = state.tasks.find((t) => t.id === ref.taskId);
  const refTaskLabel =
    refTask === undefined ? 'blok' : refTask.isConfidential === true ? 'utajnione zadanie' : refTask.title;
  let message = `wstawił(a) blok ${formatDuration(hours)} ${payload.position === 'before' ? 'przed' : 'po'} „${refTaskLabel}” dla ${person?.name ?? 'kogoś'} w dniu ${ref.date}`;
  if (takenFromBinQ > 0) {
    message += `; pobrano z zasobnika: ${formatDuration(takenFromBinQ * HOURS_STEP)}`;
  }
  return {
    ...state,
    tasks,
    assignments,
    workload: reindexDays([...shifted, entry], touchedKeys),
    activity: withActivity(state, 'task', payload.taskId, message),
  };
}

/** Move one time block to another person, keeping ordering invariants. */
function reassignEntry(state: AppData, entryId: string, toPersonId: string): AppData {
  const entry = state.workload.find((w) => w.id === entryId);
  if (!entry) return state;
  const target = state.people.find((p) => p.id === toPersonId);
  if (!target || toPersonId === entry.personId) return state;

  const fromPersonId = entry.personId;
  const { date, plannedHours, taskId } = entry;

  // Bin entry → another person: merge into the target's existing same-task bin
  // row when one exists (one-bin-row invariant) — the target row's id survives
  // and the moved entry is dropped.
  if (isBinEntry(entry)) {
    const targetBin = state.workload.find(
      (w) => w.taskId === taskId && w.personId === toPersonId && isBinEntry(w),
    );
    if (targetBin) {
      const sumQ = toQuarters(targetBin.plannedHours) + toQuarters(plannedHours);
      const workload = reindexDays(
        state.workload
          .filter((w) => w.id !== entryId)
          .map((w) =>
            w.id === targetBin.id ? { ...w, plannedHours: sumQ * HOURS_STEP } : w,
          ),
        new Set([dayKey(fromPersonId, BIN_DATE), dayKey(toPersonId, BIN_DATE)]),
      );
      const alreadyAssigned = state.assignments.some(
        (a) => a.taskId === taskId && a.personId === toPersonId,
      );
      const assignments = alreadyAssigned
        ? state.assignments
        : [...state.assignments, { id: uid(), taskId, personId: toPersonId }];
      const fromName = state.people.find((p) => p.id === fromPersonId)?.name ?? 'kogoś';
      return {
        ...state,
        assignments,
        workload,
        activity: withActivity(
          state,
          'task',
          taskId,
          `przeniósł/przeniosła blok ${formatDuration(plannedHours)} (${date}) z ${fromName} na ${target.name}`,
        ),
      };
    }
  }

  // Compute the target's next free sortIndex against the workload WITHOUT the
  // moved entry, then append the moved entry to the end of the target's day.
  const without = state.workload.filter((w) => w.id !== entryId);
  // Bin entries stay in the bin (date '', startMinutes 0) and append to the
  // target person's bin; dated entries land in a collision-free slot on the
  // target's day — reject atomically (state unchanged) if none fits.
  let startMinutes: number;
  if (isBinEntry(entry)) {
    startMinutes = 0;
  } else {
    // Osoba na urlopie nie przyjmuje datowanego bloku (D6) — jawna straż, bo ta
    // ścieżka nie przechodzi przez `setBlockTime`. Ta sama referencja stanu.
    if (personVacationOnDate(state, toPersonId, date) !== null) return state;
    // URLOP GODZINOWY (2026-08-24): okno nieobecności to strefa ZAKAZANA, nie
    // blok. Najpierw normalne ułożenie po samych blokach (preferencja „doklej
    // po ostatnim" zostaje nietknięta — okno kończące się późno nie może
    // przesuwać bloku za siebie, gdy zwykły slot jest wolny); dopiero gdy
    // wynik wpada w okno, liczymy ponownie z oknami jako pseudo-blokami.
    // Brak miejsca poza oknami = ta sama referencja.
    const targetBlocks = without.filter((w) => w.personId === toPersonId && w.date === date);
    const durMin = hoursToMinutes(plannedHours);
    const vacationWindows = personHourlyVacationIntervals(state, toPersonId, date);
    const hitsWindow = (start: number): boolean =>
      vacationWindows.some((iv) =>
        rangesOverlap(start, start + durMin, iv.startMinutes, iv.endMinutes),
      );
    let free = findFreeStart(targetBlocks, durMin);
    if (free !== null && hitsWindow(free)) {
      free = findFreeStart(
        [
          ...targetBlocks,
          ...vacationWindows.map((iv) => ({
            startMinutes: iv.startMinutes,
            plannedHours: (iv.endMinutes - iv.startMinutes) / 60,
          })),
        ],
        durMin,
      );
    }
    if (free === null) return state;
    startMinutes = free;
  }
  const moved: WorkloadEntry = {
    ...entry,
    personId: toPersonId,
    startMinutes,
    sortIndex: nextSortIndex(without, toPersonId, date),
  };
  const touched = new Set<string>([
    dayKey(fromPersonId, date),
    dayKey(toPersonId, date),
  ]);
  const workload = reindexDays([...without, moved], touched);

  // Keep the invariant: the target person must be assigned to the task. Do NOT
  // remove the source person's assignment (they may have other blocks, and the
  // task editor owns assignment cleanup).
  const alreadyAssigned = state.assignments.some(
    (a) => a.taskId === taskId && a.personId === toPersonId,
  );
  const assignments = alreadyAssigned
    ? state.assignments
    : [...state.assignments, { id: uid(), taskId, personId: toPersonId }];

  const fromName = state.people.find((p) => p.id === fromPersonId)?.name ?? 'kogoś';

  return {
    ...state,
    assignments,
    workload,
    activity: withActivity(
      state,
      'task',
      taskId,
      `przeniósł/przeniosła blok ${formatDuration(plannedHours)} (${date}) z ${fromName} na ${target.name}`,
    ),
  };
}

/** Hours -> integer quarter-units (0.25h grid) to keep hour math free of float drift. */
function toQuarters(hours: number): number {
  return Math.round(hours / HOURS_STEP);
}

/**
 * Move/resize one block in time (the timed Week view). Rejects (returns state
 * unchanged) on any invalid input or a same-person time overlap. Extends the
 * task period to cover a new date unless that would exceed the 92-day cap.
 *
 * This is the ONLY budget-enforcing path (mirroring how a same-person time
 * overlap is blocked only here — CLAUDE.md invariant 3). For a task with an
 * estimate, GROWING a block draws hours from the owner's same-task bin row
 * first, then from the task headroom, and is rejected past that budget; SHRINK
 * returns freed hours to (merges into) the same bin row. SAVE_TASK /
 * AllocationGrid edits stay unrestricted — the estimate is advisory there.
 */
function setBlockTime(
  state: AppData,
  entryId: string,
  date: string,
  startMinutes: number,
  plannedHours: number,
): AppData {
  const entry = state.workload.find((w) => w.id === entryId);
  if (!entry) return state;

  // A grid drop always targets a real calendar day. Use MOVE_BLOCK_TO_BIN to
  // send a block back to the bin — never the empty-date sentinel here.
  if (date === BIN_DATE || !isValidDateStr(date)) return state;

  // Grid + range validation.
  if (!Number.isFinite(startMinutes) || startMinutes < 0 || startMinutes % MINUTE_STEP !== 0) {
    return state;
  }
  if (!Number.isFinite(plannedHours) || plannedHours < HOURS_STEP || plannedHours > 24) {
    return state;
  }
  const hoursSteps = plannedHours / HOURS_STEP;
  if (Math.abs(hoursSteps - Math.round(hoursSteps)) > 1e-9) return state;
  const dur = hoursToMinutes(plannedHours);
  if (startMinutes + dur > DAY_MINUTES) return state;

  // No-op when nothing changed.
  if (entry.date === date && entry.startMinutes === startMinutes && entry.plannedHours === plannedHours) {
    return state;
  }

  // Collision: no overlap with any OTHER block of the same person on the date.
  const sameDayOthers = state.workload.filter(
    (w) => w.personId === entry.personId && w.date === date && w.id !== entryId,
  );
  if (hasCollision(sameDayOthers, startMinutes, dur)) return state;

  // Kierunek „zadanie → wydarzenie": blok nie może wejść na SPOTKANIE tej osoby.
  // Wydarzenia przestały być czysto prezentacyjne WYŁĄCZNIE w tym jednym
  // wymiarze — nadal nie wchodzą do sum, `dayTotal` ani przeciążenia, więc
  // inwariant 1 zostaje. Wystąpienia zadań cyklicznych świadomie NIE blokują
  // (patrz `blockCollidesWithEvent`).
  if (blockCollidesWithEvent(state, entry.personId, date, startMinutes, plannedHours)) {
    return state;
  }

  const task = state.tasks.find((t) => t.id === entry.taskId);
  if (!task) return state;

  // Extend the task period to cover a new date (unless it would exceed the cap).
  let tasks = state.tasks;
  if (date !== entry.date) {
    const startDate = date < task.startDate ? date : task.startDate;
    const endDate = date > task.endDate ? date : task.endDate;
    if (startDate !== task.startDate || endDate !== task.endDate) {
      if (inclusiveDayCount(startDate, endDate) > MAX_TASK_PERIOD_DAYS) return state;
      tasks = state.tasks.map((t) =>
        t.id === task.id ? { ...t, startDate, endDate, updatedAt: nowIso() } : t,
      );
    }
  }

  const oldDate = entry.date;
  const fromBin = isBinEntry(entry); // dropped in from the bin
  const grow = plannedHours > entry.plannedHours;
  const shrink = plannedHours < entry.plannedHours; // freed hours go back to the bin
  const shrinkDelta = shrink ? entry.plannedHours - plannedHours : 0; // grid-safe

  // The owner's single (task, person) bin row, excluding this entry (the entry
  // itself may be a bin block being dropped onto the grid — it is leaving the bin).
  const binRow = state.workload.find(
    (w) =>
      w.taskId === entry.taskId &&
      w.personId === entry.personId &&
      isBinEntry(w) &&
      w.id !== entryId,
  );

  // Budget enforcement + hour-conserving consumption on GROW (ALL tasks).
  // The allowance is the person's same-task bin hours plus — for tasks with an
  // estimate — the task's remaining headroom. Null-estimate tasks have 0
  // headroom, so they may only draw from the bin (no free minting).
  let takenFromBinQ = 0;
  if (grow) {
    const growDeltaQ = toQuarters(plannedHours) - toQuarters(entry.plannedHours);
    const binSameQ = binRow ? toQuarters(binRow.plannedHours) : 0;
    const totalAllQ = state.workload
      .filter((w) => w.taskId === entry.taskId)
      .reduce((sum, w) => sum + toQuarters(w.plannedHours), 0);
    const headroomQ =
      task.estimatedHours === null ? 0 : Math.max(0, toQuarters(task.estimatedHours) - totalAllQ);
    // Safety net — the UI clamps growth live (PKG-20260708-budget-week-ui).
    if (growDeltaQ > binSameQ + headroomQ) return state;
    takenFromBinQ = Math.min(growDeltaQ, binSameQ); // bin first, then headroom
  }

  const touchedKeys = new Set([
    dayKey(entry.personId, oldDate),
    dayKey(entry.personId, date),
  ]);

  // Apply the new geometry to the moved entry.
  let workloadArr = state.workload.map((w) =>
    w.id === entryId ? { ...w, date, startMinutes, plannedHours } : w,
  );

  // GROW: draw the consumed hours from the same-task bin row (delete it at 0h);
  // any remainder is minted from headroom (no row change, task total rises).
  if (takenFromBinQ > 0 && binRow) {
    const remainingQ = toQuarters(binRow.plannedHours) - takenFromBinQ;
    workloadArr =
      remainingQ <= 0
        ? workloadArr.filter((w) => w.id !== binRow.id)
        : workloadArr.map((w) =>
            w.id === binRow.id ? { ...w, plannedHours: remainingQ * HOURS_STEP } : w,
          );
    touchedKeys.add(dayKey(entry.personId, BIN_DATE));
  }

  // SHRINK: return freed hours to the bin, MERGING into the existing (task,
  // person) bin row when one exists (create a fresh row only when none does).
  if (shrink) {
    const freedQ = toQuarters(shrinkDelta);
    if (binRow) {
      workloadArr = workloadArr.map((w) =>
        w.id === binRow.id
          ? { ...w, plannedHours: (toQuarters(w.plannedHours) + freedQ) * HOURS_STEP }
          : w,
      );
    } else {
      workloadArr = [
        ...workloadArr,
        {
          id: uid(),
          taskId: entry.taskId,
          personId: entry.personId,
          date: BIN_DATE,
          plannedHours: freedQ * HOURS_STEP,
          startMinutes: 0,
          sortIndex: nextSortIndex(workloadArr, entry.personId, BIN_DATE),
        },
      ];
    }
    touchedKeys.add(dayKey(entry.personId, BIN_DATE));
  }

  // Adjacency merge: fuse exactly-touching same-task same-person blocks on the
  // drop day into one (the EARLIER block keeps its id; hours summed). Repeat
  // until stable — a merge can create a new adjacency. Merging happens here
  // only (not in INSERT_BLOCK — the ripple insert keeps its behavior).
  let survivorId: string | null = null;
  for (;;) {
    const group = workloadArr
      .filter(
        (w) => w.personId === entry.personId && w.date === date && w.taskId === entry.taskId,
      )
      .sort((a, b) => a.startMinutes - b.startMinutes);
    let merged = false;
    for (let i = 0; i < group.length - 1; i++) {
      const a = group[i];
      const b = group[i + 1];
      if (blockEndMinutes(a.startMinutes, a.plannedHours) !== b.startMinutes) continue;
      const fusedEnd = blockEndMinutes(b.startMinutes, b.plannedHours);
      // Merge is intentional-only: never let a fused block swallow a meeting /
      // recurring occurrence the two blocks were split around (events never collide,
      // so nothing else guards this). Skip this pair; keep them as two blocks.
      if (mergeCoversEventOrRecurrence(state, entry.personId, date, a.startMinutes, fusedEnd)) {
        continue;
      }
      const sumQ = toQuarters(a.plannedHours) + toQuarters(b.plannedHours);
      workloadArr = workloadArr
        .filter((w) => w.id !== b.id)
        .map((w) => (w.id === a.id ? { ...w, plannedHours: sumQ * HOURS_STEP } : w));
      survivorId = a.id;
      merged = true;
      break;
    }
    if (!merged) break;
  }
  const mergedHours =
    survivorId !== null
      ? workloadArr.find((w) => w.id === survivorId)?.plannedHours ?? 0
      : 0;

  const workload = reindexDays(workloadArr, touchedKeys);

  let message: string;
  if (fromBin) {
    message = `zaplanował(a) blok ${formatDuration(plannedHours)} z zasobnika na ${date} ${formatMinutes(startMinutes)}`;
  } else if (date !== oldDate) {
    message = `przeniósł/przeniosła blok ${formatDuration(plannedHours)} na ${date} ${formatMinutes(startMinutes)}`;
  } else {
    message = `zmienił(a) blok na ${formatMinutes(startMinutes)}–${formatMinutes(startMinutes + dur)} (${formatDuration(plannedHours)})`;
  }
  if (takenFromBinQ > 0) {
    message += `; pobrano z zasobnika: ${formatDuration(takenFromBinQ * HOURS_STEP)}`;
  }
  if (shrink) message += `; ${formatDuration(shrinkDelta)} wróciło do zasobnika`;
  if (survivorId !== null) {
    message += `; połączono sąsiednie bloki (razem ${formatDuration(mergedHours)})`;
  }

  return {
    ...state,
    tasks,
    workload,
    activity: withActivity(state, 'task', entry.taskId, message),
  };
}

// ---- Bin (zasobnik) block handlers ----

/** Move one dated block into the person's bin (unassign its calendar day). */
function moveBlockToBin(state: AppData, entryId: string): AppData {
  const entry = state.workload.find((w) => w.id === entryId);
  if (!entry || isBinEntry(entry)) return state;
  const oldDate = entry.date;
  const touched = new Set([
    dayKey(entry.personId, oldDate),
    dayKey(entry.personId, BIN_DATE),
  ]);

  // One-bin-row invariant: when the (task, person) pair already has a bin row,
  // fold this block's hours into it and drop the moved entry (existing id survives).
  const existingBin = state.workload.find(
    (w) => w.taskId === entry.taskId && w.personId === entry.personId && isBinEntry(w),
  );
  let workload: WorkloadEntry[];
  if (existingBin) {
    const sumQ = toQuarters(existingBin.plannedHours) + toQuarters(entry.plannedHours);
    workload = state.workload
      .filter((w) => w.id !== entryId)
      .map((w) => (w.id === existingBin.id ? { ...w, plannedHours: sumQ * HOURS_STEP } : w));
  } else {
    const without = state.workload.filter((w) => w.id !== entryId);
    const moved: WorkloadEntry = {
      ...entry,
      date: BIN_DATE,
      startMinutes: 0,
      sortIndex: nextSortIndex(without, entry.personId, BIN_DATE),
    };
    workload = [...without, moved];
  }
  return {
    ...state,
    workload: reindexDays(workload, touched),
    activity: withActivity(
      state,
      'task',
      entry.taskId,
      `przeniósł/przeniosła blok ${formatDuration(entry.plannedHours)} (${oldDate}) do zasobnika`,
    ),
  };
}

/**
 * Split a dated block into `parts` (halves/quarters) on the 0.25h grid. The
 * largest part stays scheduled on the original entry; the rest collapse into a
 * SINGLE bin row (summed), merged into the (task, person) bin row when one
 * already exists. Rejects when the block is too small to divide, and no-ops on
 * a bin entry — splitting a bin block would create a second same-pair bin row,
 * violating the one-bin-row invariant. To schedule PART of a bin row onto the
 * calendar (the bin-row path this deliberately omits), use `scheduleBinPart`
 * (`SCHEDULE_BIN_PART`), which conserves the one-bin-row invariant.
 */
function splitBlock(state: AppData, entryId: string, parts: 2 | 4): AppData {
  const entry = state.workload.find((w) => w.id === entryId);
  if (!entry || entry.plannedHours < parts * HOURS_STEP) return state;
  if (isBinEntry(entry)) return state;

  const q = Math.round(entry.plannedHours / HOURS_STEP);
  const base = Math.floor(q / parts);
  const r = q % parts;
  // First `r` parts (the largest) get base+1 quarters; part 1 stays scheduled.
  const quarters: number[] = [];
  for (let i = 0; i < parts; i++) quarters.push(base + (i < r ? 1 : 0));
  const binQ = quarters.slice(1).reduce((s, x) => s + x, 0); // all split-off parts

  let workload = state.workload.map((w) =>
    w.id === entryId ? { ...w, plannedHours: quarters[0] * HOURS_STEP } : w,
  );
  const existingBin = state.workload.find(
    (w) => w.taskId === entry.taskId && w.personId === entry.personId && isBinEntry(w),
  );
  if (existingBin) {
    workload = workload.map((w) =>
      w.id === existingBin.id
        ? { ...w, plannedHours: (toQuarters(w.plannedHours) + binQ) * HOURS_STEP }
        : w,
    );
  } else {
    workload = [
      ...workload,
      {
        id: uid(),
        taskId: entry.taskId,
        personId: entry.personId,
        date: BIN_DATE,
        plannedHours: binQ * HOURS_STEP,
        startMinutes: 0,
        sortIndex: nextSortIndex(workload, entry.personId, BIN_DATE),
      },
    ];
  }
  const touched = new Set([
    dayKey(entry.personId, entry.date),
    dayKey(entry.personId, BIN_DATE),
  ]);
  const binSum = binQ * HOURS_STEP;
  return {
    ...state,
    workload: reindexDays(workload, touched),
    activity: withActivity(
      state,
      'task',
      entry.taskId,
      `podzielił(a) blok ${formatDuration(entry.plannedHours)} na ${parts} części (do zasobnika: ${formatDuration(binSum)})`,
    ),
  };
}

/**
 * Schedule a user-chosen 0.25h-aligned PART of a bin (zasobnik) row onto a
 * calendar day. Atomically decrements the source bin row (SAME id, in quarter
 * units — deleted exactly when it reaches zero) and creates exactly ONE new
 * dated block, conserving total planned hours. This is the bin-row scheduling
 * path `splitBlock`/`SPLIT_BLOCK` deliberately omits; it is what makes an
 * oversized (>24h) bin row recoverable.
 *
 * Guard reuse by COMPOSITION, not duplication (decision 3): build an
 * intermediate workload (source row decremented, or filtered out at zero, plus
 * a TEMPORARY same-pair bin sibling carrying the part with a fresh uid) and
 * delegate to the existing `setBlockTime` for that temp entry — inheriting date
 * validity, 15-min grid, day fit, same-person collision, and the 92-day period
 * cap. `setBlockTime` returns its input unchanged on any violation, so
 * `next === intermediate` detects a rejection and we return the ORIGINAL
 * `state` (house convention: state unchanged, no activity row). The transient
 * second same-pair bin row exists ONLY inside this pure function on the success
 * path — by the time state escapes, `setBlockTime` has already dated it — so
 * nothing observable ever holds two bin rows for one (task, person) pair; on
 * rejection the intermediate is discarded entirely.
 *
 * Hour math is in quarter units (decision 4): a legacy off-grid row (e.g. 5.1h)
 * is thereby SNAPPED to the quarter grid on its first partial schedule.
 * Full-amount requests go through this SAME uniform path (decision 5): the
 * source row is filtered out because `remainingQ === 0`, and one new dated row
 * is created — never the source row itself. Budget is untouched (decision 7):
 * the delegated entry's hours equal `hours`, so `setBlockTime` sees neither
 * grow nor shrink; total planned hours and `estimatedHours` are conserved by
 * construction. Adjacency merge (decision 6) and the `fromBin` activity message
 * (decision 8) are inherited from `setBlockTime`; on success we append
 * `; w zasobniku pozostało {X}` (or `; zasobnik opróżniony`) to that last row.
 */
function scheduleBinPart(
  state: AppData,
  entryId: string,
  date: string,
  startMinutes: number,
  hours: number,
): AppData {
  const entry = state.workload.find((w) => w.id === entryId);
  if (!entry || !isBinEntry(entry)) return state;

  // Same hours grid/range validation shape as setBlockTime (:938–942).
  if (!Number.isFinite(hours) || hours < HOURS_STEP || hours > 24) return state;
  const hoursSteps = hours / HOURS_STEP;
  if (Math.abs(hoursSteps - Math.round(hoursSteps)) > 1e-9) return state;

  // Conservation in quarter units; reject asking for more than the row holds.
  const hoursQ = toQuarters(hours);
  const remainingQ = toQuarters(entry.plannedHours) - hoursQ;
  if (remainingQ < 0) return state;

  const partId = uid();
  const partHours = hoursQ * HOURS_STEP; // pass the snapped value, not raw `hours`

  // Intermediate: decrement (or drop at zero) the source row, then append the
  // TEMPORARY part row that setBlockTime will date onto the grid.
  const decremented =
    remainingQ === 0
      ? state.workload.filter((w) => w.id !== entryId)
      : state.workload.map((w) =>
          w.id === entryId ? { ...w, plannedHours: remainingQ * HOURS_STEP } : w,
        );
  const intermediate: AppData = {
    ...state,
    workload: [
      ...decremented,
      {
        id: partId,
        taskId: entry.taskId,
        personId: entry.personId,
        date: BIN_DATE,
        plannedHours: partHours,
        startMinutes: 0,
        sortIndex: nextSortIndex(decremented, entry.personId, BIN_DATE),
      },
    ],
  };

  const next = setBlockTime(intermediate, partId, date, startMinutes, partHours);
  if (next === intermediate) return state; // any guard violation → original state

  // Append the remainder suffix to setBlockTime's fromBin activity row.
  const suffix =
    remainingQ > 0
      ? `; w zasobniku pozostało ${formatDuration(remainingQ * HOURS_STEP)}`
      : '; zasobnik opróżniony';
  const activity = next.activity.map((ev, i) =>
    i === next.activity.length - 1 ? { ...ev, message: ev.message + suffix } : ev,
  );
  return { ...next, activity };
}

/** Delete a single bin entry (dated entries are never deleted here). */
function deleteBlock(state: AppData, entryId: string): AppData {
  const entry = state.workload.find((w) => w.id === entryId);
  if (!entry || !isBinEntry(entry)) return state;
  return {
    ...state,
    workload: reindexDays(
      state.workload.filter((w) => w.id !== entryId),
      new Set([dayKey(entry.personId, BIN_DATE)]),
    ),
    activity: withActivity(
      state,
      'task',
      entry.taskId,
      `usunął/usunęła blok ${formatDuration(entry.plannedHours)} z zasobnika`,
    ),
  };
}

// ---- People ----

// Everything a draft owns EXCEPT the id and passwordHash — those are managed
// separately (id on create, passwordHash only via SET_PASSWORD) so a profile
// save never clobbers a stored password.
function personFromDraft(draft: PersonDraft): Omit<Person, 'id' | 'passwordHash'> {
  const firstName = draft.firstName.trim();
  const lastName = draft.lastName.trim();
  // Clamp into the UI's declared [1, 24] hours/day range (defense-in-depth: the
  // number input declares min=1/max=24 but does not enforce the max on typed
  // input). A non-finite value falls back to the default BEFORE clamping so a
  // garbage payload can never persist NaN.
  const rawCapacity = Number.isFinite(draft.capacity) ? draft.capacity : DEFAULT_CAPACITY;
  const capacity = Math.min(24, Math.max(1, rawCapacity));
  return {
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(' '),
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    role: draft.role.trim(),
    departmentId: draft.departmentId,
    companyId: draft.companyId,
    avatar: draft.avatar.trim(),
    capacity,
    accessRole: draft.accessRole,
    // Work hours are informational only — no coupling to capacity is enforced.
    workDays: sanitizeWorkDays(draft.workDays),
    workStartMinutes: draft.workStartMinutes,
    workEndMinutes: draft.workEndMinutes,
    supervisorId: draft.supervisorId,
    // Data urodzenia: poprawna 'yyyy-MM-dd' albo '' (śmieci nie persystują).
    birthDate: isValidDateStr(draft.birthDate) ? draft.birthDate : '',
    // Opt-in mailowy: brak => false (nie spamujemy).
    emailNotifications: draft.emailNotifications === true,
  };
}

function deletePerson(state: AppData, personId: string): AppData {
  // Deleting the acting user clears the session identity ('' = logged out).
  const currentUserId = personId === state.currentUserId ? '' : state.currentUserId;
  return {
    ...state,
    // Cascade (invariant 5): drop the person, their assignments/workload, and
    // clear any dangling supervisorId that pointed at them on remaining people.
    people: state.people
      .filter((p) => p.id !== personId)
      .map((p) => (p.supervisorId === personId ? { ...p, supervisorId: '' } : p)),
    assignments: state.assignments.filter((a) => a.personId !== personId),
    workload: state.workload.filter((w) => w.personId !== personId),
    timeEntries: keepArrayIfSame(
      state.timeEntries,
      state.timeEntries.filter((e) => e.personId !== personId),
    ),
    currentUserId,
  };
}

// ---- Statuses ----

/** True when archiving/deleting `statusId` would leave ZERO active statuses. */
function isOnlyActiveStatus(state: AppData, statusId: string): boolean {
  const active = state.statuses.filter((s) => !s.archived);
  return active.length === 1 && active[0].id === statusId;
}

/** True when no OTHER status (active or archived) is done — i.e. `statusId` is
 *  the only `isDone` status among all statuses. */
function isOnlyDoneStatus(state: AppData, statusId: string): boolean {
  const done = state.statuses.filter((s) => s.isDone);
  return done.length === 1 && done[0].id === statusId;
}

function saveStatus(
  state: AppData,
  statusId: string | null,
  name: string,
  color: string,
): AppData {
  const trimmed = name.trim();
  if (!trimmed) return state;
  if (statusId === null) {
    const status: Status = {
      id: uid(),
      name: trimmed,
      slug: slugify(trimmed),
      color,
      order: state.statuses.reduce((m, s) => Math.max(m, s.order), -1) + 1,
      archived: false,
      isDone: false,
    };
    return {
      ...state,
      statuses: [...state.statuses, status],
      activity: withActivity(state, 'status', status.id, `utworzył(a) status „${trimmed}”`),
    };
  }
  // Reject a stale rename id (previously returned a new identical state ref).
  if (!hasEntity(state, 'status', statusId)) return state;
  // Rename keeps the raw value so inline editing isn't fighting the reducer
  // (trailing spaces while typing); the slug derives from the trimmed name.
  // `isDone` is untouched — the spread preserves the existing flag.
  // The rename/recolor branch logs NOTHING: AdminPage dispatches SAVE_STATUS per
  // keystroke / per color-drag tick, so an edit row would flood the log.
  return {
    ...state,
    statuses: state.statuses.map((s) =>
      s.id === statusId ? { ...s, name, slug: slugify(trimmed), color } : s,
    ),
  };
}

/** Toggle a status's done flag. Turning ON is always allowed; turning OFF is
 *  refused (state unchanged) when it is the only `isDone` status. */
function setStatusDone(state: AppData, statusId: string, isDone: boolean): AppData {
  if (!state.statuses.some((s) => s.id === statusId)) return state;
  if (!isDone && isOnlyDoneStatus(state, statusId)) return state;
  const status = state.statuses.find((s) => s.id === statusId)!;
  return {
    ...state,
    statuses: state.statuses.map((s) => (s.id === statusId ? { ...s, isDone } : s)),
    activity: withActivity(
      state,
      'status',
      statusId,
      isDone
        ? `oznaczył(a) status „${status.name}” jako ukończony`
        : `cofnął(a) oznaczenie ukończenia statusu „${status.name}”`,
    ),
  };
}

/** Archive/restore a status. Restore (archived=false) is always allowed;
 *  archiving is refused when the status is the only ACTIVE status or the only
 *  `isDone` status. Returns state unchanged on refusal. */
function setStatusArchived(state: AppData, statusId: string, archived: boolean): AppData {
  if (!state.statuses.some((s) => s.id === statusId)) return state;
  if (archived && (isOnlyActiveStatus(state, statusId) || isOnlyDoneStatus(state, statusId))) {
    return state;
  }
  const status = state.statuses.find((s) => s.id === statusId)!;
  return {
    ...state,
    statuses: state.statuses.map((s) =>
      s.id === statusId ? { ...s, archived } : s,
    ),
    activity: withActivity(
      state,
      'status',
      statusId,
      archived ? `zarchiwizował(a) status „${status.name}”` : `przywrócił(a) status „${status.name}”`,
    ),
  };
}

/** Najwyższa `orderIndex` w danym projekcie, albo -1 gdy projekt jest pusty. */
function maxOrderIndexOfProject(state: AppData, projectId: string): number {
  let max = -1;
  for (const t of state.tasks) {
    if (t.projectId === projectId && Number.isFinite(t.orderIndex) && t.orderIndex > max) {
      max = t.orderIndex;
    }
  }
  return max;
}

// Ręczna zmiana kolejności zadań w projekcie. Kosmetyka (jak reorderStatus):
// ukończenie/kalendarz/godziny są od kolejności NIEZALEŻNE, a powtarzane
// kliknięcia zaśmiecałyby log — więc BEZ wiersza aktywności i BEZ zmiany
// `updatedAt`. Nieprawidłowe wejście (nieznane id, ruch poza krawędź) zwraca tę
// SAMĄ referencję stanu (invariant 6). Kanoniczny klucz kolejności:
// (orderIndex asc, startDate asc, id asc) — identyczny jak w selektorze, więc
// wiersze chmury same-0 zachowują się jak dzisiejszy sort po startDate.
function reorderProjectTask(state: AppData, taskId: string, direction: -1 | 1): AppData {
  // Wrong payload shape (kierunek spoza {-1, 1}) => ta sama referencja stanu.
  if (direction !== -1 && direction !== 1) return state;
  const target = state.tasks.find((t) => t.id === taskId);
  if (!target) return state;
  const ordered = state.tasks
    .filter((t) => t.projectId === target.projectId)
    .sort(
      (a, b) =>
        a.orderIndex - b.orderIndex ||
        a.startDate.localeCompare(b.startDate) ||
        a.id.localeCompare(b.id),
    );
  const idx = ordered.findIndex((t) => t.id === taskId);
  const swapWith = idx + direction;
  if (idx === -1 || swapWith < 0 || swapWith >= ordered.length) return state;
  [ordered[idx], ordered[swapWith]] = [ordered[swapWith], ordered[idx]];
  // Renumeruj 0..n-1 tylko w tym projekcie; zadania, których ranga się nie
  // zmieniła, zachowują tożsamość obiektu (minimalizuje upserty mirrora).
  const orderOf = new Map(ordered.map((t, i) => [t.id, i]));
  return {
    ...state,
    tasks: state.tasks.map((t) => {
      const next = orderOf.get(t.id);
      return next === undefined || next === t.orderIndex ? t : { ...t, orderIndex: next };
    }),
  };
}

// Cosmetic ordering only (invariant: completion never comes from order), and
// repeat-click reorders would spam — so NO activity row is logged here.
function reorderStatus(state: AppData, statusId: string, direction: -1 | 1): AppData {
  const ordered = [...state.statuses].sort((a, b) => a.order - b.order);
  const idx = ordered.findIndex((s) => s.id === statusId);
  const swapWith = idx + direction;
  if (idx === -1 || swapWith < 0 || swapWith >= ordered.length) return state;
  [ordered[idx], ordered[swapWith]] = [ordered[swapWith], ordered[idx]];
  const orderOf = new Map(ordered.map((s, i) => [s.id, i]));
  return {
    ...state,
    statuses: state.statuses.map((s) => ({ ...s, order: orderOf.get(s.id) ?? s.order })),
  };
}

/** Delete is refused (state unchanged) when the status is referenced (else
 *  archive), OR it is the only active status, OR the only `isDone` status. */
function deleteStatus(state: AppData, statusId: string): AppData {
  if (!hasEntity(state, 'status', statusId)) return state;
  const used =
    state.projects.some((p) => p.statusId === statusId) ||
    state.tasks.some((t) => t.statusId === statusId);
  if (used) return state;
  if (isOnlyActiveStatus(state, statusId) || isOnlyDoneStatus(state, statusId)) return state;
  const status = state.statuses.find((s) => s.id === statusId)!;
  return {
    ...state,
    statuses: state.statuses.filter((s) => s.id !== statusId),
    activity: withActivity(state, 'status', statusId, `usunął(a) status „${status.name}”`),
  };
}

// ---- Milestones ----

function saveMilestone(
  state: AppData,
  milestoneId: string | null,
  projectId: string,
  name: string,
  date: string,
): AppData {
  if (!isValidDateStr(date)) return state;
  // Project must exist; name required; on edit the milestone must exist and
  // belong to that project. Otherwise the activity row could be attributed to
  // a different project than the milestone being changed.
  if (!hasEntity(state, 'project', projectId)) return state;
  if (!isRequiredName(name)) return state;
  const existingMilestone = milestoneId === null
    ? null
    : state.milestones.find((milestone) => milestone.id === milestoneId) ?? null;
  if (milestoneId !== null && existingMilestone?.projectId !== projectId) return state;
  if (milestoneId === null) {
    const m: Milestone = { id: uid(), projectId, name: name.trim(), date };
    return {
      ...state,
      milestones: [...state.milestones, m],
      activity: withActivity(state, 'project', projectId, `dodał(a) kamień milowy „${m.name}” na ${date}`),
    };
  }
  return {
    ...state,
    milestones: state.milestones.map((m) =>
      m.id === milestoneId ? { ...m, name: name.trim(), date } : m,
    ),
    activity: withActivity(state, 'project', projectId, `zaktualizował(a) kamień milowy „${name.trim()}”`),
  };
}

// ---- Cloud people merge (pełna synchronizacja zespołu) ----

const MERGE_ACCESS_ROLES = new Set<AccessRole>(['pelne', 'ograniczone']);

/** Walidacja jednego wiersza payloadu osób — fail-closed dla całego scalenia. */
function isValidCloudPersonRow(r: CloudPersonMergeRow): boolean {
  if (typeof r !== 'object' || r === null) return false;
  if (typeof r.id !== 'string' || r.id === '') return false;
  if (typeof r.email !== 'string' || normalizeEmail(r.email) === '') return false;
  if (typeof r.firstName !== 'string' || r.firstName.trim() === '') return false;
  if (typeof r.lastName !== 'string' || typeof r.role !== 'string') return false;
  if (typeof r.departmentId !== 'string') return false;
  if (typeof r.companyId !== 'string') return false;
  if (typeof r.phone !== 'string' || typeof r.avatar !== 'string') return false;
  if (typeof r.supervisorEmail !== 'string') return false;
  if (typeof r.birthDate !== 'string') return false;
  if (r.notificationsSeenAt !== undefined && typeof r.notificationsSeenAt !== 'string') return false;
  // Przeczytane per wpis: brak pola albo tablica SAMYCH stringów; cokolwiek
  // innego psuje cały payload (fail-closed, jak reszta wiersza).
  if (r.notificationsReadIds !== undefined) {
    if (!Array.isArray(r.notificationsReadIds)) return false;
    if (r.notificationsReadIds.some((id) => typeof id !== 'string')) return false;
  }
  if (r.emailNotifications !== undefined && typeof r.emailNotifications !== 'boolean') return false;
  if (!Number.isFinite(r.capacity) || r.capacity < 0 || r.capacity > 24) return false;
  if (!Array.isArray(r.workDays)) return false;
  if (r.workDays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return false;
  if (!Number.isInteger(r.workStartMinutes) || r.workStartMinutes < 0 || r.workStartMinutes > 1440)
    return false;
  if (!Number.isInteger(r.workEndMinutes) || r.workEndMinutes < 0 || r.workEndMinutes > 1440)
    return false;
  if (!MERGE_ACCESS_ROLES.has(r.accessRole)) return false;
  return true;
}

/** Pola osoby synchronizowane z profilu chmury (bez id/hasła/przełożonego). */
function cloudPersonFields(row: CloudPersonMergeRow): Omit<
  Person,
  'id' | 'passwordHash' | 'supervisorId'
> {
  const firstName = row.firstName.trim();
  const lastName = row.lastName.trim();
  const workDays = Array.from(new Set(row.workDays)).sort((a, b) => a - b);
  return {
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(' '),
    email: row.email.trim(),
    phone: row.phone.trim(),
    role: row.role.trim(),
    departmentId: row.departmentId,
    companyId: row.companyId,
    avatar: row.avatar.trim(),
    // Spójnie z personFromDraft: UI deklaruje zakres [1, 24].
    capacity: Math.min(24, Math.max(1, row.capacity)),
    accessRole: row.accessRole,
    workDays,
    workStartMinutes: row.workStartMinutes,
    workEndMinutes: row.workEndMinutes,
    // Poprawna 'yyyy-MM-dd' albo '' (spójnie z personFromDraft/migratePerson).
    birthDate: isValidDateStr(row.birthDate) ? row.birthDate : '',
    // Opt-in mailowy z profilu chmury (brak => false).
    emailNotifications: row.emailNotifications === true,
  };
}

const sameWorkDays = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Porównanie list stringów po wartości i kolejności (zbiór „przeczytane"). */
const sameStringList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** UNIA zbiorów „przeczytane per wpis": najpierw lokalne (w swojej kolejności),
 *  potem id tylko-chmurowe w kolejności payloadu; puste stringi i duplikaty
 *  odpadają. Monotoniczna — parytet z max-mergem watermarku, więc wyścig dwóch
 *  urządzeń nigdy nie cofa przeczytanego. Merge NIE robi pruningu. */
function unionReadIds(local: readonly string[] = [], cloud: readonly string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...local, ...cloud]) {
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Późniejszy z dwóch znaczników „przeczytane" (ISO); '' = brak (−∞). Watermark
 *  jest MONOTONICZNY — scalenie lokalne↔chmura nigdy nie cofa przeczytanego. */
function laterIso(a: string, b: string): string {
  if (a === '') return b;
  if (b === '') return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/**
 * AUTORYTATYWNE zastosowanie RLS-owych profili chmury do listy osób — chmura
 * jest jedynym źródłem prawdy o zespole:
 *   * dopasowanie po znormalizowanym e-mailu — aktualizacja pól (w tym działu
 *     chmury), lokalne id i hasło pozostają (referencje planera są stabilne);
 *   * profil bez lokalnego odpowiednika — nowa osoba z id profilu chmury
 *     (dzięki temu hydracja planera mapuje profile bez pary e-mailowej);
 *   * osoba lokalna BEZ konta chmury (np. dane demonstracyjne) jest USUWANA;
 *   * przełożony rozwiązywany po e-mailu PO upsercie (cykl => '');
 *   * brak faktycznych zmian => `changed: false` (wołający zwraca ten sam stan);
 *   * payload niepoprawny strukturalnie => `ok: false` (invariant 6).
 */
function applyCloudPeople(
  localPeople: Person[],
  payload: CloudPersonMergeRow[],
): { ok: boolean; people: Person[]; changed: boolean } {
  if (!Array.isArray(payload) || !payload.every(isValidCloudPersonRow)) {
    return { ok: false, people: localPeople, changed: false };
  }
  // FAIL-CLOSED na pusty zbiór: zalogowany użytkownik zawsze widzi (RLS) co
  // najmniej własny profil, więc pusta chmura to anomalia (regresja RLS, błąd
  // provisioning), nie prawda o zespole — bez tej bramki [] usuwałoby cały
  // lokalny zespół i (przez people.length === 0) otwierało bramkę admina.
  // Lustrzane z fail-close pustych słowników w mergeCloudDictionaries.
  if (payload.length === 0 && localPeople.length > 0) {
    return { ok: false, people: localPeople, changed: false };
  }

  // Duplikaty e-maili w payloadzie: ostatni wygrywa (deterministycznie).
  const rowByEmail = new Map<string, CloudPersonMergeRow>();
  for (const row of payload) rowByEmail.set(normalizeEmail(row.email), row);

  let changed = false;
  const matched = new Set<string>();

  // 1) Aktualizacja istniejących osób po e-mailu; osoby bez konta chmury odpadają.
  const updatedPeople: Person[] = [];
  for (const person of localPeople) {
    const key = normalizeEmail(person.email);
    const row = key === '' ? undefined : rowByEmail.get(key);
    if (!row) {
      changed = true; // osoba lokalna bez konta chmury — usunięta
      continue;
    }
    matched.add(key);
    const fields = cloudPersonFields(row);
    // Watermark „przeczytane": bierz PÓŹNIEJSZY z lokalnego i chmurowego (monotoniczny,
    // odporny na wyścig dwóch urządzeń). Klucz kanonicznie obecny tylko gdy niepusty.
    const mergedSeen = laterIso(person.notificationsSeenAt ?? '', row.notificationsSeenAt ?? '');
    const seenChanged = (person.notificationsSeenAt ?? '') !== mergedSeen;
    // Przeczytane per wpis: UNIA lokalnego i chmurowego zbioru (monotoniczna).
    const mergedReadIds = unionReadIds(person.notificationsReadIds, row.notificationsReadIds);
    const readIdsChanged = !sameStringList(person.notificationsReadIds ?? [], mergedReadIds);
    const same =
      person.firstName === fields.firstName &&
      person.lastName === fields.lastName &&
      person.name === fields.name &&
      person.email === fields.email &&
      person.phone === fields.phone &&
      person.role === fields.role &&
      person.departmentId === fields.departmentId &&
      (person.companyId ?? '') === fields.companyId &&
      person.avatar === fields.avatar &&
      person.capacity === fields.capacity &&
      person.accessRole === fields.accessRole &&
      person.workStartMinutes === fields.workStartMinutes &&
      person.workEndMinutes === fields.workEndMinutes &&
      person.birthDate === fields.birthDate &&
      (person.emailNotifications ?? false) === fields.emailNotifications &&
      sameWorkDays(person.workDays, fields.workDays) &&
      !seenChanged &&
      !readIdsChanged;
    if (same) {
      updatedPeople.push(person);
    } else {
      changed = true;
      // Klucz `notificationsReadIds` kanonicznie obecny TYLKO gdy unia niepusta
      // (unia nie kurczy się, więc pusta oznacza brak po obu stronach).
      const { notificationsReadIds: _drop, ...base } = person;
      updatedPeople.push({
        ...base,
        ...fields,
        ...(mergedSeen !== '' ? { notificationsSeenAt: mergedSeen } : {}),
        ...(mergedReadIds.length > 0 ? { notificationsReadIds: mergedReadIds } : {}),
      });
    }
  }

  // 2) Nowe osoby (profil bez lokalnego odpowiednika) — id profilu chmury.
  const existingIds = new Set(updatedPeople.map((p) => p.id));
  const appended: Person[] = [];
  for (const [key, row] of rowByEmail) {
    if (matched.has(key)) continue;
    if (existingIds.has(row.id)) continue; // kolizja id — fail-safe, pomiń
    const rowReadIds = unionReadIds([], row.notificationsReadIds);
    appended.push({
      id: row.id,
      ...cloudPersonFields(row),
      passwordHash: '',
      supervisorId: '',
      ...(row.notificationsSeenAt ? { notificationsSeenAt: row.notificationsSeenAt } : {}),
      ...(rowReadIds.length > 0 ? { notificationsReadIds: rowReadIds } : {}),
    });
    existingIds.add(row.id);
  }
  if (appended.length > 0) changed = true;

  // 3) Przełożeni po e-mailu (na finalnej liście; cykl lub brak => '').
  let people = appended.length > 0 ? [...updatedPeople, ...appended] : updatedPeople;
  const idByEmail = new Map(
    people.filter((p) => normalizeEmail(p.email) !== '').map((p) => [normalizeEmail(p.email), p.id]),
  );
  for (const [key, row] of rowByEmail) {
    const personId = idByEmail.get(key);
    if (!personId) continue;
    const target = row.supervisorEmail === '' ? '' : idByEmail.get(normalizeEmail(row.supervisorEmail)) ?? '';
    const supervisorId = wouldCreateSupervisorCycle(people, personId, target) ? '' : target;
    const person = people.find((p) => p.id === personId);
    if (person && person.supervisorId !== supervisorId) {
      changed = true;
      people = people.map((p) => (p.id === personId ? { ...p, supervisorId } : p));
    }
  }

  return { ok: true, people, changed };
}

/** Czyści tożsamość sesji wskazującą osobę usuniętą przez scalenie. */
function reconcileIdentityAfterPeopleMerge(
  state: AppData,
  people: Person[],
): Pick<AppData, 'currentUserId'> {
  const ids = new Set(people.map((p) => p.id));
  return {
    currentUserId: ids.has(state.currentUserId) ? state.currentUserId : '',
  };
}

/** Akcja MERGE_CLOUD_PEOPLE — cicha, idempotentna hydracja zespołu z chmury. */
function mergeCloudPeople(state: AppData, payload: CloudPersonMergeRow[]): AppData {
  const result = applyCloudPeople(state.people, payload);
  if (!result.ok || !result.changed) return state;
  // Osoba usunięta autorytatywnie (bez konta chmury) zabiera swoje wpisy czasu —
  // parytet z kaskadą DELETE_PERSON i z MERGE_CLOUD_ENTITIES.
  const personIds = new Set(result.people.map((p) => p.id));
  return {
    ...state,
    people: result.people,
    ...reconcileIdentityAfterPeopleMerge(state, result.people),
    timeEntries: keepArrayIfSame(
      state.timeEntries,
      state.timeEntries.filter((e) => personIds.has(e.personId)),
    ),
  };
}

// ---- Cloud dictionaries merge (statusy + słowniki, autorytatywnie) -----------

/** Wiersz słownikowy: niepusty string id + name. */
function isValidNamedRow(v: unknown): v is { id: string; name: string } {
  if (!isObjWithId(v)) return false;
  const name = (v as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() !== '';
}

function isValidStatusRow(v: unknown): v is Status {
  if (!isValidNamedRow(v)) return false;
  const s = v as unknown as Status;
  return (
    typeof s.slug === 'string' &&
    typeof s.color === 'string' &&
    typeof s.order === 'number' &&
    Number.isFinite(s.order) &&
    typeof s.archived === 'boolean' &&
    typeof s.isDone === 'boolean'
  );
}

const sameNamedRows = (a: Array<{ id: string; name: string }>, b: Array<{ id: string; name: string }>): boolean =>
  a.length === b.length && a.every((r, i) => r.id === b[i].id && r.name === b[i].name);

const sameStatusRows = (a: Status[], b: Status[]): boolean =>
  a.length === b.length &&
  a.every(
    (s, i) =>
      s.id === b[i].id &&
      s.name === b[i].name &&
      s.slug === b[i].slug &&
      s.color === b[i].color &&
      s.order === b[i].order &&
      s.archived === b[i].archived &&
      s.isDone === b[i].isDone,
  );

export interface CloudDictionariesPayload {
  departments: Department[];
  statuses: Status[];
  serviceTypes: ServiceType[];
  workCategories: WorkCategory[];
  jobTitles: JobTitle[];
  companies: Company[];
}

/**
 * AUTORYTATYWNE scalenie słowników organizacji z chmury (działy, statusy, typy
 * usług, kategorie prac, stanowiska, spółki) — lokalne kopie są zastępowane w całości. Fail-closed
 * (invariant 6): niepoprawna struktura ALBO zestaw statusów łamiący twardy
 * invariant planera (co najmniej jeden aktywny nie-ukończony i jeden aktywny
 * ukończony status) zwraca ORYGINALNĄ referencję stanu — w szczególności pusta
 * chmura statusów (przed seedem) nie może zdemolować lokalnego lejka. Brak
 * faktycznych zmian => ta sama referencja (dispatch jest idempotentny).
 */
function mergeCloudDictionaries(state: AppData, payload: CloudDictionariesPayload): AppData {
  if (typeof payload !== 'object' || payload === null) return state;
  const { departments, statuses, serviceTypes, workCategories, jobTitles, companies } = payload;
  if (
    !Array.isArray(departments) ||
    !Array.isArray(statuses) ||
    !Array.isArray(serviceTypes) ||
    !Array.isArray(workCategories) ||
    !Array.isArray(jobTitles) ||
    !Array.isArray(companies)
  ) {
    return state;
  }
  if (!departments.every(isValidNamedRow)) return state;
  if (!serviceTypes.every(isValidNamedRow)) return state;
  if (!workCategories.every(isValidNamedRow)) return state;
  if (!jobTitles.every(isValidNamedRow)) return state;
  if (!companies.every(isValidNamedRow)) return state;
  if (!statuses.every(isValidStatusRow)) return state;
  // Twardy invariant 5: przynajmniej jeden aktywny status w toku i jeden done.
  const hasActive = statuses.some((s) => !s.archived && !s.isDone);
  const hasDone = statuses.some((s) => !s.archived && s.isDone);
  if (!hasActive || !hasDone) return state;

  const sorted = [...statuses].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  if (
    sameNamedRows(state.departments, departments) &&
    sameNamedRows(state.serviceTypes, serviceTypes) &&
    sameNamedRows(state.workCategories, workCategories) &&
    sameNamedRows(state.jobTitles, jobTitles) &&
    sameNamedRows(state.companies, companies) &&
    sameStatusRows(state.statuses, sorted)
  ) {
    return state;
  }
  return {
    ...state,
    departments: [...departments],
    serviceTypes: [...serviceTypes],
    workCategories: [...workCategories],
    jobTitles: [...jobTitles],
    companies: [...companies],
    statuses: sorted,
  };
}

// ---- Powiadomienia in-app -----------------------------------------------------

export interface CloudNotificationsPayload {
  notifications: Notification[];
}

/** Strukturalna walidacja wiersza powiadomienia (fail-closed jak reszta hydracji). */
function isValidNotificationRow(v: unknown): v is Notification {
  if (!isObjWithId(v)) return false;
  const n = v as unknown as Record<string, unknown>;
  return (
    typeof n.recipientId === 'string' &&
    n.recipientId !== '' &&
    isNotificationType(n.type) &&
    typeof n.readAt === 'string' &&
    typeof n.createdAt === 'string' &&
    typeof n.payload === 'object' &&
    n.payload !== null &&
    !Array.isArray(n.payload)
  );
}

/**
 * AUTORYTATYWNA hydracja powiadomień odbiorcy z chmury. Payload REPLACES kolekcję
 * (reference-preserving: wiersz bajtowo równy zachowuje referencję, kolekcja bez
 * zmian zostaje tą samą tablicą — brak migotania przy odświeżeniu w tle).
 * Fail-closed (inwariant 6): payload spoza obiektu, `notifications` nie-tablica
 * lub jakikolwiek strukturalnie zły wiersz => ORYGINALNA referencja stanu.
 */
function mergeCloudNotifications(state: AppData, payload: CloudNotificationsPayload): AppData {
  if (typeof payload !== 'object' || payload === null) return state;
  const { notifications } = payload;
  if (!Array.isArray(notifications)) return state;
  if (!notifications.every(isValidNotificationRow)) return state;
  const merged = reconcileRows(state.notifications, notifications);
  return merged === state.notifications ? state : { ...state, notifications: merged };
}

// ---- Content Plan: hydracja z chmury ----

/** Ładunek MERGE_CLOUD_CONTENT_PLAN (`loadContentPlanSnapshot`). */
export interface CloudContentPlanPayload {
  brands: ContentPlanBrand[];
  posts: ContentPlanPost[];
}

const isStringList = (v: unknown): boolean =>
  Array.isArray(v) && v.every((item) => typeof item === 'string');

/** Strukturalna walidacja wiersza marki (fail-closed jak reszta hydracji). */
function isValidContentPlanBrandRow(v: unknown): v is ContentPlanBrand {
  if (!isObjWithId(v)) return false;
  const b = v as unknown as Record<string, unknown>;
  return (
    typeof b.name === 'string' &&
    b.name.trim() !== '' &&
    typeof b.industry === 'string' &&
    typeof b.contact === 'string' &&
    typeof b.accent === 'string' &&
    Array.isArray(b.platforms) &&
    isStringList(b.topics) &&
    isStringList(b.formats) &&
    typeof b.createdAt === 'string' &&
    typeof b.updatedAt === 'string'
  );
}

/** Strukturalna walidacja wiersza publikacji. `brandId` wskazujący markę spoza
 *  ładunku jest DOPUSZCZALNY (parytet z sanitizerem wczytania: osierocona
 *  publikacja nie ma widoku, ale nie kasuje się przy hydracji). */
function isValidContentPlanPostRow(v: unknown): v is ContentPlanPost {
  if (!isObjWithId(v)) return false;
  const p = v as unknown as Record<string, unknown>;
  return (
    typeof p.brandId === 'string' &&
    p.brandId !== '' &&
    typeof p.date === 'string' &&
    isValidDateStr(p.date) &&
    typeof p.title === 'string' &&
    p.title.trim() !== '' &&
    typeof p.topic === 'string' &&
    typeof p.format === 'string' &&
    isContentPlanStatus(p.status) &&
    isContentPlanVisibility(p.visibility) &&
    typeof p.baseTags === 'string' &&
    Array.isArray(p.channels) &&
    p.channels.every(isObjWithId) &&
    Array.isArray(p.comments) &&
    p.comments.every(isObjWithId) &&
    Array.isArray(p.history) &&
    p.history.every(isObjWithId) &&
    typeof p.createdAt === 'string' &&
    typeof p.updatedAt === 'string'
  );
}

/**
 * AUTORYTATYWNA hydracja modułu Content Plan: ładunek PODMIENIA obie kolekcje
 * (reference-preserving jak pozostałe rodziny — wiersz bajtowo równy zachowuje
 * referencję, kolekcja bez zmian zostaje tą samą tablicą, więc odświeżenie w tle
 * nie miga kalendarzem). Fail-closed (inwariant 6): ładunek spoza obiektu,
 * `brands`/`posts` poza tablicą albo JAKIKOLWIEK strukturalnie zły wiersz =>
 * ORYGINALNA referencja stanu.
 */
function mergeCloudContentPlan(state: AppData, payload: CloudContentPlanPayload): AppData {
  if (typeof payload !== 'object' || payload === null) return state;
  const { brands, posts } = payload;
  if (!Array.isArray(brands) || !Array.isArray(posts)) return state;
  if (!brands.every(isValidContentPlanBrandRow)) return state;
  if (!posts.every(isValidContentPlanPostRow)) return state;
  const mergedBrands = reconcileRows(state.contentPlanBrands, brands);
  const mergedPosts = reconcileRows(state.contentPlanPosts, posts);
  if (mergedBrands === state.contentPlanBrands && mergedPosts === state.contentPlanPosts) {
    return state;
  }
  return { ...state, contentPlanBrands: mergedBrands, contentPlanPosts: mergedPosts };
}

/**
 * Oznaczenie JEDNEGO powiadomienia jako przeczytane (`read_at`). Nieznane id albo
 * już przeczytane => TA SAMA referencja (inwariant 6). Kolumna `read_at`
 * lustruje się do chmury przez diff (cloudMirror). Bez wpisu dziennika.
 */
function markNotificationRead(state: AppData, notificationId: string): AppData {
  const target = state.notifications.find((n) => n.id === notificationId);
  if (!target || target.readAt !== '') return state;
  const ts = nowIso();
  return {
    ...state,
    notifications: state.notifications.map((n) =>
      n.id === notificationId ? { ...n, readAt: ts } : n,
    ),
  };
}

/** Oznaczenie WSZYSTKICH nieprzeczytanych jako przeczytane. Brak nieprzeczytanych
 *  => TA SAMA referencja (inwariant 6). */
function markAllNotificationsRead(state: AppData): AppData {
  if (!state.notifications.some((n) => n.readAt === '')) return state;
  const ts = nowIso();
  return {
    ...state,
    notifications: state.notifications.map((n) =>
      n.readAt === '' ? { ...n, readAt: ts } : n,
    ),
  };
}

/** Trim the four text fields of each additional client contact for storage. The
 *  array shape is already validated by isValidClientDraft (strict gate), so this
 *  only normalizes whitespace; an undefined/[] input yields []. */
function trimClientContacts(contacts: ClientContact[] | undefined): ClientContact[] {
  if (!contacts) return [];
  return contacts.map((c) => ({
    id: c.id,
    firstName: c.firstName.trim(),
    lastName: c.lastName.trim(),
    phone: c.phone.trim(),
    email: c.email.trim(),
  }));
}

// ---- Cloud hydration merge ----

function isObjWithId(v: unknown): v is { id: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { id?: unknown }).id === 'string' &&
    (v as { id: string }).id !== ''
  );
}

/** A payload workload row is on the 0.25h grid (finite, positive, quarter). */
function isQuarterHours(v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return false;
  const q = v / HOURS_STEP;
  return Math.abs(q - Math.round(q)) < 1e-9;
}

/**
 * Głęboka równość WARTOŚCI dla płaskich danych wiersza (prymitywy, tablice,
 * zwykłe obiekty). Wiersze planera są czystym JSON-em — mają zagnieżdżone
 * tablice (`Task.checklist`, `Comment.mentionIds`), więc porównanie płytkie
 * fałszywie raportowałoby zmianę przy każdym odświeżeniu.
 */
function sameRowValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameRowValue(v, b[i]));
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  return keys.every(
    (k) => Object.prototype.hasOwnProperty.call(bo, k) && sameRowValue(ao[k], bo[k]),
  );
}

/**
 * BEZSZWOWE scalenie kolekcji: chmura pozostaje autorytatywna dla ZBIORU
 * wierszy (wiersz nieznany chmurze odpada, nowy dochodzi), ale KOLEJNOŚĆ jest
 * lokalna: wiersz znany obu stronom zostaje na swojej dotychczasowej pozycji,
 * a genuinie nowe wiersze chmury dochodzą NA KONIEC w kolejności ładunku.
 * Postgres bez ORDER BY zwraca wiersze w kolejności sterty (każdy UPDATE
 * przenosi wiersz), więc honorowanie kolejności chmury permutowało tablice przy
 * każdym odświeżeniu w tle i widoki z tie-breakiem po kolejności tablicy
 * wizualnie przestawiały elementy. Wiersz identyczny wartościowo zachowuje
 * SWOJĄ DOTYCHCZASOWĄ REFERENCJĘ, a kolekcja bez żadnej zmiany zwraca
 * dotychczasową TABLICĘ — hydracja, która niczego nie zmienia, jest wizualnym
 * no-opem (żaden useMemo/selektor nie traci ważności).
 */
function reconcileRows<T extends { id: string }>(prev: T[], next: T[]): T[] {
  const cloudById = new Map(next.map((row) => [row.id, row]));
  const prevIds = new Set(prev.map((row) => row.id));
  const out: T[] = [];
  for (const row of prev) {
    const cloud = cloudById.get(row.id);
    if (cloud === undefined) continue; // usunięty w chmurze
    cloudById.delete(row.id); // duplikat id w prev nie wskrzesi wiersza
    out.push(sameRowValue(row, cloud) ? row : cloud);
  }
  for (const row of next) {
    if (!prevIds.has(row.id)) out.push(row);
  }
  if (out.length === prev.length && out.every((row, i) => row === prev[i])) return prev;
  return out;
}

/** Ta sama tablica, gdy scalenie nie zmieniło żadnej pozycji ani długości. */
function keepArrayIfSame<T>(prev: T[], next: T[]): T[] {
  if (prev.length !== next.length) return next;
  return next.every((row, i) => prev[i] === row) ? prev : next;
}

/**
 * AUTHORITATIVE hydration of the eight mirrored cloud collections: the cloud is
 * the single source of truth for MEMBERSHIP and row VALUES (local rows the
 * cloud does not know are dropped — this is what retires demo/sample planner
 * data on every browser), while array ORDER stays local for surviving rows
 * (see reconcileRows — Postgres heap order is unstable and must not permute
 * the UI on background refreshes). Runs once per sign-in with an empty push
 * queue — CloudSyncProvider restores the persistent per-account outbox
 * (storage.ts, `n2hub.cloudOutbox.v1`) and drains it BEFORE hydrating, so a
 * reload after a transient sync error cannot lose local edits here either (a
 * failed drain leaves the ops on disk; rows return on the next merge after
 * retry). When `payload.people` is
 * present, the RLS profile set is applied FIRST (same semantics as
 * MERGE_CLOUD_PEOPLE), so entity validation sees the final team.
 * Fail-closed (invariant 6): a structurally invalid payload — a non-array
 * collection, a row with no string id, a project/task with an invalid period, a
 * task referencing a missing project, an assignment referencing a missing
 * task/person, a milestone with an invalid date / missing project, or a
 * workload row with off-grid/day-overflowing values or a missing task/person —
 * returns the ORIGINAL state reference. Statuses/dictionaries/savedFilters pass
 * through by reference untouched (MERGE_CLOUD_DICTIONARIES owns dictionaries).
 */
function mergeCloudEntities(state: AppData, payload: CloudMergePayload): AppData {
  const collections = [
    payload.clients,
    payload.projects,
    payload.milestones,
    payload.tasks,
    payload.assignments,
    payload.workload,
    payload.comments,
    payload.activity,
  ];
  if (collections.some((c) => !Array.isArray(c))) return state;
  // Zgłoszenia są OPCJONALNE w ładunku (dopisane addytywnie): brak pola => bez
  // zmian w kolekcji, obecne => walidacja i autorytatywna podmiana niżej.
  if (payload.tickets !== undefined && !Array.isArray(payload.tickets)) return state;
  // Wydarzenia (dziesiąta rodzina) są OPCJONALNE i ADDYTYWNE — jak zgłoszenia.
  if (payload.events !== undefined && !Array.isArray(payload.events)) return state;

  // Osoby najpierw (autorytatywnie), żeby walidacja encji widziała finalny
  // zespół. Niepoprawny blok osób psuje całą hydrację (atomowość).
  let mergedPeople = state.people;
  if (payload.people !== undefined) {
    const peopleResult = applyCloudPeople(state.people, payload.people);
    if (!peopleResult.ok) return state;
    mergedPeople = peopleResult.people;
  }

  // Every mirrored entity row (except assignment pairs) needs a string id.
  if (
    !payload.clients.every(isObjWithId) ||
    !payload.projects.every(isObjWithId) ||
    !payload.milestones.every(isObjWithId) ||
    !payload.tasks.every(isObjWithId) ||
    !payload.workload.every(isObjWithId) ||
    !payload.comments.every(isObjWithId) ||
    !payload.activity.every(isObjWithId) ||
    (payload.tickets !== undefined && !payload.tickets.every(isObjWithId)) ||
    (payload.events !== undefined && !payload.events.every(isObjWithId))
  ) {
    return state;
  }

  // Klienci: `contacts` jest ADDYTYWNE. Fail-closed STRUKTURALNIE — klient,
  // którego klucz `contacts` JEST obecny, ale nie jest tablicą, odrzuca całą
  // hydrację (invariant 6). Zniekształcone WIERSZE są filtrowane
  // deterministycznie przez `sanitizeClientContacts` (idempotentne =>
  // odświeżenie w tle zostaje reference-preserving). Forma kanoniczna:
  // klient bez klucza przechodzi jako TEN SAM obiekt; sanityzacja do pustej =>
  // obiekt BEZ klucza.
  for (const c of payload.clients) {
    const rec = c as unknown as Record<string, unknown>;
    if (rec.contacts !== undefined && !Array.isArray(rec.contacts)) return state;
  }
  const mappedClients = payload.clients.map((c) => {
    const rec = c as unknown as Record<string, unknown>;
    if (rec.contacts === undefined) return c;
    const contacts = sanitizeClientContacts(rec.contacts);
    if (contacts === undefined) {
      const { contacts: _drop, ...rest } = rec;
      return rest as unknown as typeof c;
    }
    return { ...(rec as object), contacts } as unknown as typeof c;
  });

  // Autorytatywnie: referencje walidujemy wobec ZBIORU DOCELOWEGO (payload),
  // nie sumy z lokalnym — wiersz wskazujący encję spoza chmury jest błędem.
  const projectIds = new Set<string>(payload.projects.map((p) => p.id));
  const taskIds = new Set<string>(payload.tasks.map((t) => t.id));
  const personIds = new Set(mergedPeople.map((p) => p.id));

  // Project/task periods must satisfy the same guards the reducer applies.
  for (const p of payload.projects) {
    if (periodError(p.startDate, p.endDate) !== null) return state;
  }
  for (const t of payload.tasks) {
    if (periodError(t.startDate, t.endDate, { maxDays: MAX_TASK_PERIOD_DAYS }) !== null) {
      return state;
    }
    if (!projectIds.has(t.projectId)) return state;
  }
  for (const m of payload.milestones) {
    if (!isValidDateStr(m.date) || !projectIds.has(m.projectId)) return state;
  }
  for (const a of payload.assignments) {
    if (
      typeof a?.taskId !== 'string' ||
      typeof a?.personId !== 'string' ||
      !taskIds.has(a.taskId) ||
      !personIds.has(a.personId)
    ) {
      return state;
    }
  }
  // Workload rows: grid + reference validation (belt-and-braces with Scope 2).
  for (const w of payload.workload) {
    if (!taskIds.has(w.taskId) || !personIds.has(w.personId)) return state;
    if (!isQuarterHours(w.plannedHours)) return state;
    if (
      !Number.isFinite(w.startMinutes) ||
      w.startMinutes < 0 ||
      w.startMinutes % MINUTE_STEP !== 0
    ) {
      return state;
    }
    const isBin = w.date === BIN_DATE;
    if (!isBin) {
      if (!isValidDateStr(w.date)) return state;
      if (w.startMinutes + hoursToMinutes(w.plannedHours) > DAY_MINUTES) return state;
    }
  }

  // Zgłoszenia: zgłaszający MUSI istnieć w finalnym zespole, a rodzaj/priorytet/
  // status muszą należeć do swoich zbiorów — inaczej cała hydracja jest
  // odrzucana (fail-closed, jak pozostałe rodziny).
  if (payload.tickets !== undefined) {
    for (const t of payload.tickets) {
      if (!personIds.has(t.reporterId)) return state;
      if (!isTicketKind(t.kind) || !isTicketPriority(t.priority) || !isTicketStatus(t.status)) {
        return state;
      }
    }
  }

  // Wydarzenia: fail-closed STRUKTURALNIE (data + czasy na siatce jak workload),
  // ale dangling uczestnik jest FILTROWANY per-wiersz (kolumna-tablica nie ma FK,
  // stary id nie może blokować całej hydracji). Filtr jest deterministyczny =>
  // merge zostaje idempotentny i reference-preserving.
  let mergedEvents = state.events;
  if (payload.events !== undefined) {
    for (const e of payload.events) {
      if (!isValidDateStr(e.date)) return state;
      if (
        !Number.isInteger(e.startMinutes) ||
        e.startMinutes < 0 ||
        e.startMinutes % MINUTE_STEP !== 0
      ) {
        return state;
      }
      if (
        !Number.isInteger(e.durationMinutes) ||
        e.durationMinutes < MINUTE_STEP ||
        e.durationMinutes % MINUTE_STEP !== 0
      ) {
        return state;
      }
      if (e.startMinutes + e.durationMinutes > DAY_MINUTES) return state;
      if (!Array.isArray(e.attendeeIds)) return state;
      // `kind`/`endDate` są OPCJONALNE i ADDYTYWNE: brak klucza przechodzi,
      // wartość spoza formy kanonicznej to zły wiersz => fail-closed jak reszta
      // pól. Hydracja (`plannerData`) kanonikalizuje je łagodnie WCZEŚNIEJ, więc
      // tutaj może dojechać już tylko realnie zniekształcony ładunek.
      const rec = e as unknown as Record<string, unknown>;
      if (rec.kind !== undefined && rec.kind !== 'urlop') return state;
      if (rec.endDate !== undefined) {
        if (rec.kind !== 'urlop') return state;
        if (typeof rec.endDate !== 'string' || !isValidDateStr(rec.endDate)) return state;
        if (rec.endDate <= e.date) return state;
      }
      // Odpowiedzi RSVP per wystąpienie: OPCJONALNE i ADDYTYWNE — hydracja
      // kanonikalizuje wcześniej (normalizeEventRsvps), tu tylko strażnik
      // struktury jak dla kind/endDate.
      if (rec.rsvps !== undefined && !Array.isArray(rec.rsvps)) return state;
    }
    const filtered = payload.events.map((e) => {
      const attendeeIds = e.attendeeIds.filter(
        (id, i, arr) => personIds.has(id) && arr.indexOf(id) === i,
      );
      // Odpowiedzi RSVP osób spoza finalnego zespołu odpadają (parytet z
      // filtrem attendeeIds — walidacja widzi już scalony zespół). Forma
      // kanoniczna: pusta lista = klucz znika.
      const rsvpsFiltered = e.rsvps?.filter((r) => personIds.has(r.personId));
      const rsvpsChanged = e.rsvps !== undefined && rsvpsFiltered!.length !== e.rsvps.length;
      if (attendeeIds.length === e.attendeeIds.length && !rsvpsChanged) return e;
      const { rsvps: _dropRsvps, ...rest } = e;
      return {
        ...rest,
        attendeeIds,
        ...(rsvpsFiltered !== undefined && rsvpsFiltered.length > 0
          ? { rsvps: rsvpsFiltered }
          : {}),
      };
    });
    mergedEvents = reconcileRows(state.events, filtered);
  }

  // Assignments reconciled by (taskId, personId): a pair the local state
  // already knows keeps its local row (id AND position — background hydration
  // must not reorder the UI); a genuinely new cloud pair gets a fresh uid
  // appended at the end. Pairs the cloud does not know are DROPPED.
  const payloadPairs = new Set(payload.assignments.map((a) => `${a.taskId}|${a.personId}`));
  const seenPairs = new Set<string>();
  const assignments: TaskAssignment[] = [];
  for (const a of state.assignments) {
    const key = `${a.taskId}|${a.personId}`;
    if (!payloadPairs.has(key) || seenPairs.has(key)) continue;
    seenPairs.add(key);
    assignments.push(a);
  }
  for (const a of payload.assignments) {
    const key = `${a.taskId}|${a.personId}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    assignments.push({ id: uid(), taskId: a.taskId, personId: a.personId });
  }

  // Scalenie zachowujące referencje: wiersz bajtowo identyczny zostaje TYM
  // SAMYM obiektem, kolekcja bez zmian zostaje TĄ SAMĄ tablicą, a hydracja,
  // która niczego nie zmieniła, zwraca ORYGINALNĄ referencję stanu. Dzięki temu
  // odświeżenie w tle nie unieważnia memoizacji widoków (brak migotania) i jest
  // idempotentne — spójne z fail-closed z invariantu 6 wyżej.
  const merged: AppData = {
    ...state,
    people: mergedPeople,
    ...reconcileIdentityAfterPeopleMerge(state, mergedPeople),
    clients: reconcileRows(state.clients, mappedClients),
    projects: reconcileRows(state.projects, payload.projects),
    milestones: reconcileRows(state.milestones, payload.milestones),
    tasks: reconcileRows(state.tasks, payload.tasks),
    comments: reconcileRows(state.comments, payload.comments),
    activity: reconcileRows(state.activity, payload.activity),
    workload: reconcileRows(state.workload, payload.workload),
    assignments: keepArrayIfSame(state.assignments, assignments),
    // Wpisy czasu są LOKALNE: autorytatywna chmura nie zna ich, ale gdy zabiera
    // zadanie albo osobę, wpis traci sens — odpada (spójność jak przy DELETE_*).
    timeEntries: keepArrayIfSame(
      state.timeEntries,
      state.timeEntries.filter((e) => taskIds.has(e.taskId) && personIds.has(e.personId)),
    ),
    ...(payload.tickets !== undefined
      ? { tickets: reconcileRows(state.tickets, payload.tickets) }
      : {}),
    ...(payload.events !== undefined ? { events: mergedEvents } : {}),
  };
  const keys = Object.keys(merged) as Array<keyof AppData>;
  return keys.every((k) => Object.is(merged[k], state[k])) ? state : merged;
}

// ---- Reducer ----

export function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    case 'SAVE_TASK':
      return saveTask(state, action.payload);
    case 'DELETE_TASK': {
      // Only log when the task exists. The row lives on the PARENT PROJECT
      // (entityType 'project') so it stays visible in the project's activity
      // panel and survives deleteTask's own 'task'-row pruning.
      const task = state.tasks.find((t) => t.id === action.taskId);
      const next = deleteTask(state, action.taskId);
      if (!task) return next;
      // Utajnione zadanie nie zostawia tytułu w niemutowalnym wpisie dziennika.
      const message =
        task.isConfidential === true
          ? 'usunął(a) utajnione zadanie'
          : `usunął(a) zadanie „${task.title}”`;
      return {
        ...next,
        activity: withActivity(next, 'project', task.projectId, message),
      };
    }
    case 'DUPLICATE_TASK':
      return duplicateTask(state, action.taskId, action.newTaskId);
    case 'SET_TASK_RECURRENCE':
      return setTaskRecurrence(state, action.taskId, action.recurrence);
    case 'SET_RECURRENCE_OVERRIDE':
      return setRecurrenceOverride(state, action.taskId, action.date, action.override);
    case 'SET_OCCURRENCE_DONE':
      return setOccurrenceDone(state, action.taskId, action.date, action.done);
    case 'PUBLISH_PROJECT_DRAFTS':
      return publishProjectDrafts(state, action.projectId);
    case 'PUBLISH_TASK':
      return publishTask(state, action.taskId);
    case 'MOVE_TASK':
      return moveTask(state, action.taskId, action.dayDelta);
    case 'SET_TASK_DATES':
      return setTaskDates(state, action.taskId, action.startDate, action.endDate);
    case 'SET_TASK_STATUS': {
      // Reject a stale taskId (would append activity) or a dangling statusId
      // (would persist onto the task) before any write.
      if (!hasEntity(state, 'task', action.taskId) || !hasEntity(state, 'status', action.statusId)) {
        return state;
      }
      // Re-applying the current status is a no-op (mirrors SET_PROJECT_STATUS):
      // no activity row, no updatedAt churn, same state reference.
      const current = state.tasks.find((t) => t.id === action.taskId);
      if (current && current.statusId === action.statusId) return state;
      const status = state.statuses.find((s) => s.id === action.statusId);
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.taskId
            ? { ...t, statusId: action.statusId, updatedAt: nowIso() }
            : t,
        ),
        activity: withActivity(
          state,
          'task',
          action.taskId,
          `przeniósł/przeniosła zadanie do statusu „${status?.name ?? '?'}”`,
        ),
      };
    }
    case 'SET_BLOCK_DONE': {
      // Per-block completion (PKG-20260721-per-block-done). Maps ONLY the entry
      // with entryId; the task status stays untouched. Invariant 6: an unknown
      // entryId, or a value already equal to the requested one (no-op), returns
      // the SAME state reference (no churn, no activity row).
      if (!hasWorkloadEntry(state, action.entryId)) return state;
      const entry = state.workload.find((w) => w.id === action.entryId);
      if (!entry) return state;
      if ((entry.done === true) === action.done) return state;
      const marked: AppData = {
        ...state,
        workload: state.workload.map((w) =>
          w.id === action.entryId ? { ...w, done: action.done } : w,
        ),
        activity: withActivity(
          state,
          'task',
          entry.taskId,
          action.done
            ? `oznaczył/oznaczyła blok ${formatDuration(entry.plannedHours)} jako wykonany`
            : `odznaczył/odznaczyła blok ${formatDuration(entry.plannedHours)} jako wykonany`,
        ),
      };
      // Para blok-wpis (tracker): „wykonane" = wpis 1:1 w godzinach bloku (o ile
      // te minuty są wolne i blok jest datowany); odznaczenie kasuje wpis z tego
      // bloku, jeśli nikt go nie zmienił. Blok zasobnika nie ma godzin — bez wpisu.
      // Domknięcie zadania sprawdzamy ZAWSZE po oznaczeniu — także gdy wpis 1:1
      // nie mógł powstać (godziny zajęte innym wpisem), bo blok i tak jest wykonany.
      return action.done
        ? autoCompleteTask(linkEntryForBlock(marked, entry), entry.taskId, true)
        : unlinkEntryForBlock(marked, entry);
    }
    case 'SAVE_PROJECT':
      return saveProject(state, action.projectId, action.draft);
    case 'DELETE_PROJECT': {
      // Only log when the project exists. A 'project'-typed row would be pruned
      // by deleteProject itself, so the deletion record lives on 'system' with
      // no entityId. Append onto the post-cascade state (identities unchanged).
      const project = state.projects.find((p) => p.id === action.projectId);
      const next = deleteProject(state, action.projectId);
      if (!project) return next;
      // Utajniony projekt nie zostawia nazwy w niemutowalnym wpisie dziennika.
      const message =
        project.isConfidential === true
          ? 'usunął(a) utajniony projekt'
          : `usunął(a) projekt „${project.name}”`;
      return {
        ...next,
        activity: withActivity(next, 'system', '', message),
      };
    }
    case 'SET_PROJECT_STATUS': {
      // Existing stale-project guard, plus a dangling-statusId reject.
      if (!hasEntity(state, 'status', action.statusId)) return state;
      const status = state.statuses.find((s) => s.id === action.statusId);
      const project = state.projects.find((p) => p.id === action.projectId);
      if (!project || project.statusId === action.statusId) return state;
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? { ...p, statusId: action.statusId, updatedAt: nowIso() }
            : p,
        ),
        activity: withActivity(
          state,
          'project',
          action.projectId,
          `przeniósł/przeniosła projekt do statusu „${status?.name ?? '?'}”`,
        ),
      };
    }
    case 'SET_PROJECT_PAID':
      if (!hasEntity(state, 'project', action.projectId)) return state;
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? { ...p, paid: action.paid, updatedAt: nowIso() }
            : p,
        ),
        activity: withActivity(
          state,
          'project',
          action.projectId,
          action.paid ? 'oznaczył(a) projekt jako opłacony' : 'oznaczył(a) projekt jako nieopłacony',
        ),
      };
    case 'SET_PROJECT_DATES':
      if (periodError(action.startDate, action.endDate) !== null) return state;
      // A stale id would otherwise append a garbage activity row.
      if (!hasEntity(state, 'project', action.projectId)) return state;
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? { ...p, startDate: action.startDate, endDate: action.endDate, updatedAt: nowIso() }
            : p,
        ),
        activity: withActivity(
          state,
          'project',
          action.projectId,
          `zmienił(a) termin projektu na ${action.startDate} – ${action.endDate}`,
        ),
      };
    // ---- Dokumenty projektu ----
    // Wyłącznie ODNOŚNIKI (żadnych plików). Walidacja i normalizacja żyją w
    // commandValidation (normalizeProjectDocumentDraft): pusty adres, adres o
    // schemacie innym niż http(s), nieznany rodzaj albo nieistniejący
    // projekt/dokument => TA SAMA referencja stanu (inwariant 6). Zapisujemy
    // ZNORMALIZOWANY adres, więc w stanie nie ląduje nic, czego nie wolno potem
    // wstawić w `href`. Lista jest osadzona w projekcie, więc DELETE_PROJECT
    // sprząta ją bez osobnej kaskady.
    case 'ADD_PROJECT_DOCUMENT': {
      if (!hasEntity(state, 'project', action.projectId)) return state;
      const normalized = normalizeProjectDocumentDraft(action.draft);
      if (!normalized) return state;
      const doc: ProjectDocument = { id: uid(), ...normalized };
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? { ...p, documents: [...p.documents, doc], updatedAt: nowIso() }
            : p,
        ),
        activity: withActivity(
          state,
          'project',
          action.projectId,
          `dodał(a) dokument „${documentTitle(doc)}”`,
        ),
      };
    }
    case 'SAVE_PROJECT_DOCUMENT': {
      const project = state.projects.find((p) => p.id === action.projectId);
      const current = project?.documents.find((d) => d.id === action.documentId);
      if (!project || !current) return state;
      const normalized = normalizeProjectDocumentDraft(action.draft);
      if (!normalized) return state;
      const next: ProjectDocument = { ...current, ...normalized };
      // Zapis bez żadnej zmiany to no-op (jak SET_TICKET_STATUS): bez wpisu do
      // dziennika i bez ruszania `updatedAt`.
      if (
        next.kind === current.kind &&
        next.label === current.label &&
        next.url === current.url
      ) {
        return state;
      }
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? {
                ...p,
                documents: p.documents.map((d) => (d.id === action.documentId ? next : d)),
                updatedAt: nowIso(),
              }
            : p,
        ),
        activity: withActivity(
          state,
          'project',
          action.projectId,
          `zaktualizował(a) dokument „${documentTitle(next)}”`,
        ),
      };
    }
    case 'DELETE_PROJECT_DOCUMENT': {
      const project = state.projects.find((p) => p.id === action.projectId);
      const doc = project?.documents.find((d) => d.id === action.documentId);
      if (!project || !doc) return state;
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? {
                ...p,
                documents: p.documents.filter((d) => d.id !== action.documentId),
                updatedAt: nowIso(),
              }
            : p,
        ),
        activity: withActivity(
          state,
          'project',
          action.projectId,
          `usunął/usunęła dokument „${documentTitle(doc)}”`,
        ),
      };
    }
    case 'SAVE_MILESTONE':
      return saveMilestone(state, action.milestoneId, action.projectId, action.name, action.date);
    case 'MOVE_MILESTONE': {
      if (!isValidDateStr(action.date)) return state;
      const m = state.milestones.find((x) => x.id === action.milestoneId);
      if (!m || m.date === action.date) return state;
      return {
        ...state,
        milestones: state.milestones.map((x) =>
          x.id === action.milestoneId ? { ...x, date: action.date } : x,
        ),
        activity: withActivity(
          state,
          'project',
          m.projectId,
          `przeniósł/przeniosła kamień milowy „${m.name}” na ${action.date}`,
        ),
      };
    }
    case 'DELETE_MILESTONE': {
      // Reject a stale id by same-reference (previously returned a new copy).
      const m = state.milestones.find((x) => x.id === action.milestoneId);
      if (!m) return state;
      return {
        ...state,
        milestones: state.milestones.filter((x) => x.id !== action.milestoneId),
        activity: withActivity(state, 'project', m.projectId, `usunął/usunęła kamień milowy „${m.name}”`),
      };
    }
    case 'ADD_COMMENT': {
      const body = action.body.trim();
      if (!body) return state;
      return {
        ...state,
        comments: [
          ...state.comments,
          {
            id: uid(),
            entityType: action.entityType,
            entityId: action.entityId,
            authorId: state.currentUserId,
            body,
            mentionIds: action.mentionIds,
            createdAt: nowIso(),
          },
        ],
        activity: withActivity(state, action.entityType, action.entityId, 'dodał(a) komentarz'),
      };
    }
    case 'MARK_NOTIFICATIONS_SEEN': {
      // Stempluje „przeczytane do teraz" na zalogowanej osobie. Bez aktywnego
      // użytkownika lub gdy jego id nie istnieje — TA SAMA referencja (inwariant
      // 6). Czytanie powiadomień nie jest zdarzeniem dziennika (brak activity).
      // Watermark pokrywa wszystkie dotychczasowe wpisy, więc zbiór pojedynczych
      // oznaczeń jest tu zbędny — CZYŚCIMY go (pruning, forma kanoniczna).
      const meId = state.currentUserId;
      if (!meId || !state.people.some((p) => p.id === meId)) return state;
      const seenAt = nowIso();
      return {
        ...state,
        people: state.people.map((p) => {
          if (p.id !== meId) return p;
          const { notificationsReadIds: _pruned, ...rest } = p;
          return { ...rest, notificationsSeenAt: seenAt };
        }),
      };
    }
    case 'MARK_NOTIFICATION_ENTRY_READ': {
      // Oznacza POJEDYNCZY wpis pochodnego feedu. Guardy (=> ta sama referencja,
      // inwariant 6): brak/nieznany użytkownik, pusty lub nie-stringowy `entryId`,
      // id spoza aktualnego feedu, wpis już przeczytany (watermark albo zbiór).
      // Bez wpisu w dzienniku aktywności — parytet z MARK_NOTIFICATIONS_SEEN.
      const meId = state.currentUserId;
      if (!meId) return state;
      const me = state.people.find((p) => p.id === meId);
      if (!me) return state;
      const entryId = action.entryId;
      if (typeof entryId !== 'string' || entryId === '') return state;
      const entry = notificationsForPerson(state, meId, nowIso()).find((n) => n.id === entryId);
      if (!entry || entry.read) return state;
      const readIds = [...(me.notificationsReadIds ?? []), entryId];
      return {
        ...state,
        people: state.people.map((p) =>
          p.id === meId ? { ...p, notificationsReadIds: readIds } : p,
        ),
      };
    }
    case 'ADD_TIME_ENTRY':
      return addTimeEntry(state, action.payload);
    case 'UPDATE_TIME_ENTRY': {
      const w = state.timeEntries.find((e) => e.id === action.entryId);
      if (w === undefined) return state;
      if (!isValidTimeRange(action.startMinutes, action.endMinutes)) return state;
      // Poprawka godzin na TYM SAMYM zadaniu jest dozwolona także po jego
      // zamknięciu (np. auto-„Gotowe" po pełnym wykonaniu): to korekta faktu,
      // nie nowy czas. Zmiana zadania wymaga zadania, które przyjmuje czas.
      if (action.taskId !== w.taskId) {
        if (!timeEntryTaskAccepts(state, action.taskId)) return state;
      } else if (!hasEntity(state, 'task', w.taskId)) return state;
      if (
        findOverlappingEntry(state.timeEntries, w.personId, w.date, action.startMinutes, action.endMinutes, w.id) !==
        undefined
      )
        return state;
      if (w.taskId === action.taskId && w.startMinutes === action.startMinutes && w.endMinutes === action.endMinutes)
        return state;
      // ODWRÓT starego wzrostu planu tego wpisu, potem nadwyżka NOWEJ długości
      // liczona na czystym stanie (stara długość wpisu nie liczy się).
      const reverted = revertPlanGrowth(state, w);
      const growth = planGrowth(reverted, action.taskId, w.personId, w.date, action.endMinutes - action.startMinutes, w.id);
      if (growth.overrunMinutes > 0 && action.acceptOverrun !== true) return state;
      // Ręczna poprawka zrywa więź ze spotkaniem/blokiem: to już nie jest wpis „prosto z kalendarza".
      const { eventId: _dropE, blockId: _dropB, overrunMinutes: _dropO, planGrowth: _dropG, ...rest } = w;
      const next: TimeEntry = {
        ...rest,
        taskId: action.taskId,
        startMinutes: action.startMinutes,
        endMinutes: action.endMinutes,
        source: w.source === 'event' || w.source === 'block' ? 'manual' : w.source,
        ...(growth.overrunMinutes > 0 ? { overrunMinutes: growth.overrunMinutes } : {}),
      };
      const replaced = { ...reverted, timeEntries: reverted.timeEntries.map((e) => (e.id === w.id ? next : e)) };
      let after = materializeTracking(replaced, next, growth);
      // Skrócony wpis mógł zostawić cudzy (wyzwolony) wzrost ponad wykonanie:
      // przycięcie sprowadza plan pary do zalogowanego czasu.
      after = resyncBlockDone(trimPlanGrowth(after, action.taskId, w.personId, next.date), action.taskId, w.personId, next.date);
      // Stara para (inne zadanie/dzień) traci pokrycie: jej bloki wracają do stanu „pokryte = wykonane".
      if (w.taskId !== action.taskId || w.date !== next.date) {
        after = resyncBlockDone(trimPlanGrowth(after, w.taskId, w.personId, w.date), w.taskId, w.personId, w.date);
      }
      return after;
    }
    case 'DELETE_TIME_ENTRY': {
      const w = state.timeEntries.find((e) => e.id === action.entryId);
      if (w === undefined) return state;
      // Odwrót: to, co wpis dopisał do planu, wraca (blok kurczy się / znika,
      // zasobnik odzyskuje minuty); bloki pary wracają do „wykonany = pokryty".
      const reverted = revertPlanGrowth(state, w);
      const without = { ...reverted, timeEntries: reverted.timeEntries.filter((e) => e.id !== action.entryId) };
      // Wpis wyzwalający wzrost zaksięgowany na INNYM wpisie: przycięcie
      // zdejmuje dorośnięty plan pary do poziomu wykonania.
      return resyncBlockDone(trimPlanGrowth(without, w.taskId, w.personId, w.date), w.taskId, w.personId, w.date);
    }
    case 'SETTLE_TRACKED_DAY':
      return settleTrackedDay(state, action.personId, action.date, action.nowMinutes);
    case 'ADD_PERSON': {
      if (!isValidPersonDraft(action.person)) return state;
      const id = uid();
      const base = personFromDraft(action.person);
      // Defensive cycle guard (a fresh id is unreferenced, so this only trips on
      // a self-pointing supervisorId). passwordHash starts empty (passwordless).
      const supervisorId = wouldCreateSupervisorCycle(state.people, id, base.supervisorId)
        ? ''
        : base.supervisorId;
      // Fresh-setup lockout guard: the FIRST person created into an empty people
      // list is forced to `pelne`. Otherwise the login gate would activate
      // (people.length > 0) with zero full-access users and no recovery path.
      const accessRole = state.people.length === 0 ? 'pelne' : base.accessRole;
      return {
        ...state,
        people: [...state.people, { id, ...base, accessRole, supervisorId, passwordHash: '' }],
        // Fresh-setup case (empty people, currentUserId === '') still logs; the
        // actor renders via the UI fallback.
        activity: withActivity(state, 'person', id, `dodał(a) osobę „${base.name}”`),
      };
    }
    case 'UPDATE_PERSON': {
      const base = personFromDraft(action.person);
      // Guard the last administrator: refuse a save that would demote the only
      // remaining admin (returns state unchanged — reject-by-same-ref).
      const target = state.people.find((p) => p.id === action.personId);
      if (!target) return state;
      if (!isValidPersonDraft(action.person)) return state;
      const adminCount = state.people.filter((p) => p.accessRole === 'pelne').length;
      if (
        target?.accessRole === 'pelne' &&
        base.accessRole !== 'pelne' &&
        adminCount === 1
      ) {
        return state;
      }
      // Never let a save form a supervisor cycle; drop the value if it would.
      const supervisorId = wouldCreateSupervisorCycle(
        state.people,
        action.personId,
        base.supervisorId,
      )
        ? ''
        : base.supervisorId;
      // Note a role change in the message; otherwise a plain update row. One row
      // either way, stamped from the pre-update state.
      const message =
        target.accessRole !== base.accessRole
          ? `zaktualizował(a) dane osoby „${base.name}” (rola: ${ROLE_LABELS[target.accessRole]} → ${ROLE_LABELS[base.accessRole]})`
          : `zaktualizował(a) dane osoby „${base.name}”`;
      return {
        ...state,
        people: state.people.map((p) =>
          p.id === action.personId ? { ...p, ...base, supervisorId } : p,
        ),
        activity: withActivity(state, 'person', action.personId, message),
      };
    }
    case 'DELETE_PERSON': {
      // Reject a stale id first (no cascade, no state churn on a missing person).
      if (!hasEntity(state, 'person', action.personId)) return state;
      // Guard the last administrator: refuse to delete the only remaining admin
      // (returns state unchanged). Applied BEFORE the deletePerson cascade so the
      // supervisorId cleanup only runs on an allowed delete.
      const target = state.people.find((p) => p.id === action.personId);
      const adminCount = state.people.filter((p) => p.accessRole === 'pelne').length;
      if (target?.accessRole === 'pelne' && adminCount === 1) {
        return state;
      }
      const next = deletePerson(state, action.personId);
      // Stamp from the PRE-delete state deliberately: deletePerson may clear
      // currentUserId (deleting the acting user) and the row must reflect who
      // acted. The 'person' row survives — it is never pruned.
      return {
        ...next,
        activity: withActivity(state, 'person', action.personId, `usunął(a) osobę „${target!.name}”`),
      };
    }
    case 'SET_CURRENT_USER': {
      // '' is a programmatic identity clear; any other id must exist so a
      // dangling personId can never be persisted as the acting user.
      if (action.personId !== '' && !hasEntity(state, 'person', action.personId)) return state;
      const nextUser = { ...state, currentUserId: action.personId };
      // '' clears identity programmatically — only LOGOUT records a logout, so no
      // row here. A same-id re-select is a no-op — no row.
      if (action.personId === '' || action.personId === state.currentUserId) {
        return nextUser;
      }
      // Login row: the pre-state currentUserId may be '', so attribute to the id
      // that just logged in via the `as` override.
      return {
        ...nextUser,
        activity: withActivity(state, 'system', '', 'zalogował(a) się', {
          actorId: action.personId,
        }),
      };
    }
    case 'SET_PASSWORD': {
      // Stores the given hash verbatim ('' clears the password). Log only when
      // the person exists. The message must never leak set-vs-clear nor the hash.
      const person = state.people.find((p) => p.id === action.personId);
      const nextPw = {
        ...state,
        people: state.people.map((p) =>
          p.id === action.personId ? { ...p, passwordHash: action.passwordHash } : p,
        ),
      };
      if (!person) return nextPw;
      return {
        ...nextPw,
        activity: withActivity(state, 'person', action.personId, `zmienił(a) ustawienia hasła osoby „${person.name}”`),
      };
    }
    case 'LOGOUT': {
      // Full logout: clears the acting identity. Nobody to log out -> no row,
      // state result unchanged from before.
      if (state.currentUserId === '') {
        return { ...state, currentUserId: '' };
      }
      return {
        ...state,
        currentUserId: '',
        activity: withActivity(state, 'system', '', 'wylogował(a) się'),
      };
    }
    case 'ADD_CLIENT': {
      // Wymagane: nazwa, osoba kontaktowa i e-mail ORAZ telefon
      // (isValidClientDraft, reguła AND). Niepełny draft albo niepoprawne
      // `contacts` => TA SAMA referencja stanu (invariant 6).
      if (!isValidClientDraft(action)) return state;
      const name = action.name.trim();
      const contacts = trimClientContacts(action.contacts);
      return {
        ...state,
        clients: [
          ...state.clients,
          {
            id: uid(),
            name,
            archived: false,
            contactName: action.contactName?.trim() ?? '',
            contactEmail: action.contactEmail?.trim() ?? '',
            contactPhone: action.contactPhone?.trim() ?? '',
            notes: action.notes?.trim() ?? '',
            // Forma kanoniczna: klucz obecny WYŁĄCZNIE gdy jest ≥1 dodatkowa osoba.
            ...(contacts.length > 0 ? { contacts } : {}),
          },
        ],
      };
    }
    case 'SAVE_CLIENT': {
      // Jak RENAME_CLIENT: nieznane id odrzucone; do tego pełen komplet pól
      // wymaganych (isValidClientDraft, reguła AND) — brak nazwy, osoby
      // kontaktowej, e-maila albo telefonu, lub niepoprawne `contacts` zwraca TĘ
      // SAMĄ referencję stanu (invariant 6).
      if (!isValidClientDraft(action)) return state;
      const name = action.name.trim();
      if (!state.clients.some((c) => c.id === action.clientId)) return state;
      const contacts = trimClientContacts(action.contacts);
      return {
        ...state,
        clients: state.clients.map((c) => {
          if (c.id !== action.clientId) return c;
          // `contacts: []` USUWA klucz (forma kanoniczna — nigdy pusta tablica).
          const { contacts: _drop, ...rest } = c;
          return {
            ...rest,
            name,
            contactName: action.contactName.trim(),
            contactEmail: action.contactEmail.trim(),
            contactPhone: action.contactPhone.trim(),
            notes: action.notes.trim(),
            ...(contacts.length > 0 ? { contacts } : {}),
          };
        }),
      };
    }
    case 'SET_CLIENT_ARCHIVED': {
      const client = state.clients.find((c) => c.id === action.clientId);
      if (!client || client.archived === action.archived) return state;
      return {
        ...state,
        clients: state.clients.map((c) =>
          c.id === action.clientId ? { ...c, archived: action.archived } : c,
        ),
      };
    }
    case 'RENAME_CLIENT': {
      // Mirror ADD_CLIENT: trim and reject an empty name. Reject an unknown id
      // too, so a stale rename returns the SAME state reference (invariant 6).
      const name = action.name.trim();
      if (!name || !state.clients.some((c) => c.id === action.clientId)) return state;
      return {
        ...state,
        clients: state.clients.map((c) =>
          c.id === action.clientId ? { ...c, name } : c,
        ),
      };
    }
    case 'DELETE_CLIENT': {
      // Cascade: client -> its projects -> their tasks/blocks.
      const client = state.clients.find((c) => c.id === action.clientId);
      let next: AppData = state;
      for (const p of state.projects.filter((p) => p.clientId === action.clientId)) {
        next = deleteProject(next, p.id);
      }
      const cleaned = { ...next, clients: next.clients.filter((c) => c.id !== action.clientId) };
      if (!client) return cleaned;
      // One 'client' row built on the post-cascade state so the cascade's pruning
      // is not resurrected (identities are unchanged, so stamping stays honest).
      return {
        ...cleaned,
        activity: withActivity(cleaned, 'client', action.clientId, `usunął(a) klienta „${client.name}”`),
      };
    }
    case 'ADD_DEPARTMENT': {
      const name = action.name.trim();
      if (!name) return state;
      return {
        ...state,
        departments: [...state.departments, { id: uid(), name }],
      };
    }
    case 'RENAME_DEPARTMENT': {
      const name = action.name.trim();
      if (!name || !state.departments.some((d) => d.id === action.departmentId)) return state;
      return {
        ...state,
        departments: state.departments.map((d) =>
          d.id === action.departmentId ? { ...d, name } : d,
        ),
      };
    }
    case 'DELETE_DEPARTMENT':
      // Clear references; nothing else cascades from a department.
      return {
        ...state,
        departments: state.departments.filter((d) => d.id !== action.departmentId),
        people: state.people.map((p) =>
          p.departmentId === action.departmentId ? { ...p, departmentId: '' } : p,
        ),
        projects: state.projects.map((p) =>
          p.departmentId === action.departmentId ? { ...p, departmentId: '' } : p,
        ),
        tasks: state.tasks.map((t) =>
          t.departmentId === action.departmentId ? { ...t, departmentId: '' } : t,
        ),
      };
    case 'ADD_JOB_TITLE': {
      // Nazwy stanowisk są unikalne bez rozróżniania wielkości liter (pl-PL).
      const name = action.name.trim();
      if (!name) return state;
      const key = name.toLocaleLowerCase('pl-PL');
      if (state.jobTitles.some((j) => j.name.trim().toLocaleLowerCase('pl-PL') === key)) return state;
      return {
        ...state,
        jobTitles: [...state.jobTitles, { id: uid(), name }],
      };
    }
    case 'RENAME_JOB_TITLE': {
      const name = action.name.trim();
      if (!name) return state;
      const target = state.jobTitles.find((j) => j.id === action.jobTitleId);
      if (!target) return state;
      // Zmiana na aktualną nazwę (dosłownie) to no-op — ta sama referencja.
      if (target.name === name) return state;
      // Duplikat INNEGO wiersza (bez rozróżniania wielkości liter) odrzucamy.
      const key = name.toLocaleLowerCase('pl-PL');
      if (
        state.jobTitles.some(
          (j) => j.id !== action.jobTitleId && j.name.trim().toLocaleLowerCase('pl-PL') === key,
        )
      ) {
        return state;
      }
      return {
        ...state,
        jobTitles: state.jobTitles.map((j) =>
          j.id === action.jobTitleId ? { ...j, name } : j,
        ),
      };
    }
    case 'DELETE_JOB_TITLE': {
      // Bez kaskady: `Person.role` to wolny tekst i zachowuje swoją wartość
      // (select w profilu scala zaszłościowe wpisy). Nieznane id => ta sama referencja.
      if (!state.jobTitles.some((j) => j.id === action.jobTitleId)) return state;
      return {
        ...state,
        jobTitles: state.jobTitles.filter((j) => j.id !== action.jobTitleId),
      };
    }
    case 'ADD_COMPANY': {
      // Nazwy spółek są unikalne bez rozróżniania wielkości liter (pl-PL).
      const name = action.name.trim();
      if (!name) return state;
      const key = name.toLocaleLowerCase('pl-PL');
      if (state.companies.some((c) => c.name.trim().toLocaleLowerCase('pl-PL') === key)) return state;
      return {
        ...state,
        companies: [...state.companies, { id: uid(), name }],
      };
    }
    case 'RENAME_COMPANY': {
      const name = action.name.trim();
      if (!name) return state;
      const target = state.companies.find((c) => c.id === action.companyId);
      if (!target) return state;
      // Zmiana na aktualną nazwę (dosłownie) to no-op — ta sama referencja.
      if (target.name === name) return state;
      // Duplikat INNEGO wiersza (bez rozróżniania wielkości liter) odrzucamy.
      const key = name.toLocaleLowerCase('pl-PL');
      if (
        state.companies.some(
          (c) => c.id !== action.companyId && c.name.trim().toLocaleLowerCase('pl-PL') === key,
        )
      ) {
        return state;
      }
      return {
        ...state,
        companies: state.companies.map((c) =>
          c.id === action.companyId ? { ...c, name } : c,
        ),
      };
    }
    case 'DELETE_COMPANY': {
      // Kaskada etykiety (jak DELETE_DEPARTMENT): usunięcie spółki czyści
      // `Person.companyId` na osobach ORAZ `Project.companyId` (spółkę
      // wykonawczą) na projektach; chmurowy FK `on delete set null` to lustruje.
      // Nieznane id => ta sama referencja.
      if (!state.companies.some((c) => c.id === action.companyId)) return state;
      return {
        ...state,
        companies: state.companies.filter((c) => c.id !== action.companyId),
        people: state.people.map((p) =>
          p.companyId === action.companyId ? { ...p, companyId: '' } : p,
        ),
        projects: state.projects.map((p) =>
          p.companyId === action.companyId ? { ...p, companyId: '' } : p,
        ),
        // Kaskada filtrów (jak deleteProject dla projectId): preset/ostatni filtr
        // wskazujący usuwaną spółkę traci `criteria.companyId` (→ '').
        savedFilters: state.savedFilters.map((f) =>
          f.criteria.companyId === action.companyId
            ? { ...f, criteria: { ...f.criteria, companyId: '' } }
            : f,
        ),
        lastFilters: clearCompanyIdInLastFilters(state.lastFilters, action.companyId),
      };
    }
    case 'ADD_SERVICE_TYPE': {
      const name = action.name.trim();
      if (!name) return state;
      return {
        ...state,
        serviceTypes: [...state.serviceTypes, { id: uid(), name }],
      };
    }
    case 'RENAME_SERVICE_TYPE': {
      const name = action.name.trim();
      if (!name || !state.serviceTypes.some((s) => s.id === action.serviceTypeId)) return state;
      return {
        ...state,
        serviceTypes: state.serviceTypes.map((s) =>
          s.id === action.serviceTypeId ? { ...s, name } : s,
        ),
      };
    }
    case 'DELETE_SERVICE_TYPE':
      return {
        ...state,
        serviceTypes: state.serviceTypes.filter((s) => s.id !== action.serviceTypeId),
        projects: state.projects.map((p) =>
          p.serviceTypeId === action.serviceTypeId ? { ...p, serviceTypeId: '' } : p,
        ),
      };
    case 'ADD_WORK_CATEGORY': {
      const name = action.name.trim();
      if (!name) return state;
      return {
        ...state,
        workCategories: [...state.workCategories, { id: uid(), name }],
      };
    }
    case 'RENAME_WORK_CATEGORY': {
      const name = action.name.trim();
      if (!name || !state.workCategories.some((c) => c.id === action.workCategoryId)) return state;
      return {
        ...state,
        workCategories: state.workCategories.map((c) =>
          c.id === action.workCategoryId ? { ...c, name } : c,
        ),
      };
    }
    case 'DELETE_WORK_CATEGORY':
      return {
        ...state,
        workCategories: state.workCategories.filter((c) => c.id !== action.workCategoryId),
        tasks: state.tasks.map((t) =>
          t.workCategoryId === action.workCategoryId ? { ...t, workCategoryId: '' } : t,
        ),
        savedFilters: state.savedFilters.map((filter) =>
          filter.criteria.workCategoryId === action.workCategoryId
            ? { ...filter, criteria: { ...filter.criteria, workCategoryId: '' } }
            : filter,
        ),
        lastFilters: clearWorkCategoryIdInLastFilters(state.lastFilters, action.workCategoryId),
      };
    case 'SAVE_STATUS':
      return saveStatus(state, action.statusId, action.name, action.color);
    case 'REORDER_PROJECT_TASK':
      return reorderProjectTask(state, action.taskId, action.direction);
    case 'REORDER_STATUS':
      return reorderStatus(state, action.statusId, action.direction);
    case 'SET_STATUS_ARCHIVED':
      return setStatusArchived(state, action.statusId, action.archived);
    case 'SET_STATUS_DONE':
      return setStatusDone(state, action.statusId, action.isDone);
    case 'DELETE_STATUS':
      return deleteStatus(state, action.statusId);
    case 'INSERT_BLOCK':
      return insertBlock(state, action.payload);
    case 'REASSIGN_ENTRY':
      return reassignEntry(state, action.entryId, action.toPersonId);
    case 'SET_BLOCK_TIME':
      return setBlockTime(
        state,
        action.entryId,
        action.date,
        action.startMinutes,
        action.plannedHours,
      );
    case 'MOVE_BLOCK_TO_BIN':
      return moveBlockToBin(state, action.entryId);
    case 'SPLIT_BLOCK':
      return splitBlock(state, action.entryId, action.parts);
    case 'SCHEDULE_BIN_PART':
      return scheduleBinPart(
        state,
        action.entryId,
        action.date,
        action.startMinutes,
        action.hours,
      );
    case 'DELETE_BLOCK':
      return deleteBlock(state, action.entryId);
    case 'SAVE_FILTER_PRESET': {
      const name = action.name.trim();
      if (!name) return state;
      // Nieznana strona lub strukturalnie zniekształcone kryteria => TA SAMA
      // referencja (inwariant 6). Dangling projectId/workCategoryId i wartości
      // spoza enuma są sanityzowane do '' przez wspólny `sanitizeFilterCriteria`.
      if (!isFilterPage(action.page)) return state;
      if (
        typeof action.criteria !== 'object' ||
        action.criteria === null ||
        Array.isArray(action.criteria)
      ) {
        return state;
      }
      const criteria = sanitizeFilterCriteria(state, action.criteria);
      const existing = state.savedFilters.find(
        (f) => f.page === action.page && f.name === name,
      );
      if (existing) {
        return {
          ...state,
          savedFilters: state.savedFilters.map((f) =>
            f.id === existing.id ? { ...f, criteria } : f,
          ),
        };
      }
      return {
        ...state,
        savedFilters: [
          ...state.savedFilters,
          { id: uid(), name, page: action.page, criteria },
        ],
      };
    }
    case 'DELETE_FILTER_PRESET':
      return {
        ...state,
        savedFilters: state.savedFilters.filter((f) => f.id !== action.filterId),
      };
    case 'SET_LAST_FILTER': {
      // Nieznany widok lub strukturalnie zniekształcony ładunek => ta sama
      // referencja (inwariant 6). Inaczej: sanityzuj, porównaj po wartości do
      // bieżącego wpisu — no-op zwraca tę samą referencję.
      if (!isFilterViewKey(action.view)) return state;
      if (!isStructuralLastViewFilter(action.filter)) return state;
      const clean = sanitizeLastViewFilter(state, action.filter);
      const current = state.lastFilters[action.view];
      // Widok kalendarza (Dzień | Tydzień | Miesiąc) przeżywa zapisy, które go
      // nie niosą (np. „Otwórz w kalendarzu” z Obciążenia pisze sam filtr
      // osób) — review Codex 2026-09-02. Jawna wartość nadal wygrywa.
      const sanitized: LastViewFilter =
        action.view === 'calendar' && clean.calendarView === undefined && current?.calendarView !== undefined
          ? { ...clean, calendarView: current.calendarView }
          : clean;
      if (current && lastViewFilterEqual(current, sanitized)) return state;
      return {
        ...state,
        lastFilters: { ...state.lastFilters, [action.view]: sanitized },
      };
    }
    // ---- Zgłoszenia ----
    // Walidacja żyje w commandValidation (isValidTicketDraft): pusty tytuł/opis,
    // nieznany reporterId albo wartość spoza enuma => TA SAMA referencja stanu
    // (inwariant 6). Kolekcja jest samodzielna — brak kaskad i wpisów dziennika.
    case 'ADD_TICKET': {
      if (!isValidTicketDraft(state, action.draft)) return state;
      const stamp = nowIso();
      return {
        ...state,
        tickets: [
          ...state.tickets,
          {
            id: uid(),
            title: action.draft.title.trim(),
            area: action.draft.area.trim(),
            description: action.draft.description.trim(),
            kind: action.draft.kind,
            priority: action.draft.priority,
            status: DEFAULT_TICKET_STATUS,
            reporterId: action.draft.reporterId,
            createdAt: stamp,
            updatedAt: stamp,
          },
        ],
      };
    }
    case 'SAVE_TICKET': {
      if (!state.tickets.some((t) => t.id === action.ticketId)) return state;
      if (!isValidTicketDraft(state, action.draft)) return state;
      return {
        ...state,
        tickets: state.tickets.map((t) =>
          t.id === action.ticketId
            ? {
                ...t,
                title: action.draft.title.trim(),
                area: action.draft.area.trim(),
                description: action.draft.description.trim(),
                kind: action.draft.kind,
                priority: action.draft.priority,
                reporterId: action.draft.reporterId,
                updatedAt: nowIso(),
              }
            : t,
        ),
      };
    }
    case 'SET_TICKET_STATUS': {
      const ticket = state.tickets.find((t) => t.id === action.ticketId);
      if (!ticket || !isValidTicketStatus(action.status)) return state;
      // Ponowne ustawienie tego samego statusu to no-op (jak SET_TASK_STATUS).
      if (ticket.status === action.status) return state;
      return {
        ...state,
        tickets: state.tickets.map((t) =>
          t.id === action.ticketId ? { ...t, status: action.status, updatedAt: nowIso() } : t,
        ),
      };
    }
    case 'DELETE_TICKET': {
      if (!state.tickets.some((t) => t.id === action.ticketId)) return state;
      return { ...state, tickets: state.tickets.filter((t) => t.id !== action.ticketId) };
    }
    // ---- Wydarzenia kalendarza (spotkania) ----
    // Walidacja i normalizacja żyją w commandValidation (normalizeEventDraft):
    // pusty tytuł, zła data/czasy, dangling uczestnik, zły adres albo cykliczność
    // bez dnia kotwicy => TA SAMA referencja stanu (inwariant 6). Kolekcja jest
    // czysto prezentacyjna — brak kaskad, sum ani wpisów dziennika (inwariant 1).
    case 'ADD_EVENT': {
      const normalized = normalizeEventDraft(state, action.draft);
      if (normalized === null) return state;
      // Od 2026-08-06 `blocking` dla imiennych niesie WYŁĄCZNIE urlop
      // uczestnika — tylko on odrzuca zapis (inwariant 6: ta sama referencja
      // stanu). Pozostałe kolizje wracają jako ostrzeżenia: EventModal wymaga
      // dla nich potwierdzenia w dialogu (bramka UX), ogólnofirmowe pokazują
      // samą żywą linię.
      if (eventDraftConflicts(state, normalized).blocking.length > 0) return state;
      const stamp = nowIso();
      return {
        ...state,
        events: [
          ...state.events,
          {
            id: uid(),
            title: normalized.title,
            description: normalized.description,
            location: normalized.location,
            meetingUrl: normalized.meetingUrl,
            date: normalized.date,
            startMinutes: normalized.startMinutes,
            durationMinutes: normalized.durationMinutes,
            attendeeIds: normalized.attendeeIds,
            ...(normalized.recurrence ? { recurrence: normalized.recurrence } : {}),
            ...(normalized.kind ? { kind: normalized.kind } : {}),
            ...(normalized.endDate ? { endDate: normalized.endDate } : {}),
            // Utajnienie tylko od zarządu i NIGDY na urlopie (forma kanoniczna).
            ...(isBoardMember(state) &&
            action.draft.isConfidential === true &&
            normalized.kind !== 'urlop'
              ? { isConfidential: true as const }
              : {}),
            createdAt: stamp,
            updatedAt: stamp,
          },
        ],
      };
    }
    case 'SAVE_EVENT': {
      if (!state.events.some((e) => e.id === action.eventId)) return state;
      const normalized = normalizeEventDraft(state, action.draft);
      if (normalized === null) return state;
      // Jak w ADD_EVENT, ale edytowane wydarzenie nie może kolidować SAMO ZE
      // SOBĄ — inaczej samo otwarcie i zapis bez zmian byłoby odrzucone.
      if (eventDraftConflicts(state, normalized, action.eventId).blocking.length > 0) {
        return state;
      }
      const confidentialAllowed = isBoardMember(state);
      return {
        ...state,
        events: state.events.map((e) => {
          if (e.id !== action.eventId) return e;
          // Utajnienie: wartość z draftu tylko od zarządu, brak pola / nie-zarząd
          // zachowuje stan wydarzenia; urlop NIGDY nie niesie flagi.
          const confidential =
            normalized.kind === 'urlop'
              ? false
              : confidentialAllowed && action.draft.isConfidential !== undefined
                ? action.draft.isConfidential === true
                : e.isConfidential === true;
          // Odpowiedzi RSVP przeżywają edycję, RE-KANONIKALIZOWANE względem
          // nowej reguły/kotwicy (zmiana dni tygodnia/until wycina wpisy spoza
          // wystąpień); zdjęcie cykliczności lub urlop = klucz znika.
          const rsvps =
            normalized.kind === 'urlop' || normalized.recurrence === undefined
              ? undefined
              : normalizeEventRsvps(e.rsvps, normalized.recurrence, normalized.date);
          const next: CalendarEvent = {
            id: e.id,
            title: normalized.title,
            description: normalized.description,
            location: normalized.location,
            meetingUrl: normalized.meetingUrl,
            date: normalized.date,
            startMinutes: normalized.startMinutes,
            durationMinutes: normalized.durationMinutes,
            attendeeIds: normalized.attendeeIds,
            ...(normalized.recurrence ? { recurrence: normalized.recurrence } : {}),
            ...(rsvps ? { rsvps } : {}),
            ...(normalized.kind ? { kind: normalized.kind } : {}),
            ...(normalized.endDate ? { endDate: normalized.endDate } : {}),
            ...(confidential ? { isConfidential: true as const } : {}),
            createdAt: e.createdAt,
            updatedAt: nowIso(),
          };
          return next;
        }),
      };
    }
    case 'DELETE_EVENT': {
      if (!state.events.some((e) => e.id === action.eventId)) return state;
      return { ...state, events: state.events.filter((e) => e.id !== action.eventId) };
    }
    case 'SET_EVENT_RSVP': {
      // RSVP ma sens WYŁĄCZNIE dla wystąpienia wydarzenia cyklicznego
      // (jednorazowe spotkanie = wypisz się z uczestników; urlop nie ma
      // cykliczności kanonicznie). Nieprawidłowa komenda => ta sama referencja
      // (inwariant 6).
      const event = state.events.find((e) => e.id === action.eventId);
      if (event === undefined || event.kind === 'urlop' || event.recurrence === undefined) {
        return state;
      }
      if (action.personId === '' || !state.people.some((p) => p.id === action.personId)) {
        return state;
      }
      // Imienne spotkanie: odpowiedź tylko dla uczestnika. Ogólnofirmowe
      // (`attendeeIds` puste) — dla każdej osoby zespołu.
      if (event.attendeeIds.length > 0 && !event.attendeeIds.includes(action.personId)) {
        return state;
      }
      if (action.status !== 'yes' && action.status !== 'no' && action.status !== null) {
        return state;
      }
      if (!isValidDateStr(action.date) || !isOccurrenceDate(event.recurrence, event.date, action.date)) {
        return state;
      }
      const existing = event.rsvps ?? [];
      const without = existing.filter(
        (r) => !(r.date === action.date && r.personId === action.personId),
      );
      const nextRaw =
        action.status === null
          ? without
          : [...without, { date: action.date, personId: action.personId, status: action.status }];
      const rsvps = normalizeEventRsvps(nextRaw, event.recurrence, event.date);
      return {
        ...state,
        events: state.events.map((e) => {
          if (e.id !== action.eventId) return e;
          const { rsvps: _prev, ...rest } = e;
          return { ...rest, ...(rsvps ? { rsvps } : {}), updatedAt: nowIso() };
        }),
      };
    }
    // ---- Content Plan (marki i publikacje modułu) ----
    // Walidacja i normalizacja żyją w `src/contentplan/domain.ts`
    // (`normalizeContentPlanBrandDraft` / `normalizeContentPlanPostDraft`):
    // pusta nazwa/tytuł, nieznana marka, zła data, status/widoczność spoza
    // zbioru, zły kanał, base64 zamiast referencji do Drive albo próba
    // udostępnienia niekompletnej publikacji => TA SAMA referencja stanu
    // (inwariant 6). Kolekcje są samodzielne — bez wpisów dziennika aktywności
    // (parytet z ticketami i wydarzeniami); własną historię niesie publikacja.
    case 'SAVE_CP_BRAND': {
      const normalized = normalizeContentPlanBrandDraft(action.draft);
      if (normalized === null) return state;
      const stamp = nowIso();
      if (action.brandId === null) {
        return {
          ...state,
          contentPlanBrands: [
            ...state.contentPlanBrands,
            {
              id: uniqueBrandId(normalized.name, state.contentPlanBrands),
              ...normalized,
              createdAt: stamp,
              updatedAt: stamp,
            },
          ],
        };
      }
      const brandId = action.brandId;
      if (!state.contentPlanBrands.some((b) => b.id === brandId)) return state;
      return {
        ...state,
        contentPlanBrands: state.contentPlanBrands.map((b) =>
          // Id marki NIE zmienia się z nazwą: publikacje wskazują je po wartości.
          b.id === brandId ? { ...b, ...normalized, updatedAt: stamp } : b,
        ),
      };
    }
    case 'DELETE_CP_BRAND': {
      if (!state.contentPlanBrands.some((b) => b.id === action.brandId)) return state;
      // Jedyna kaskada modułu: publikacje bez marki nie mają gdzie się pokazać.
      return {
        ...state,
        contentPlanBrands: state.contentPlanBrands.filter((b) => b.id !== action.brandId),
        contentPlanPosts: state.contentPlanPosts.filter((p) => p.brandId !== action.brandId),
      };
    }
    case 'SAVE_CP_POST': {
      const normalized = normalizeContentPlanPostDraft(action.draft, state.contentPlanBrands);
      if (normalized === null) return state;
      const stamp = nowIso();
      const label = (action.historyLabel ?? '').trim();
      if (action.postId === null) {
        const entry: ContentPlanHistoryEntry = {
          id: contentPlanUid(),
          label: label === '' ? 'Utworzono slot publikacji' : label,
          at: stamp,
        };
        return {
          ...state,
          contentPlanPosts: [
            ...state.contentPlanPosts,
            {
              id: contentPlanUid(),
              ...normalized,
              comments: [],
              history: [entry],
              createdAt: stamp,
              updatedAt: stamp,
            },
          ],
        };
      }
      const postId = action.postId;
      if (!state.contentPlanPosts.some((p) => p.id === postId)) return state;
      return {
        ...state,
        contentPlanPosts: state.contentPlanPosts.map((p) => {
          if (p.id !== postId) return p;
          const entry: ContentPlanHistoryEntry = {
            id: contentPlanUid(),
            label: label === '' ? 'Zaktualizowano publikację' : label,
            at: stamp,
          };
          const next: ContentPlanPost = {
            id: p.id,
            ...normalized,
            // Komentarze i historia mają własne akcje — zapis ich nie przepisuje.
            comments: p.comments,
            history: [entry, ...p.history],
            createdAt: p.createdAt,
            updatedAt: stamp,
          };
          return next;
        }),
      };
    }
    case 'DELETE_CP_POST': {
      if (!state.contentPlanPosts.some((p) => p.id === action.postId)) return state;
      return {
        ...state,
        contentPlanPosts: state.contentPlanPosts.filter((p) => p.id !== action.postId),
      };
    }
    case 'REVIEW_CP_POST': {
      const post = state.contentPlanPosts.find((p) => p.id === action.postId);
      if (!post) return state;
      if (!isContentPlanReviewDecision(action.decision)) return state;
      // Decyzja dotyczy WYŁĄCZNIE udostępnionej publikacji (parytet ze źródłem:
      // szkic nie jest jeszcze widoczny dla klienta).
      if (post.visibility !== 'published') return state;
      const author = (action.author ?? '').trim();
      if (author === '') return state;
      const stamp = nowIso();
      return {
        ...state,
        contentPlanPosts: state.contentPlanPosts.map((p) =>
          p.id === action.postId
            ? {
                ...p,
                status: action.decision,
                history: [
                  {
                    id: contentPlanUid(),
                    label: reviewHistoryLabel(author, action.decision),
                    at: stamp,
                  },
                  ...p.history,
                ],
                updatedAt: stamp,
              }
            : p,
        ),
      };
    }
    case 'PUBLISH_CP_MONTH': {
      if (!isMonthKey(action.monthKey)) return state;
      if (!state.contentPlanBrands.some((b) => b.id === action.brandId)) return state;
      const inMonth = state.contentPlanPosts.filter(
        (p) => p.brandId === action.brandId && isPostInMonth(p, action.monthKey),
      );
      // Pusty miesiąc nie jest „udostępniony” — nie ma czego zmienić.
      if (inMonth.length === 0) return state;
      // ATOMOWO: jedna niekompletna publikacja blokuje cały miesiąc.
      if (inMonth.some((p) => validatePostForPublication(p).length > 0)) return state;
      const pending = inMonth.filter((p) => p.visibility !== 'published');
      if (pending.length === 0) return state; // wszystko już udostępnione => no-op
      const pendingIds = new Set(pending.map((p) => p.id));
      const stamp = nowIso();
      return {
        ...state,
        contentPlanPosts: state.contentPlanPosts.map((p) =>
          pendingIds.has(p.id)
            ? {
                ...p,
                visibility: 'published' as const,
                history: [
                  {
                    id: contentPlanUid(),
                    label: 'Udostępniono miesiąc klientowi',
                    at: stamp,
                  },
                  ...p.history,
                ],
                updatedAt: stamp,
              }
            : p,
        ),
      };
    }
    case 'ADD_CP_COMMENT': {
      const post = state.contentPlanPosts.find((p) => p.id === action.postId);
      if (!post) return state;
      // Komentarze zbieramy na UDOSTĘPNIONEJ publikacji (parytet ze źródłem).
      if (post.visibility !== 'published') return state;
      const author = (action.author ?? '').trim();
      const body = (action.body ?? '').trim();
      if (author === '' || body === '') return state;
      const parentId = (action.parentId ?? '').trim();
      // Odpowiedź musi wskazywać komentarz TEJ publikacji — inaczej wątek by się
      // rozjechał i treść zniknęłaby z widoku.
      if (action.parentId !== undefined && parentId === '') return state;
      if (parentId !== '' && !post.comments.some((c) => c.id === parentId)) return state;
      const stamp = nowIso();
      const comment: ContentPlanComment = {
        id: contentPlanUid(),
        author,
        body,
        at: stamp,
        ...(parentId !== '' ? { parentId } : {}),
      };
      return {
        ...state,
        contentPlanPosts: state.contentPlanPosts.map((p) =>
          p.id === action.postId
            ? {
                ...p,
                comments: [comment, ...p.comments],
                history: [
                  {
                    id: contentPlanUid(),
                    label: `${author}: dodał(a) ${parentId !== '' ? 'odpowiedź' : 'komentarz'}`,
                    at: stamp,
                  },
                  ...p.history,
                ],
                updatedAt: stamp,
              }
            : p,
        ),
      };
    }
    case 'LOAD_SAMPLE':
      return { ...action.data, sampleBannerDismissed: true };
    case 'DISMISS_SAMPLE_BANNER':
      return { ...state, sampleBannerDismissed: true };
    case 'RESET_ALL':
      return action.data;
    case 'REPLACE_FROM_STORAGE':
      return action.data;
    case 'MERGE_CLOUD_ENTITIES':
      return mergeCloudEntities(state, action.payload);
    case 'MERGE_CLOUD_PEOPLE':
      return mergeCloudPeople(state, action.payload);
    case 'MERGE_CLOUD_DICTIONARIES':
      return mergeCloudDictionaries(state, action.payload);
    case 'MARK_NOTIFICATION_READ':
      return markNotificationRead(state, action.notificationId);
    case 'MARK_ALL_NOTIFICATIONS_READ':
      return markAllNotificationsRead(state);
    case 'MERGE_CLOUD_NOTIFICATIONS':
      return mergeCloudNotifications(state, action.payload);
    case 'MERGE_CLOUD_CONTENT_PLAN':
      return mergeCloudContentPlan(state, action.payload);
    default:
      return state;
  }
}

interface StoreValue {
  state: AppData;
  dispatch: React.Dispatch<Action>;
  // Type of the LAST dispatched action. The cloud mirror (CloudSyncProvider)
  // reads it to suppress its own hydration and local-only transitions
  // (MERGE_CLOUD_ENTITIES / REPLACE_FROM_STORAGE / LOAD_SAMPLE / RESET_ALL).
  // No consumer signature changes — existing useStore() callers ignore it.
  lastActionRef: React.MutableRefObject<Action['type'] | null>;
}

/**
 * The NEVER-CHANGING half of the store: everything a consumer can use without
 * re-rendering per action. Its value object is created ONCE per provider
 * instance, so a dispatch-only consumer (`useDispatch`) re-renders zero times
 * when an action lands.
 */
export interface StoreApi {
  dispatch: React.Dispatch<Action>;
  lastActionRef: React.MutableRefObject<Action['type'] | null>;
  /** The state committed RIGHT NOW — for event handlers, never for render. */
  getState(): AppData;
  /** Notified once per reference-changing dispatch. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
  /**
   * Akcja, która wytworzyła DOKŁADNIE tę referencję stanu (undefined dla stanu
   * początkowego). W odróżnieniu od `lastActionRef` (pojedynczy, nadpisywalny
   * slot „ostatniego dispatchu") to parowanie jest odporne na dispatch, który
   * wciska się między commit a efekt — lustro chmury rozpoznaje nim własne
   * scalenia hydracji bez ryzyka echa (patrz CloudSyncProvider).
   */
  actionFor(state: AppData): Action | undefined;
}

// This is a SPLIT of the ONE store context into its changing half (the state)
// and its constant half (the api) — NOT provider multiplication. `useStore()`
// recomposes both, so every unmigrated consumer keeps its exact behaviour.
const StateContext = createContext<AppData | null>(null);
const StoreApiContext = createContext<StoreApi | null>(null);

// ---- Persistence meta-state (honest save outcome + same-browser tab safety) --
// This lives OUTSIDE the reducer: it is meta-state about the persist layer, and
// dispatching from the persist effect would risk loops. A separate context
// keeps useStore's signature and every existing consumer untouched.

export type ExternalDataStatus = 'none' | 'refreshed' | 'conflict';

export interface PersistenceValue {
  saveError: SaveFailureReason | null;
  external: ExternalDataStatus;
  /** Re-attempt saveData(current state) NOW (synchronicznie, z pominięciem
   *  koalescencji). Zwraca wynik zapisu. */
  retryPersist: () => boolean;
  /**
   * Licznik UDANYCH zapisów do pamięci (rośnie po każdym `saveData` z `ok`,
   * z koalescera i ścieżek natychmiastowych). Powierzchnia, która chce
   * potwierdzić utrwalenie KONKRETNEJ zmiany, zapamiętuje wartość przy
   * dispatchu i czeka, aż licznik ją przekroczy (tracker czasu).
   */
  persistSeq: number;
  /**
   * Poproś, żeby NAJBLIŻSZY zapis po tym dispatchu poszedł od razu (bez okna
   * koalescencji). Realizowany WEWNĄTRZ efektu persist providera: jeden zapis,
   * żadnego zaległego, zduplikowanego wpisu w koalescerze (który mógłby potem
   * po cichu nadpisać zapis innej karty). Flaga zużywa się przy najbliższym
   * przejściu stanu.
   */
  requestImmediatePersist: () => void;
  /** Replace local state with loadData() (UI confirms first). */
  acceptExternal: () => void;
  /** Write current state NOW, overwriting the external version. */
  keepLocal: () => void;
  /** 'refreshed' -> 'none'. */
  dismissExternalNotice: () => void;
}

const PersistenceContext = createContext<PersistenceValue | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const initialLoadRef = useRef<Extract<ReturnType<typeof loadDataResult>, { ok: true }> | null>(
    null,
  );
  if (initialLoadRef.current === null) {
    const result = loadDataResult();
    if (!result.ok) throw result.error;
    initialLoadRef.current = result;
  }
  const initialLoad = initialLoadRef.current;

  // ONE external store per provider instance (created lazily in a ref — never a
  // module singleton, so a StrictMode remount or a second test render starts
  // clean). It runs the SAME `reducer` synchronously; everything downstream
  // (`[state]` persist effect, colour registration, contexts, conflict flow)
  // still sees exactly one committed state per change.
  // Documented trade-off: React's dev-only double-invoke of the reducer (a
  // `useReducer` purity check) no longer happens.
  const storeRef = useRef<ExternalStore<AppData, Action> | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createExternalStore<AppData, Action>(reducer, initialLoad.data);
  }
  const store = storeRef.current;
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  // Track the last dispatched action type so the cloud mirror can suppress its
  // own hydration and local-only transitions. A thin wrapper keeps useStore()'s
  // signature and every existing consumer untouched: `lastActionRef` is still
  // set BEFORE the reducer runs.
  const lastActionRef = useRef<Action['type'] | null>(null);
  const dispatch = useCallback<React.Dispatch<Action>>((action) => {
    lastActionRef.current = action.type;
    store.dispatch(action);
  }, []);

  const [saveError, setSaveError] = useState<SaveFailureReason | null>(null);
  // Licznik udanych zapisów + jednorazowa prośba o zapis natychmiastowy (patrz
  // PersistenceValue.persistSeq / requestImmediatePersist).
  const [persistSeq, setPersistSeq] = useState(0);
  const immediatePersistRef = useRef(false);
  const [external, setExternal] = useState<ExternalDataStatus>('none');
  const [loadError, setLoadError] = useState<Error | null>(null);

  // Live refs synced each render so the mount-once storage listener and the
  // stable callbacks read current values without stale closures.
  const stateRef = useRef(state);
  stateRef.current = state;
  const saveErrorRef = useRef(saveError);
  saveErrorRef.current = saveError;
  const externalRef = useRef(external);
  externalRef.current = external;

  // Skip the pointless first persist of freshly-loaded state (a mount echo that
  // would bump the revision and spam other tabs), and skip the write-back right
  // after any REPLACE_FROM_STORAGE (that state was just loaded from storage).
  const skipPersistRef = useRef(!initialLoad.needsWriteback);
  // React StrictMode replays mount effects in development. Remember the state
  // object whose persistence was already attempted so an initial repair is
  // written exactly once (and a clean load is never echo-written on replay).
  const lastPersistAttemptRef = useRef<AppData | null>(null);

  // Assign person colours by stable list order. Done during render (idempotent)
  // so colours are correct on the first paint of any consumer — but guarded by
  // the last `state.people` reference so an unrelated dispatch (the common case)
  // does not rebuild the id list + re-register on every provider render.
  const lastPeopleRef = useRef<AppData['people'] | null>(null);
  if (lastPeopleRef.current !== state.people) {
    lastPeopleRef.current = state.people;
    registerPersonOrder(state.people.map((p) => p.id));
  }

  // One coalescer for the whole provider lifetime (created lazily on first
  // render). `onResult` mirrors the exact outcome handling the [state] effect
  // used to do inline: record saveError (eagerly on the ref too, so the
  // external-change callback can read a just-completed flush's outcome
  // synchronously) and — on success — collapse an open conflict to resolved
  // (implicit keep-mine). saveData / setSaveError / setExternal are all stable.
  const coalescerRef = useRef<ReturnType<typeof createPersistCoalescer> | null>(null);
  if (coalescerRef.current === null) {
    coalescerRef.current = createPersistCoalescer({
      save: saveData,
      onResult: (result) => {
        saveErrorRef.current = result.ok ? null : result.reason;
        setSaveError(result.ok ? null : result.reason);
        if (result.ok) setExternal((prev) => (prev === 'conflict' ? 'none' : prev));
        if (result.ok) setPersistSeq((n) => n + 1);
      },
      delayMs: PERSIST_COALESCE_MS,
    });
  }
  const coalescer = coalescerRef.current;

  // Persist on every state change and RECORD the real outcome. A failed write
  // surfaces via `saveError` (usePersistence); a subsequent successful write
  // clears it and — per the conflict lifecycle — collapses an outstanding
  // external conflict to resolved (continuing to work here is an implicit
  // keep-mine). The first run (and the run right after an in-place
  // REPLACE_FROM_STORAGE) is skipped: that state already matches storage.
  //
  // The write itself is COALESCED (see persistCoalescer): rapid dispatch (a
  // drag) now serializes once per window instead of on every action. The
  // skip-first / StrictMode-replay guards and the retirement gate are evaluated
  // PER TRANSITION exactly as before; only the terminal saveData(state) call is
  // replaced by coalescer.schedule(state). A gated transition schedules nothing
  // and does NOT disturb an already-pending older state (that older state still
  // saves on its own timer — the old world had already written it).
  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      lastPersistAttemptRef.current = state;
      immediatePersistRef.current = false;
      return;
    }
    if (lastPersistAttemptRef.current === state) return;
    const prevAttempted = lastPersistAttemptRef.current;
    lastPersistAttemptRef.current = state;
    // Retirement gate (supabase mode only): while retired + mirror-healthy and the
    // transition touched ONLY cloud-mirrored collections, skip the per-action
    // localStorage write — the recovery copy is refreshed by CloudSyncProvider on
    // hydration/queue-drain/error/pagehide instead. Leave `saveError` unchanged
    // (no false `Zapisano`, no false error). Any degradation resumes local writes.
    if (prevAttempted !== null && shouldSkipLocalPersist(prevAttempted, state)) {
      immediatePersistRef.current = false;
      return;
    }
    coalescer.schedule(state);
    // Prośba o zapis natychmiastowy: TEN SAM koalescer pisze od razu i czyści
    // swój slot — w kolejce nie zostaje żaden zaległy duplikat tego stanu.
    if (immediatePersistRef.current) {
      immediatePersistRef.current = false;
      coalescer.flush();
    }
  }, [state]);

  // Mount-once: force any pending coalesced save to disk before the tab is
  // hidden or torn down. `pagehide` and a `hidden` visibility transition are the
  // reliable "user is leaving" signals; the cleanup flush protects the
  // StrictMode dev double-mount (a pending state must never be silently lost —
  // mount 1 skips the first persist so its cleanup flush is a no-op).
  useEffect(() => {
    const flushPending = (): void => coalescer.flush();
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') coalescer.flush();
    };
    window.addEventListener('pagehide', flushPending);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushPending);
      document.removeEventListener('visibilitychange', onVisibility);
      coalescer.flush();
    };
  }, []);

  // Mount-once: subscribe to same-browser external tab writes. A clean tab
  // refreshes in place; a dirty tab (unsaved form edits, a failed local write,
  // or an already-open conflict) raises an explicit conflict choice instead of
  // being silently overwritten.
  useEffect(() => {
    return subscribeExternalChanges((info) => {
      // If a coalesced save is pending, flush it FIRST. subscribeExternalChanges
      // already max-merged latestKnownRevision with the incoming revision, so
      // this write lands ABOVE the external revision by construction. A SUCCESS
      // means storage now equals our state → silent keep-mine short-circuit
      // (reproduces the old-world race where a local dispatch saved after the
      // external write). A FAILURE left saveError set, so fall through: the
      // dirty check below then raises the explicit conflict.
      if (coalescer.hasPending()) {
        coalescer.flush();
        if (saveErrorRef.current === null) return;
      } else if (isOwnLastWrite(info.newValue)) {
        // Cheap fast path: the event carries our own bounced-back write (byte
        // compare) or storage still holds our last revision — our own content,
        // so skip parsing + deep-comparing the whole envelope.
        return;
      }
      const loaded = loadDataResult();
      if (!loaded.ok) {
        setLoadError(loaded.error);
        return;
      }
      const incoming = loaded.data;
      // Full semantic compare fallback: an external tab may have written data
      // identical to ours under a different revision (no dispatch, no banner).
      if (JSON.stringify(incoming) === JSON.stringify(stateRef.current)) return;
      const dirty =
        anyDirty() || saveErrorRef.current !== null || externalRef.current === 'conflict';
      if (dirty) {
        setExternal('conflict');
        return;
      }
      skipPersistRef.current = !loaded.needsWriteback;
      dispatch({ type: 'REPLACE_FROM_STORAGE', data: incoming });
      setExternal('refreshed');
    });
  }, []);

  const retryPersist = useCallback(() => {
    // Drop the pending coalesced write (stateRef is newest — the pending copy is
    // redundant) and write immediately, as before.
    coalescer.cancel();
    const result = saveData(stateRef.current);
    saveErrorRef.current = result.ok ? null : result.reason;
    setSaveError(result.ok ? null : result.reason);
    if (result.ok) setExternal((prev) => (prev === 'conflict' ? 'none' : prev));
    if (result.ok) setPersistSeq((n) => n + 1);
    return result.ok;
  }, []);

  const requestImmediatePersist = useCallback(() => {
    immediatePersistRef.current = true;
  }, []);

  const acceptExternal = useCallback(() => {
    const loaded = loadDataResult();
    if (!loaded.ok) {
      setLoadError(loaded.error);
      return;
    }
    // The user chose the external version: drop any pending local write so it
    // cannot clobber the external payload afterwards (old-world equivalent left
    // storage holding the external write).
    coalescer.cancel();
    skipPersistRef.current = !loaded.needsWriteback;
    dispatch({ type: 'REPLACE_FROM_STORAGE', data: loaded.data });
    setExternal('none');
  }, []);

  const keepLocal = useCallback(() => {
    // Drop the redundant pending write and persist the newest state immediately.
    coalescer.cancel();
    const result = saveData(stateRef.current);
    setSaveError(result.ok ? null : result.reason);
    if (result.ok) setExternal('none');
    if (result.ok) setPersistSeq((n) => n + 1);
  }, []);

  const dismissExternalNotice = useCallback(() => {
    setExternal((prev) => (prev === 'refreshed' ? 'none' : prev));
  }, []);

  // Stable api surface: `dispatch` is `useCallback([])`-stable and the store's
  // own `getState`/`subscribe` are fixed for its lifetime, so `storeApi` is
  // referentially CONSTANT — a dispatch-only consumer never re-renders.
  const storeApi = useMemo<StoreApi>(
    () => ({
      dispatch,
      lastActionRef,
      getState: store.getState,
      subscribe: store.subscribe,
      actionFor: store.actionFor,
    }),
    [dispatch, store],
  );

  const persistence = useMemo<PersistenceValue>(
    () => ({
      saveError,
      external,
      retryPersist,
      acceptExternal,
      keepLocal,
      dismissExternalNotice,
      persistSeq,
      requestImmediatePersist,
    }),
    [
      saveError,
      external,
      retryPersist,
      acceptExternal,
      keepLocal,
      dismissExternalNotice,
      persistSeq,
      requestImmediatePersist,
    ],
  );

  // Storage-event callbacks and explicit conflict acceptance run outside
  // render, so route their load failures back through the root ErrorBoundary on
  // the next render. The raw storage key remains untouched for export/reset.
  if (loadError) throw loadError;

  return (
    <StoreApiContext.Provider value={storeApi}>
      <StateContext.Provider value={state}>
        <PersistenceContext.Provider value={persistence}>{children}</PersistenceContext.Provider>
      </StateContext.Provider>
    </StoreApiContext.Provider>
  );
}

/**
 * Compatibility façade: recomposes both halves of the split context, so it still
 * re-renders on every action and every existing consumer behaves identically.
 * New code should prefer `useDispatch()` (no re-render) or `useSelector()`.
 */
export function useStore(): StoreValue {
  const api = useContext(StoreApiContext);
  const state = useContext(StateContext);
  const value = useMemo(
    () =>
      api && state
        ? { state, dispatch: api.dispatch, lastActionRef: api.lastActionRef }
        : null,
    [api, state],
  );
  if (!value) throw new Error('useStore must be used within AppStoreProvider');
  return value;
}

/** Dispatch only — referentially constant, so it NEVER re-renders on an action. */
export function useDispatch(): React.Dispatch<Action> {
  const api = useContext(StoreApiContext);
  if (!api) throw new Error('useDispatch must be used within AppStoreProvider');
  return api.dispatch;
}

/** The constant api object (dispatch + lastActionRef + getState + subscribe + actionFor). */
export function useStoreApi(): StoreApi {
  const api = useContext(StoreApiContext);
  if (!api) throw new Error('useStoreApi must be used within AppStoreProvider');
  return api;
}

// The equality helper used by list/slice selections. Defined in the React-free
// externalStore module (so it is unit-testable in the node environment) and
// re-exported here, next to useSelector, which is where callers reach for it.
export { shallowEqual };

/**
 * Subscribe to a SLICE of the store. The component re-renders only when the
 * selection fails `isEqual` — the default `Object.is` is right for primitives
 * and for cached selectors (per-revision stable references); pass
 * {@link shallowEqual} for object/array selections.
 *
 * Deliberately built on React 18's own `useSyncExternalStore` (no
 * `use-sync-external-store/with-selector` dependency): `selector`/`isEqual` live
 * in refs, and the stable `getSnapshot` returns the PREVIOUS result whenever the
 * new one is equal, so React sees a stable snapshot and skips the render.
 */
export function useSelector<T>(
  selector: (state: AppData) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const api = useContext(StoreApiContext);
  const apiRef = useRef(api);
  apiRef.current = api;
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const isEqualRef = useRef(isEqual);
  isEqualRef.current = isEqual;
  const cacheRef = useRef<{ filled: boolean; value: T }>({
    filled: false,
    value: undefined as unknown as T,
  });

  const subscribe = useCallback((listener: () => void) => {
    const current = apiRef.current;
    if (!current) return () => {};
    return current.subscribe(listener);
  }, []);

  const getSnapshot = useCallback((): T => {
    const current = apiRef.current;
    if (!current) throw new Error('useSelector must be used within AppStoreProvider');
    const next = selectorRef.current(current.getState());
    const cache = cacheRef.current;
    if (cache.filled && isEqualRef.current(cache.value, next)) return cache.value;
    cacheRef.current = { filled: true, value: next };
    return next;
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function usePersistence(): PersistenceValue {
  const ctx = useContext(PersistenceContext);
  if (!ctx) throw new Error('usePersistence must be used within AppStoreProvider');
  return ctx;
}
