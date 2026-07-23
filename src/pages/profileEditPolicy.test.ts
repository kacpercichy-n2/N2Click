// Testy czystej polityki edycji profilu: pełna macierz ról × cel oraz reguła
// uprawnień do wgrania zdjęcia (mode × rola × self). Bez importu Reacta.
import { describe, expect, it } from 'vitest';
import type { Person } from '../types';
import {
  canEditAnyProfileField,
  canUploadAvatarPhoto,
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
  accessRole: 'ograniczone',
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
  'emailNotifications',
];
const opts = { peopleCount: 5 };

describe('editableProfileFields', () => {
  it('tryb setup (0 osób) — wszystko', () => {
    const p = person();
    expect(sorted(editableProfileFields(undefined, p, { peopleCount: 0 }))).toEqual([...ALL].sort());
  });

  it('rola pełne — wszystko (także cudzy profil)', () => {
    const admin = person({ accessRole: 'pelne' });
    const target = person();
    expect(sorted(editableProfileFields(admin, target, opts))).toEqual([...ALL].sort());
  });

  it('self (rola ograniczone) — zawężony zbiór; email NIE jest edytowalny', () => {
    const self = person({ accessRole: 'ograniczone' });
    const set = editableProfileFields(self, self, opts);
    expect(sorted(set)).toEqual([
      'avatarEmoji',
      'birthDate',
      'emailNotifications',
      'firstName',
      'lastName',
      'phone',
    ]);
    expect(set.has('email')).toBe(false);
    expect(set.has('departmentId')).toBe(false);
    expect(set.has('companyId')).toBe(false); // spółka wyłącznie rola pełne
    expect(set.has('accessRole')).toBe(false);
    expect(set.has('capacity')).toBe(false);
  });

  it('spółka (companyId) jest edytowalna wyłącznie przez rolę pełne / tryb setup', () => {
    const admin = person({ accessRole: 'pelne' });
    const target = person({ accessRole: 'ograniczone', departmentId: 'dep-a' });
    // rola pełne: tak
    expect(editableProfileFields(admin, target, opts).has('companyId')).toBe(true);
    // tryb setup: tak
    expect(editableProfileFields(undefined, target, { peopleCount: 0 }).has('companyId')).toBe(true);
    // rola ograniczone na cudzym profilu: nie
    const limited = person({ accessRole: 'ograniczone', departmentId: 'dep-a' });
    expect(editableProfileFields(limited, target, opts).has('companyId')).toBe(false);
  });

  it('rola ograniczone na samym sobie → zbiór self', () => {
    const limited = person({ accessRole: 'ograniczone', departmentId: 'dep-a' });
    expect(sorted(editableProfileFields(limited, limited, opts))).toEqual([
      'avatarEmoji',
      'birthDate',
      'emailNotifications',
      'firstName',
      'lastName',
      'phone',
    ]);
  });

  it('rola ograniczone na innych → pusto (gałąź menedżera zniknęła)', () => {
    const actor = person({ accessRole: 'ograniczone', departmentId: 'dep-a' });
    const sameDept = person({ accessRole: 'ograniczone', departmentId: 'dep-a' });
    const otherDept = person({ accessRole: 'pelne', departmentId: 'dep-b' });
    expect(editableProfileFields(actor, sameDept, opts).size).toBe(0);
    expect(editableProfileFields(actor, otherDept, opts).size).toBe(0);
  });

  it('undefined aktor → pusto', () => {
    expect(editableProfileFields(undefined, person(), opts).size).toBe(0);
  });

  it('canEditAnyProfileField odzwierciedla niepusty zbiór', () => {
    const admin = person({ accessRole: 'pelne' });
    const worker = person({ accessRole: 'ograniczone', departmentId: 'dep-a' });
    const other = person({ accessRole: 'ograniczone', departmentId: 'dep-b' });
    expect(canEditAnyProfileField(admin, other, opts)).toBe(true);
    expect(canEditAnyProfileField(worker, other, opts)).toBe(false);
  });
});

describe('canUploadAvatarPhoto', () => {
  const admin = person({ accessRole: 'pelne' });
  const worker = person({ accessRole: 'ograniczone', departmentId: 'dep-a' });
  const other = person({ accessRole: 'ograniczone', departmentId: 'dep-a' });

  it('tryb lokalny → nigdy', () => {
    expect(canUploadAvatarPhoto(admin, admin, 'local', opts)).toBe(false);
    expect(canUploadAvatarPhoto(admin, worker, 'local', { peopleCount: 0 })).toBe(false);
  });

  it('supabase: rola pełne dowolny, self tak, cudze nie', () => {
    expect(canUploadAvatarPhoto(admin, other, 'supabase', opts)).toBe(true);
    expect(canUploadAvatarPhoto(worker, worker, 'supabase', opts)).toBe(true);
    expect(canUploadAvatarPhoto(worker, other, 'supabase', opts)).toBe(false);
  });

  it('supabase + tryb setup → tak nawet bez aktora', () => {
    expect(canUploadAvatarPhoto(undefined, worker, 'supabase', { peopleCount: 0 })).toBe(true);
  });

  it('supabase + undefined aktor (poza setup) → nie', () => {
    expect(canUploadAvatarPhoto(undefined, worker, 'supabase', opts)).toBe(false);
  });
});
