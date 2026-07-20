import { describe, expect, it } from 'vitest';
import {
  avatarDirectoryEntries,
  mergeResolvedAvatars,
  planAvatarFetch,
  type ResolvedAvatar,
} from './avatarDirectory';

const profile = (email: string, avatarPath: string | null) => ({ email, avatarPath });

describe('avatarDirectoryEntries', () => {
  it('bierze tylko profile ze ścieżką awatara i normalizuje e-mail', () => {
    const entries = avatarDirectoryEntries([
      profile('  Anna@N2.PL ', 'a/avatar.jpg'),
      profile('bez@n2.pl', null),
    ]);
    expect(entries).toEqual([{ email: 'anna@n2.pl', path: 'a/avatar.jpg' }]);
  });

  it('pomija puste e-maile i duplikaty (wygrywa pierwszy wiersz)', () => {
    const entries = avatarDirectoryEntries([
      profile('', 'x/avatar.jpg'),
      profile('jan@n2.pl', 'jan/avatar.jpg'),
      profile('JAN@n2.pl', 'jan/avatar.webp'),
    ]);
    expect(entries).toEqual([{ email: 'jan@n2.pl', path: 'jan/avatar.jpg' }]);
  });
});

describe('planAvatarFetch', () => {
  const known = new Map<string, ResolvedAvatar>([
    ['jan@n2.pl', { path: 'jan/avatar.jpg', url: 'signed-jan' }],
    ['ewa@n2.pl', { path: 'ewa/avatar.png', url: 'signed-ewa' }],
  ]);

  it('zachowuje wpisy o niezmienionej ścieżce i nic nie dopobiera', () => {
    const plan = planAvatarFetch(
      [
        { email: 'jan@n2.pl', path: 'jan/avatar.jpg' },
        { email: 'ewa@n2.pl', path: 'ewa/avatar.png' },
      ],
      known,
    );
    expect(plan.toResolve).toEqual([]);
    expect(plan.changed).toBe(false);
    expect(plan.kept.get('jan@n2.pl')?.url).toBe('signed-jan');
  });

  it('planuje podpis dla nowej osoby i dla zmienionej ścieżki', () => {
    const plan = planAvatarFetch(
      [
        { email: 'jan@n2.pl', path: 'jan/avatar.webp' },
        { email: 'ewa@n2.pl', path: 'ewa/avatar.png' },
        { email: 'nowy@n2.pl', path: 'nowy/avatar.jpg' },
      ],
      known,
    );
    expect(plan.toResolve).toEqual([
      { email: 'jan@n2.pl', path: 'jan/avatar.webp' },
      { email: 'nowy@n2.pl', path: 'nowy/avatar.jpg' },
    ]);
    // Jan ma nieaktualny URL — nie wolno go zachować do czasu nowego podpisu.
    expect(plan.kept.has('jan@n2.pl')).toBe(false);
    expect(plan.changed).toBe(true);
  });

  it('usuwa osoby, które zniknęły z katalogu (usunięte zdjęcie / brak widoczności)', () => {
    const plan = planAvatarFetch([{ email: 'ewa@n2.pl', path: 'ewa/avatar.png' }], known);
    expect(plan.kept.size).toBe(1);
    expect(plan.kept.has('jan@n2.pl')).toBe(false);
    expect(plan.changed).toBe(true);
  });

  it('pusty katalog czyści cały stan', () => {
    const plan = planAvatarFetch([], known);
    expect(plan.kept.size).toBe(0);
    expect(plan.toResolve).toEqual([]);
    expect(plan.changed).toBe(true);
  });
});

describe('mergeResolvedAvatars', () => {
  it('dokłada rozwiązane URL-e i nie rusza reszty', () => {
    const base = new Map<string, ResolvedAvatar>([
      ['ewa@n2.pl', { path: 'ewa/avatar.png', url: 'signed-ewa' }],
    ]);
    const next = mergeResolvedAvatars(base, [
      { email: 'jan@n2.pl', path: 'jan/avatar.jpg', url: 'signed-jan' },
    ]);
    expect(next.get('jan@n2.pl')).toEqual({ path: 'jan/avatar.jpg', url: 'signed-jan' });
    expect(next.get('ewa@n2.pl')?.url).toBe('signed-ewa');
    expect(base.size).toBe(1); // wejście nietknięte
  });

  it('nieudany podpis usuwa wpis (UI wraca do inicjałów)', () => {
    const base = new Map<string, ResolvedAvatar>([
      ['jan@n2.pl', { path: 'jan/avatar.jpg', url: 'stary' }],
    ]);
    const next = mergeResolvedAvatars(base, [
      { email: 'jan@n2.pl', path: 'jan/avatar.webp', url: null },
    ]);
    expect(next.has('jan@n2.pl')).toBe(false);
  });
});
