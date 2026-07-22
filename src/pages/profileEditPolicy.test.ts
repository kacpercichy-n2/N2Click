// Testy czystej polityki edycji profilu: pełna macierz ról × cel oraz reguła
// uprawnień do wgrania zdjęcia (mode × rola × self). Bez importu Reacta.
import { describe, expect, it } from 'vitest';
import type { AccessRole, Person } from '../types';
import {
  canEditAnyProfileField,
  canUploadAvatarPhoto,
  canViewProfileDetails,
  editableProfileFields,
  type ProfileField,
} from './profileEditPolicy';

let seq = 0;
const person = (over: Partial<Person> = {}): Person => ({
  id: `id-${seq++}`,
  firstName: 'Jan',
  lastName: 'Kowalski',
  name: 'Jan Kowalski',
  email: 'jan@example.com',
  phone: '',
  role: '',
  departmentId: 'dep-a',
  avatar: '',
  capacity: 8,
  accessRole: 'pracownik',
  passwordHash: '',
  workDays: [1, 2, 3, 4, 5],
  workStartMinutes: 480,
  workEndMinutes: 960,
  supervisorId: '',
  birthDate: '',
  ...over,
});

const sorted = (set: ReadonlySet<ProfileField>) => [...set].sort();
const ALL: ProfileField[] = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'roleTitle',
  'departmentId',
  'companyId',
  'avatarEmoji',
  'capacity',
  'accessRole',
  'workDays',
  'workHours',
  'supervisorId',
  'birthDate',
];
const opts = { peopleCount: 5 };

describe('editableProfileFields', () => {
  it('tryb setup (0 osób) — wszystko', () => {
    const p = person();
    expect(sorted(editableProfileFields(undefined, p, { peopleCount: 0 }))).toEqual([...ALL].sort());
  });

  it('administrator — wszystko (także cudzy profil)', () => {
    const admin = person({ accessRole: 'administrator' });
    const target = person();
    expect(sorted(editableProfileFields(admin, target, opts))).toEqual([...ALL].sort());
  });

  it('self (nie-admin) — zawężony zbiór; email NIE jest edytowalny', () => {
    const self = person({ accessRole: 'pracownik' });
    const set = editableProfileFields(self, self, opts);
    expect(sorted(set)).toEqual(['avatarEmoji', 'birthDate', 'firstName', 'lastName', 'phone']);
    expect(set.has('email')).toBe(false);
    expect(set.has('departmentId')).toBe(false);
    expect(set.has('companyId')).toBe(false); // spółka wyłącznie administrator
    expect(set.has('accessRole')).toBe(false);
    expect(set.has('capacity')).toBe(false);
  });

  it('spółka (companyId) jest edytowalna wyłącznie przez administratora / tryb setup', () => {
    const admin = person({ accessRole: 'administrator' });
    const target = person({ accessRole: 'pracownik', departmentId: 'dep-a' });
    // administrator: tak
    expect(editableProfileFields(admin, target, opts).has('companyId')).toBe(true);
    // tryb setup: tak
    expect(editableProfileFields(undefined, target, { peopleCount: 0 }).has('companyId')).toBe(true);
    // PM z tego samego działu: nie
    const pm = person({ accessRole: 'pm', departmentId: 'dep-a' });
    expect(editableProfileFields(pm, target, opts).has('companyId')).toBe(false);
  });

  it('PM — specjalista (pracownik/handlowiec) z własnego działu (nie-admin, nie self)', () => {
    // D1: „specjalista" = pracownik LUB handlowiec — obie role są edytowalne.
    for (const role of ['pracownik', 'handlowiec'] as AccessRole[]) {
      const pm = person({ accessRole: 'pm', departmentId: 'dep-a' });
      const target = person({ accessRole: role, departmentId: 'dep-a' });
      expect(sorted(editableProfileFields(pm, target, opts))).toEqual([
        'birthDate',
        'phone',
        'roleTitle',
        'supervisorId',
        'workDays',
        'workHours',
      ]);
    }
  });

  it('PM — cel z innego działu → pusto', () => {
    const pm = person({ accessRole: 'pm', departmentId: 'dep-a' });
    const target = person({ accessRole: 'pracownik', departmentId: 'dep-b' });
    expect(editableProfileFields(pm, target, opts).size).toBe(0);
  });

  it('PM bez działu ("") — nie zarządza nikim mimo pustego działu celu', () => {
    const pm = person({ accessRole: 'pm', departmentId: '' });
    const target = person({ accessRole: 'pracownik', departmentId: '' });
    expect(editableProfileFields(pm, target, opts).size).toBe(0);
  });

  it('PM — cel administrator z tego samego działu → pusto', () => {
    const pm = person({ accessRole: 'pm', departmentId: 'dep-a' });
    const target = person({ accessRole: 'administrator', departmentId: 'dep-a' });
    expect(editableProfileFields(pm, target, opts).size).toBe(0);
  });

  it('PM — cel INNY PM z tego samego działu → pusto (menedżer nie edytuje menedżera)', () => {
    const pm = person({ accessRole: 'pm', departmentId: 'dep-a' });
    const otherPm = person({ accessRole: 'pm', departmentId: 'dep-a' });
    expect(editableProfileFields(pm, otherPm, opts).size).toBe(0);
  });

  it('PM na samym sobie → zbiór self (nie zbiór menedżera)', () => {
    const pm = person({ accessRole: 'pm', departmentId: 'dep-a' });
    expect(sorted(editableProfileFields(pm, pm, opts))).toEqual([
      'avatarEmoji',
      'birthDate',
      'firstName',
      'lastName',
      'phone',
    ]);
  });

  it('pracownik / handlowiec na innych → pusto', () => {
    for (const role of ['pracownik', 'handlowiec'] as AccessRole[]) {
      const actor = person({ accessRole: role, departmentId: 'dep-a' });
      const target = person({ accessRole: 'pracownik', departmentId: 'dep-a' });
      expect(editableProfileFields(actor, target, opts).size).toBe(0);
    }
  });

  it('undefined aktor → pusto', () => {
    expect(editableProfileFields(undefined, person(), opts).size).toBe(0);
  });

  it('canEditAnyProfileField odzwierciedla niepusty zbiór', () => {
    const admin = person({ accessRole: 'administrator' });
    const worker = person({ accessRole: 'pracownik', departmentId: 'dep-a' });
    const other = person({ accessRole: 'pracownik', departmentId: 'dep-b' });
    expect(canEditAnyProfileField(admin, other, opts)).toBe(true);
    expect(canEditAnyProfileField(worker, other, opts)).toBe(false);
  });
});

