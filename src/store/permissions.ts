// Central permission map. ONE obvious entry point: `can(user, action, opts)`.
//
// This package only SHIPS the map — applying it across pages/nav is a later
// package (PKG-20260708-permission-gating). Enforcement is UI-level only until
// the API era (a determined user can edit localStorage directly).
//
// Setup-mode rule (mirrors selectors.isAdminUser): when the app has zero people
// there is nobody to be anybody, so EVERYTHING is allowed to avoid lockout.
// Callers signal this by passing `{ peopleCount: 0 }`.
import type { AccessRole, Person } from '../types';

/** Shared tooltip for controls disabled because the current role lacks a permission. */
export const NO_PERM_TITLE = 'Brak uprawnień';

/** Polish labels for the access roles (UI selects / badges). */
export const ROLE_LABELS: Record<AccessRole, string> = {
  administrator: 'Administrator',
  pm: 'PM',
  handlowiec: 'Handlowiec',
  pracownik: 'Pracownik',
};

export type PermAction =
  | 'projects.manage' // create/edit/delete projects, status, dates, milestones
  | 'projects.paid' // coin (paid) toggle
  | 'clients.manage' // add/edit/delete clients (also outside the admin panel)
  | 'tasks.manage' // create/edit/delete tasks, task statuses, allocations
  | 'blocks.editAny' // calendar blocks of anyone
  | 'blocks.editOwn' // calendar blocks where entry.personId === self
  | 'people.manage' // add/edit/delete people, roles, supervisors
  | 'profile.editOwn' // own contact fields, avatar, password
  | 'workload.reassign' // WorkloadPage reassign control
  | 'admin.panel' // admin page: statuses, clients, departments, service types
  | 'comments.add' // post comments
  | 'tickets.create' // złożenie zgłoszenia („Zgłoszenia” → „Zgłoś”) — KAŻDA rola
  | 'tickets.manage' // wgląd we wszystkie zgłoszenia, zmiana statusu, usuwanie, eksport
  | 'events.manage'; // tworzenie/edycja/usuwanie wydarzeń kalendarza (spotkań)

/** Per-role allow-set. Absence ⇒ denied. Everyone may VIEW every page but /admin. */
const MATRIX: Record<AccessRole, ReadonlySet<PermAction>> = {
  administrator: new Set<PermAction>([
    'projects.manage',
    'projects.paid',
    'clients.manage',
    'tasks.manage',
    'blocks.editAny',
    'blocks.editOwn',
    'people.manage',
    'profile.editOwn',
    'workload.reassign',
    'admin.panel',
    'comments.add',
    'tickets.create',
    'tickets.manage',
    'events.manage',
  ]),
  pm: new Set<PermAction>([
    'projects.manage',
    'tasks.manage',
    'blocks.editAny',
    'blocks.editOwn',
    'profile.editOwn',
    'workload.reassign',
    'comments.add',
    'tickets.create',
    'events.manage',
  ]),
  // Zadania dodaje każda rola poza specjalistą (pracownik): menedżer działu
  // (pm), handlowiec i administrator — decyzja 2026-07-20.
  handlowiec: new Set<PermAction>([
    'projects.manage',
    'projects.paid',
    'clients.manage',
    'tasks.manage',
    'blocks.editOwn',
    'profile.editOwn',
    'comments.add',
    'tickets.create',
    // Handlowiec umawia spotkania z klientami — decyzja 2026-07-21.
    'events.manage',
  ]),
  pracownik: new Set<PermAction>([
    'blocks.editOwn',
    'profile.editOwn',
    'comments.add',
    'tickets.create',
  ]),
};

/**
 * May `user` perform `action`? Setup mode (`opts.peopleCount === 0`) allows
 * everything. Otherwise an undefined user is denied everything, and a real user
 * is checked against their role's allow-set.
 */
export function can(
  user: Person | undefined,
  action: PermAction,
  opts?: { peopleCount?: number },
): boolean {
  if (opts?.peopleCount === 0) return true; // setup mode — no lockout
  if (!user) return false;
  return MATRIX[user.accessRole]?.has(action) ?? false;
}
