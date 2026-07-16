// Testy cienkiego klienta provisioningu: poprawny URL i nagłówki, obsługa
// sukcesu, 409/403 (polskie komunikaty serwera) oraz błędu sieci. Wstrzykujemy
// fetch i env, więc test jest deterministyczny w node (bez SDK, bez jsdom).
import { describe, expect, it, vi } from 'vitest';
import {
  PROVISION_CLIENT_MESSAGES,
  provisionAccount,
  type ProvisionDeps,
} from './provisioning';
import { PROVISIONING_MESSAGES } from '../../supabase/functions/provision-account/contract';
import type { ProvisionAccountRequest } from '../../supabase/functions/provision-account/contract';

const ENV = {
  VITE_SUPABASE_URL: 'https://proj.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123',
};

const TOKEN = 'access-token-xyz';

const REQUEST: ProvisionAccountRequest = {
  firstName: 'Jan',
  lastName: 'Nowak',
  email: 'jan.nowak@firma.pl',
  roleTitle: 'Specjalista',
  departmentId: null,
  managerProfileId: null,
  accessRole: 'worker',
  initialPassword: { mode: 'invite' },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deps(fetchImpl: typeof fetch): ProvisionDeps {
  return { fetch: fetchImpl, accessToken: TOKEN, env: ENV };
}

describe('provisionAccount — żądanie', () => {
  it('POST-uje na poprawny URL funkcji z nagłówkami autoryzacji i JSON', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { userId: 'u1' }));
    await provisionAccount(REQUEST, deps(fetchMock as unknown as typeof fetch));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/functions/v1/provision-account');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(REQUEST);
  });

  it('nie dubluje ukośnika, gdy URL ma końcowy „/"', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { userId: 'u1' }));
    await provisionAccount(REQUEST, {
      fetch: fetchMock as unknown as typeof fetch,
      accessToken: TOKEN,
      env: { ...ENV, VITE_SUPABASE_URL: 'https://proj.supabase.co/' },
    });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://proj.supabase.co/functions/v1/provision-account');
  });
});

describe('provisionAccount — odpowiedzi', () => {
  it('sukces (201) → polski komunikat sukcesu', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { userId: 'u1', email: 'jan@firma.pl' }));
    const result = await provisionAccount(REQUEST, deps(fetchMock as unknown as typeof fetch));
    expect(result).toEqual({ ok: true, message: PROVISION_CLIENT_MESSAGES.success });
  });

  it('409 → polski komunikat serwera „konto już istnieje"', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(409, { error: PROVISIONING_MESSAGES.emailAlreadyExists }),
    );
    const result = await provisionAccount(REQUEST, deps(fetchMock as unknown as typeof fetch));
    expect(result).toEqual({ ok: false, message: PROVISIONING_MESSAGES.emailAlreadyExists });
  });

  it('403 → polski komunikat serwera „brak uprawnień administratora"', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(403, { error: PROVISIONING_MESSAGES.notAdministrator }),
    );
    const result = await provisionAccount(REQUEST, deps(fetchMock as unknown as typeof fetch));
    expect(result).toEqual({ ok: false, message: PROVISIONING_MESSAGES.notAdministrator });
  });

  it('błąd bez czytelnego ciała → ogólny polski komunikat', async () => {
    const fetchMock = vi.fn(
      async () => new Response('nie-json', { status: 500, headers: { 'Content-Type': 'text/plain' } }),
    );
    const result = await provisionAccount(REQUEST, deps(fetchMock as unknown as typeof fetch));
    expect(result).toEqual({ ok: false, message: PROVISION_CLIENT_MESSAGES.generic });
  });

  it('błąd sieci (fetch rzuca) → osobny polski komunikat, bez wycieku szczegółów', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED super-tajne-detale');
    });
    const result = await provisionAccount(REQUEST, deps(fetchMock as unknown as typeof fetch));
    expect(result).toEqual({ ok: false, message: PROVISION_CLIENT_MESSAGES.network });
    if (!result.ok) expect(result.message).not.toContain('ECONNREFUSED');
  });

  it('nie ujawnia tokenu ani credentiali w komunikatach', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(500, { error: PROVISIONING_MESSAGES.serverError }));
    const result = await provisionAccount(REQUEST, deps(fetchMock as unknown as typeof fetch));
    expect(result.message).not.toContain(TOKEN);
  });
});
