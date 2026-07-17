import { describe, expect, it, vi } from 'vitest';
import {
  AUTH_MESSAGES,
  createAuthController,
  mapAuthError,
  type AuthErrorLike,
  type AuthResult,
  type AuthSession,
  type MinimalAuthClient,
} from './session';
import {
  associateProfile,
  findPersonByEmail,
  normalizeEmail,
  personDraftFromCloudProfile,
} from './profile';
import { detectAuthMode } from './mode';
import { isValidPersonDraft } from '../store/commandValidation';
import type { Person } from '../types';

// ---- Fake auth client -------------------------------------------------------

interface FakeOptions {
  getSession?: () => Promise<AuthResult<{ session: AuthSession | null }>>;
  signIn?: (c: { email: string; password: string }) => Promise<AuthResult<{ session: AuthSession | null }>>;
}

function makeSession(email = 'user@example.com'): AuthSession {
  return { user: { email } };
}

function ok(session: AuthSession | null): AuthResult<{ session: AuthSession | null }> {
  return { data: { session }, error: null };
}

function fail(error: AuthErrorLike): AuthResult<{ session: AuthSession | null }> {
  return { data: { session: null }, error };
}

function makeFakeClient(options: FakeOptions = {}) {
  let cb: ((event: string, session: AuthSession | null) => void) | null = null;
  const unsubscribe = vi.fn();
  const signOut = vi.fn(async () => ({ error: null }));
  const client: MinimalAuthClient = {
    getSession: options.getSession ?? (async () => ok(null)),
    signInWithPassword: options.signIn ?? (async () => ok(makeSession())),
    signOut,
    onAuthStateChange: (callback) => {
      cb = callback;
      return { data: { subscription: { unsubscribe } } };
    },
  };
  return {
    client,
    unsubscribe,
    signOut,
    emit: (event: string, session: AuthSession | null) => cb?.(event, session),
  };
}

// ---- Session state machine --------------------------------------------------

