// Testy czystej bramki modułu „Content plan" (trasa /content-plan). Środowisko
// node, bez jsdom — moduł jest celowo pozbawiony Reacta i DOM-u.
//
// Kryterium pod testem to decyzja operatora z 2026-08-03: moduł widzą WYŁĄCZNIE
// administratorzy, niezależnie od grantu modułu.
import { describe, expect, it } from 'vitest';
import {
  CONTENT_PLAN_ROLES,
  canViewContentPlan,
  contentPlanViewer,
  type ContentPlanModuleAccess,
} from './contentPlanScope';
import type { CloudRole, OrgSnapshot, OrgState } from '../supabase/referenceData';
import type { Person } from '../types';

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: 'p1',
    firstName: 'Ala',
    lastName: 'Kowalska',
    name: 'Ala Kowalska',
    email: '',
    phone: '',
    role: '',
    departmentId: '',
    companyId: '',
    avatar: '',
    capacity: 8,
    accessRole: 'pelne',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
    birthDate: '',
    ...overrides,
  };
}

function snapshot(cloudRole: CloudRole): OrgSnapshot {
  return {
    profile: {
      id: 'cloud',
      firstName: 'C',
      lastName: '',
      email: '',
      roleTitle: '',
      cloudRole,
      departmentId: null,
      companyId: null,
      supervisorId: null,
      phone: '',
      avatar: '',
      capacity: 8,
      workDays: [1, 2, 3, 4, 5],
      workStartMinutes: 480,
      workEndMinutes: 960,
      birthDate: '',
    },
    profiles: [],
    departments: [],
    statuses: [],
    serviceTypes: [],
    workCategories: [],
    jobTitles: [],
    companies: [],
  };
}

function readyOrg(cloudRole: CloudRole): OrgState {
  return { status: 'ready', snapshot: snapshot(cloudRole) };
}

const NO_PROFILE: OrgState = {
  status: 'ready',
  snapshot: { ...snapshot('administrator'), profile: null },
};

/** Wszystkie warianty grantu modułu — kryterium ma je ignorować. */
const ALL_MODULE_ACCESS: ContentPlanModuleAccess[] = [null, 'admin', 'editor', 'client'];

describe('canViewContentPlan — tylko administratorzy', () => {
  it('administrator widzi moduł', () => {
    expect(canViewContentPlan({ role: 'administrator' }, null)).toBe(true);
  });

  it('menedżer i pracownik nie widzą modułu', () => {
    expect(canViewContentPlan({ role: 'manager' }, null)).toBe(false);
    expect(canViewContentPlan({ role: 'worker' }, null)).toBe(false);
  });

  it('brak użytkownika (niezalogowany / brak tożsamości) nie widzi modułu', () => {
    expect(canViewContentPlan(undefined, null)).toBe(false);
    expect(canViewContentPlan(undefined, 'admin')).toBe(false);
  });

  it('grant modułu NIE zmienia jeszcze wyniku dla żadnej roli', () => {
    for (const access of ALL_MODULE_ACCESS) {
      expect(canViewContentPlan({ role: 'administrator' }, access)).toBe(true);
      expect(canViewContentPlan({ role: 'manager' }, access)).toBe(false);
      expect(canViewContentPlan({ role: 'worker' }, access)).toBe(false);
      expect(canViewContentPlan(undefined, access)).toBe(false);
    }
  });

  it('lista dopuszczonych ról jest jednym źródłem kryterium', () => {
    expect(CONTENT_PLAN_ROLES).toEqual(['administrator']);
  });
});

describe('contentPlanViewer — skąd bierze się rola', () => {
  it('tryb supabase + gotowy snapshot + własny profil => rola chmury (bez kolapsu menedżera)', () => {
    const local = person({ accessRole: 'pelne' });
    expect(contentPlanViewer(local, readyOrg('manager'), { mode: 'supabase' })).toEqual({
      role: 'manager',
    });
    // Kluczowa różnica względem effectiveAccessRole: menedżer NIE awansuje na
    // administratora, więc modułu nie zobaczy.
    expect(
      canViewContentPlan(contentPlanViewer(local, readyOrg('manager'), { mode: 'supabase' }), null),
    ).toBe(false);
    expect(
      canViewContentPlan(
        contentPlanViewer(local, readyOrg('administrator'), { mode: 'supabase' }),
        null,
      ),
    ).toBe(true);
    expect(
      canViewContentPlan(contentPlanViewer(local, readyOrg('worker'), { mode: 'supabase' }), null),
    ).toBe(false);
  });

  it('tryb lokalny => rola lokalna (pelne → administrator, ograniczone → worker)', () => {
    const full = person({ accessRole: 'pelne' });
    const limited = person({ accessRole: 'ograniczone' });
    const org: OrgState = { status: 'idle' };
    expect(contentPlanViewer(full, org, { mode: 'local' })).toEqual({ role: 'administrator' });
    expect(contentPlanViewer(limited, org, { mode: 'local' })).toEqual({ role: 'worker' });
    expect(canViewContentPlan(contentPlanViewer(full, org, { mode: 'local' }), null)).toBe(true);
    expect(canViewContentPlan(contentPlanViewer(limited, org, { mode: 'local' }), null)).toBe(
      false,
    );
  });

  it('tryb lokalny ignoruje snapshot, nawet gotowy', () => {
    const limited = person({ accessRole: 'ograniczone' });
    expect(contentPlanViewer(limited, readyOrg('administrator'), { mode: 'local' })).toEqual({
      role: 'worker',
    });
  });

  it('ładowanie / błąd / brak profilu w chmurze => fallback na rolę lokalną', () => {
    const limited = person({ accessRole: 'ograniczone' });
    const states: OrgState[] = [
      { status: 'idle' },
      { status: 'loading' },
      { status: 'error', message: 'x' },
      NO_PROFILE,
    ];
    for (const org of states) {
      expect(contentPlanViewer(limited, org, { mode: 'supabase' })).toEqual({ role: 'worker' });
    }
  });

  it('brak lokalnej tożsamości => brak pytającego w każdym trybie', () => {
    expect(contentPlanViewer(undefined, readyOrg('administrator'), { mode: 'supabase' })).toBeUndefined();
    expect(contentPlanViewer(undefined, { status: 'idle' }, { mode: 'local' })).toBeUndefined();
  });
});
