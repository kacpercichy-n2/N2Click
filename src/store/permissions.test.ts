// Unit tests for the central permission map (src/store/permissions.ts) and the
// password hashing utility (src/utils/password.ts), both new in the v5
// accounts/roles/permissions run (PKG-20260708-auth-data).
import { describe, expect, it } from 'vitest';
import { can, ROLE_LABELS, type PermAction } from './permissions';
import { hashPassword, verifyPassword } from '../utils/password';
import type { AccessRole, Person } from '../types';

function makePerson(accessRole: AccessRole, overrides: Partial<Person> = {}): Person {
  return {
    id: 'p1',
    firstName: 'Test',
    lastName: '',
    name: 'Test',
    email: '',
    phone: '',
    role: '',
    departmentId: '',
    companyId: '',
    avatar: '',
    capacity: 8,
    accessRole,
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
    birthDate: '',
    ...overrides,
  };
}

// Pełna matryca po kolapsie ról (2026-07-22) — jedna komórka na (rola, akcja).
// `pelne` = dawny zbiór administratora (wszystko), `ograniczone` = dawny zbiór
// pracownika (tylko blocks.editOwn, profile.editOwn, comments.add, tickets.create).
const MATRIX: Record<AccessRole, Record<PermAction, boolean>> = {
  pelne: {
    'projects.manage': true,
    'projects.paid': true,
    'clients.manage': true,
    'tasks.manage': true,
    'blocks.editAny': true,
    'blocks.editOwn': true,
    'people.manage': true,
    'profile.editOwn': true,
    'workload.reassign': true,
    'admin.panel': true,
    'comments.add': true,
    'tickets.create': true,
    'tickets.manage': true,
    'events.manage': true,
  },
  ograniczone: {
    'projects.manage': false,
    'projects.paid': false,
    'clients.manage': false,
    'tasks.manage': false,
    'blocks.editAny': false,
    'blocks.editOwn': true,
    'people.manage': false,
    'profile.editOwn': true,
    'workload.reassign': false,
    'admin.panel': false,
    'comments.add': true,
    'tickets.create': true,
    'tickets.manage': false,
    'events.manage': false,
  },
};

const ROLES = Object.keys(MATRIX) as AccessRole[];
const ACTIONS = Object.keys(MATRIX.pelne) as PermAction[];

const CASES: Array<[AccessRole, PermAction, boolean]> = ROLES.flatMap((role) =>
  ACTIONS.map((action) => [role, action, MATRIX[role][action]] as [AccessRole, PermAction, boolean]),
);

describe('can() — full role x action matrix', () => {
  it.each(CASES)('%s can perform %s -> %s', (role, action, expected) => {
    expect(can(makePerson(role), action)).toBe(expected);
  });

  it('setup mode (zero people) allows every action, even with no user', () => {
    for (const action of ACTIONS) {
      expect(can(undefined, action, { peopleCount: 0 })).toBe(true);
    }
  });

  it('an undefined user (people present) is denied every action', () => {
    for (const action of ACTIONS) {
      expect(can(undefined, action, { peopleCount: 3 })).toBe(false);
      expect(can(undefined, action)).toBe(false); // no opts at all
    }
  });
});

describe('ROLE_LABELS', () => {
  it('has the two Polish role labels', () => {
    expect(ROLE_LABELS).toEqual({
      pelne: 'Pełne',
      ograniczone: 'Ograniczone',
    });
  });
});

describe('password utility', () => {
  it("hashPassword('a') resolves to the documented SHA-256 hex digest", async () => {
    const hash = await hashPassword('a');
    expect(hash).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
    expect(hash).toHaveLength(64);
  });

  it('verifyPassword accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });
});