describe('createAuthController', () => {
  it('restore with an existing session → signedIn', async () => {
    const { client } = makeFakeClient({ getSession: async () => ok(makeSession('a@b.com')) });
    const controller = createAuthController(client);
    await controller.initialize();
    const state = controller.getState();
    expect(state.status).toBe('signedIn');
    expect(state.session?.user.email).toBe('a@b.com');
  });

  it('restore with no session → signedOut', async () => {
    const { client } = makeFakeClient({ getSession: async () => ok(null) });
    const controller = createAuthController(client);
    await controller.initialize();
    expect(controller.getState().status).toBe('signedOut');
  });

  it('getSession rejection → fail-closed signedOut', async () => {
    const { client } = makeFakeClient({
      getSession: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const controller = createAuthController(client);
    await controller.initialize();
    expect(controller.getState().status).toBe('signedOut');
    expect(controller.getState().session).toBeNull();
  });

  it('getSession returning an error → signedOut', async () => {
    const { client } = makeFakeClient({ getSession: async () => fail({ message: 'boom' }) });
    const controller = createAuthController(client);
    await controller.initialize();
    expect(controller.getState().status).toBe('signedOut');
  });

  it('signIn success → signedIn', async () => {
    const { client } = makeFakeClient({ signIn: async () => ok(makeSession('x@y.com')) });
    const controller = createAuthController(client);
    await controller.initialize();
    await controller.signIn('x@y.com', 'secret');
    const state = controller.getState();
    expect(state.status).toBe('signedIn');
    expect(state.busy).toBe(false);
    expect(state.session?.user.email).toBe('x@y.com');
  });

  it('signIn with invalid credentials → Polish error, stays signedOut', async () => {
    const { client } = makeFakeClient({
      signIn: async () => fail({ code: 'invalid_credentials', message: 'Invalid login credentials' }),
    });
    const controller = createAuthController(client);
    await controller.initialize();
    await controller.signIn('x@y.com', 'wrong');
    const state = controller.getState();
    expect(state.status).toBe('signedOut');
    expect(state.error).toBe(AUTH_MESSAGES.invalidCredentials);
    expect(state.busy).toBe(false);
  });

  it('signIn network failure (thrown) → generic Polish connection error', async () => {
    const { client } = makeFakeClient({
      signIn: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const controller = createAuthController(client);
    await controller.initialize();
    await controller.signIn('x@y.com', 'secret');
    const state = controller.getState();
    expect(state.status).toBe('signedOut');
    expect(state.error).toBe(AUTH_MESSAGES.connection);
  });

  it('signIn sets busy=true while in flight, cleared afterward', async () => {
    let resolveSignIn: (r: AuthResult<{ session: AuthSession | null }>) => void = () => {};
    const { client } = makeFakeClient({
      signIn: () =>
        new Promise<AuthResult<{ session: AuthSession | null }>>((resolve) => {
          resolveSignIn = resolve;
        }),
    });
    const controller = createAuthController(client);
    await controller.initialize();
    const states: boolean[] = [];
    controller.subscribe((s) => states.push(s.busy));
    const pending = controller.signIn('x@y.com', 'secret');
    expect(controller.getState().busy).toBe(true);
    resolveSignIn(ok(makeSession()));
    await pending;
    expect(controller.getState().busy).toBe(false);
    expect(states).toContain(true);
  });

  it('signOut → signedOut', async () => {
    const { client } = makeFakeClient({ getSession: async () => ok(makeSession()) });
    const controller = createAuthController(client);
    await controller.initialize();
    expect(controller.getState().status).toBe('signedIn');
    await controller.signOut();
    expect(controller.getState().status).toBe('signedOut');
  });

  it('onAuthStateChange SIGNED_OUT event → signedOut', async () => {
    const { client, emit } = makeFakeClient({ getSession: async () => ok(makeSession()) });
    const controller = createAuthController(client);
    await controller.initialize();
    expect(controller.getState().status).toBe('signedIn');
    emit('SIGNED_OUT', null);
    expect(controller.getState().status).toBe('signedOut');
  });

  it('onAuthStateChange SIGNED_IN event → signedIn', async () => {
    const { client, emit } = makeFakeClient({ getSession: async () => ok(null) });
    const controller = createAuthController(client);
    await controller.initialize();
    expect(controller.getState().status).toBe('signedOut');
    emit('SIGNED_IN', makeSession('late@b.com'));
    expect(controller.getState().status).toBe('signedIn');
    expect(controller.getState().session?.user.email).toBe('late@b.com');
  });

  it('dispose unsubscribes and stops further state changes', async () => {
    const { client, unsubscribe, emit } = makeFakeClient({ getSession: async () => ok(makeSession()) });
    const controller = createAuthController(client);
    await controller.initialize();
    controller.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    emit('SIGNED_OUT', null); // no live listener, must not throw
    expect(controller.getState().status).toBe('signedIn'); // frozen at dispose
  });

  it('subscribe immediately pushes current state and unsubscribe stops updates', async () => {
    const { client } = makeFakeClient({ getSession: async () => ok(makeSession()) });
    const controller = createAuthController(client);
    const seen: string[] = [];
    const off = controller.subscribe((s) => seen.push(s.status));
    expect(seen[0]).toBe('restoring');
    await controller.initialize();
    expect(seen).toContain('signedIn');
    off();
    await controller.signOut();
    expect(seen).not.toContain('signedOut');
  });
});

// ---- Error mapping ----------------------------------------------------------

describe('mapAuthError', () => {
  it('maps invalid credentials by code and by message', () => {
    expect(mapAuthError({ code: 'invalid_credentials' })).toBe(AUTH_MESSAGES.invalidCredentials);
    expect(mapAuthError({ message: 'Invalid login credentials' })).toBe(
      AUTH_MESSAGES.invalidCredentials,
    );
  });

  it('maps unconfirmed email', () => {
    expect(mapAuthError({ code: 'email_not_confirmed' })).toBe(AUTH_MESSAGES.emailNotConfirmed);
    expect(mapAuthError({ message: 'Email not confirmed' })).toBe(AUTH_MESSAGES.emailNotConfirmed);
  });

  it('maps network failures', () => {
    expect(mapAuthError({ message: 'Failed to fetch' })).toBe(AUTH_MESSAGES.connection);
  });

  it('falls back to a generic Polish message', () => {
    expect(mapAuthError({ message: 'something weird' })).toBe(AUTH_MESSAGES.unexpected);
    expect(mapAuthError(null)).toBe(AUTH_MESSAGES.unexpected);
  });
});

// ---- Profile association ----------------------------------------------------

function person(overrides: Partial<Person>): Person {
  return {
    id: 'p1',
    firstName: 'A',
    lastName: '',
    name: 'A',
    email: '',
    phone: '',
    role: '',
    departmentId: '',
    avatar: '',
    capacity: 8,
    accessRole: 'pracownik',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
    ...overrides,
  };
}

describe('findPersonByEmail', () => {
  const people = [
    person({ id: 'p1', email: 'Anna@Example.com' }),
    person({ id: 'p2', email: '' }),
    person({ id: 'p3', email: '  bob@n2.pl  ' }),
  ];

  it('matches case-insensitively and trimming both sides', () => {
    expect(findPersonByEmail(people, 'anna@example.com')?.id).toBe('p1');
    expect(findPersonByEmail(people, '  ANNA@EXAMPLE.COM ')?.id).toBe('p1');
    expect(findPersonByEmail(people, 'bob@n2.pl')?.id).toBe('p3');
  });

  it('never matches an empty person email or an empty query', () => {
    expect(findPersonByEmail(people, '')).toBeUndefined();
    expect(findPersonByEmail(people, '   ')).toBeUndefined();
    expect(findPersonByEmail(people, null)).toBeUndefined();
    expect(findPersonByEmail(people, undefined)).toBeUndefined();
    // p2 has an empty email; a query that trims to empty must not reach it.
  });

  it('returns undefined when nobody matches', () => {
    expect(findPersonByEmail(people, 'nobody@else.com')).toBeUndefined();
  });
});

describe('associateProfile', () => {
  const people = [person({ id: 'p1', email: 'a@b.com' })];

  it('returns matched with the person on a hit', () => {
    const result = associateProfile(people, 'A@B.COM');
    expect(result).toEqual({ kind: 'matched', person: people[0] });
  });

  it('returns blocked with the trimmed email on a miss', () => {
    expect(associateProfile(people, '  gone@x.com ')).toEqual({
      kind: 'blocked',
      email: 'gone@x.com',
    });
    expect(associateProfile([], 'nobody@x.com')).toEqual({
      kind: 'blocked',
      email: 'nobody@x.com',
    });
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases; empty-ish becomes empty string', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
    expect(normalizeEmail('')).toBe('');
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
  });
});

// ---- Mode detection ---------------------------------------------------------

describe('detectAuthMode', () => {
  it('returns supabase when config is present and valid', () => {
    expect(
      detectAuthMode({
        VITE_SUPABASE_URL: 'https://project.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123',
      }),
    ).toBe('supabase');
  });

  it('falls back to local when config is missing', () => {
    expect(detectAuthMode({})).toBe('local');
  });

  it('falls back to local when the key looks secret (config throws)', () => {
    expect(
      detectAuthMode({
        VITE_SUPABASE_URL: 'https://project.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_danger',
      }),
    ).toBe('local');
  });
});

describe('personDraftFromCloudProfile', () => {
  const toAccessRole = (role: 'administrator' | 'manager' | 'worker') =>
    role === 'administrator' ? ('administrator' as const) : role === 'manager' ? ('pm' as const) : ('pracownik' as const);

  it('mapuje tożsamość profilu chmury na poprawny draft (imię, rola, stanowisko)', () => {
    const draft = personDraftFromCloudProfile(
      { firstName: 'Kacper', lastName: 'Cichy', roleTitle: 'Menadżer Design i IT', cloudRole: 'administrator' },
      'kacper.cichy@n2media.agency',
      toAccessRole,
    );
    expect(draft).toMatchObject({
      firstName: 'Kacper',
      lastName: 'Cichy',
      email: 'kacper.cichy@n2media.agency',
      role: 'Menadżer Design i IT',
      accessRole: 'administrator',
      departmentId: '',
      supervisorId: '',
    });
    expect(isValidPersonDraft(draft)).toBe(true);
  });

  it('puste imię spada na część lokalną e-maila, a potem na „Użytkownik" — draft zawsze ważny', () => {
    const fromEmail = personDraftFromCloudProfile(
      { firstName: '  ', lastName: '', roleTitle: '', cloudRole: 'worker' },
      'zuzanna.maruda@n2media.agency',
      toAccessRole,
    );
    expect(fromEmail.firstName).toBe('zuzanna.maruda');
    expect(fromEmail.accessRole).toBe('pracownik');
    expect(isValidPersonDraft(fromEmail)).toBe(true);

    const fallback = personDraftFromCloudProfile(
      { firstName: '', lastName: '', roleTitle: '', cloudRole: 'manager' },
      '',
      toAccessRole,
    );
    expect(fallback.firstName).toBe('Użytkownik');
    expect(fallback.accessRole).toBe('pm');
    expect(isValidPersonDraft(fallback)).toBe(true);
  });
});