describe('canViewProfileDetails — obłożenie / projekty / zadania', () => {
  it('tryb setup (0 osób) → widoczne nawet bez aktora', () => {
    expect(canViewProfileDetails(undefined, person(), { peopleCount: 0 })).toBe(true);
  });

  it('administrator widzi szczegóły dowolnej osoby', () => {
    const admin = person({ accessRole: 'administrator' });
    const target = person({ departmentId: 'dep-b' });
    expect(canViewProfileDetails(admin, target, opts)).toBe(true);
  });

  it('self widzi własne szczegóły (także specjalista)', () => {
    const self = person({ accessRole: 'pracownik' });
    expect(canViewProfileDetails(self, self, opts)).toBe(true);
  });

  it('PM widzi szczegóły osoby z własnego działu (dowolna rola celu)', () => {
    const pm = person({ accessRole: 'pm', departmentId: 'dep-a' });
    const otherPm = person({ accessRole: 'pm', departmentId: 'dep-a' });
    expect(canViewProfileDetails(pm, otherPm, opts)).toBe(true);
    // Specjalista (pracownik/handlowiec) z własnego działu — obie role widoczne.
    for (const role of ['pracownik', 'handlowiec'] as AccessRole[]) {
      const target = person({ accessRole: role, departmentId: 'dep-a' });
      expect(canViewProfileDetails(pm, target, opts)).toBe(true);
    }
  });

  it('PM NIE widzi szczegółów osoby z innego działu', () => {
    const pm = person({ accessRole: 'pm', departmentId: 'dep-a' });
    const target = person({ accessRole: 'pracownik', departmentId: 'dep-b' });
    expect(canViewProfileDetails(pm, target, opts)).toBe(false);
  });

  it('PM bez działu ("") nie widzi szczegółów innych mimo pustego działu celu', () => {
    const pm = person({ accessRole: 'pm', departmentId: '' });
    const target = person({ accessRole: 'pracownik', departmentId: '' });
    expect(canViewProfileDetails(pm, target, opts)).toBe(false);
  });

  it('specjalista (pracownik/handlowiec) NIE widzi szczegółów innych', () => {
    for (const role of ['pracownik', 'handlowiec'] as AccessRole[]) {
      const actor = person({ accessRole: role, departmentId: 'dep-a' });
      const target = person({ accessRole: 'pracownik', departmentId: 'dep-a' });
      expect(canViewProfileDetails(actor, target, opts)).toBe(false);
    }
  });

  it('undefined aktor (poza setup) → false', () => {
    expect(canViewProfileDetails(undefined, person(), opts)).toBe(false);
  });
});

describe('canUploadAvatarPhoto', () => {
  const admin = person({ accessRole: 'administrator' });
  const worker = person({ accessRole: 'pracownik', departmentId: 'dep-a' });
  const other = person({ accessRole: 'pracownik', departmentId: 'dep-a' });
  const pm = person({ accessRole: 'pm', departmentId: 'dep-a' });

  it('tryb lokalny → nigdy', () => {
    expect(canUploadAvatarPhoto(admin, admin, 'local', opts)).toBe(false);
    expect(canUploadAvatarPhoto(admin, worker, 'local', { peopleCount: 0 })).toBe(false);
  });

  it('supabase: administrator dowolny, self tak, cudze nie', () => {
    expect(canUploadAvatarPhoto(admin, other, 'supabase', opts)).toBe(true);
    expect(canUploadAvatarPhoto(worker, worker, 'supabase', opts)).toBe(true);
    expect(canUploadAvatarPhoto(pm, other, 'supabase', opts)).toBe(false);
    expect(canUploadAvatarPhoto(worker, other, 'supabase', opts)).toBe(false);
  });

  it('supabase + tryb setup → tak nawet bez aktora', () => {
    expect(canUploadAvatarPhoto(undefined, worker, 'supabase', { peopleCount: 0 })).toBe(true);
  });

  it('supabase + undefined aktor (poza setup) → nie', () => {
    expect(canUploadAvatarPhoto(undefined, worker, 'supabase', opts)).toBe(false);
  });
});
