// Testy czystej walidacji konfiguracji Supabase (resolveSupabaseConfig).
// Wstrzykujemy rekordy env — bez importu @supabase/supabase-js i bez
// polegania na import.meta.env. Środowisko node (patrz vitest.config.ts).
import { describe, expect, it } from 'vitest';
import { resolveSupabaseConfig } from './config';

const URL = 'https://example.supabase.co';
const PUBLISHABLE = 'sb_publishable_abc123';

describe('resolveSupabaseConfig', () => {
  it('zwraca konfigurację, gdy obie zmienne są obecne', () => {
    const config = resolveSupabaseConfig({
      VITE_SUPABASE_URL: URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    });
    expect(config).toEqual({ url: URL, publishableKey: PUBLISHABLE });
  });

  it('przycina otaczające białe znaki z prawidłowych wartości', () => {
    const config = resolveSupabaseConfig({
      VITE_SUPABASE_URL: `  ${URL}  `,
      VITE_SUPABASE_PUBLISHABLE_KEY: `\t${PUBLISHABLE}\n`,
    });
    expect(config).toEqual({ url: URL, publishableKey: PUBLISHABLE });
  });

  it('ignoruje niezadeklarowane zmienne środowiskowe', () => {
    const config = resolveSupabaseConfig({
      VITE_SUPABASE_URL: URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      VITE_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_should_be_ignored',
      SUPABASE_URL: 'https://other.supabase.co',
    });
    expect(config).toEqual({ url: URL, publishableKey: PUBLISHABLE });
  });

  describe('brakujące / puste / same białe znaki', () => {
    const blanks: Array<[string, string | undefined]> = [
      ['brak', undefined],
      ['pusty', ''],
      ['same spacje', '   '],
      ['same taby/nowe linie', '\t\n'],
    ];

    for (const [label, value] of blanks) {
      it(`rzuca z nazwą URL, gdy VITE_SUPABASE_URL jest ${label}`, () => {
        expect(() =>
          resolveSupabaseConfig({
            VITE_SUPABASE_URL: value,
            VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
          }),
        ).toThrow(/VITE_SUPABASE_URL/);
      });

      it(`rzuca z nazwą klucza, gdy VITE_SUPABASE_PUBLISHABLE_KEY jest ${label}`, () => {
        expect(() =>
          resolveSupabaseConfig({
            VITE_SUPABASE_URL: URL,
            VITE_SUPABASE_PUBLISHABLE_KEY: value,
          }),
        ).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/);
      });
    }

    it('wskazuje na .env.local w komunikacie błędu', () => {
      expect(() => resolveSupabaseConfig({})).toThrow(/\.env\.local/);
    });

    it('wymienia obie nazwy zmiennych, gdy obu brakuje', () => {
      let message = '';
      try {
        resolveSupabaseConfig({});
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('VITE_SUPABASE_URL');
      expect(message).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
    });
  });

  describe('odrzucanie kluczy sekretnych', () => {
    it('odrzuca klucz z prefiksem sb_secret_', () => {
      expect(() =>
        resolveSupabaseConfig({
          VITE_SUPABASE_URL: URL,
          VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_deadbeefdeadbeef',
        }),
      ).toThrow(/sekretny|service_role/i);
    });

    it('odrzuca starszy klucz JWT service_role', () => {
      // Nagłówek + payload {"role":"service_role","iss":"supabase"} + podpis.
      const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = base64url(JSON.stringify({ role: 'service_role', iss: 'supabase' }));
      const jwt = `${header}.${payload}.signature`;
      expect(() =>
        resolveSupabaseConfig({
          VITE_SUPABASE_URL: URL,
          VITE_SUPABASE_PUBLISHABLE_KEY: jwt,
        }),
      ).toThrow(/sekretny|service_role/i);
    });

    it('odrzuca URL niebędący poprawnym adresem http(s)', () => {
      for (const bad of ['not-a-url', 'ftp://project.supabase.co', 'project.supabase.co']) {
        expect(() =>
          resolveSupabaseConfig({
            VITE_SUPABASE_URL: bad,
            VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
          }),
        ).toThrow(/VITE_SUPABASE_URL/);
      }
    });

    it('odrzuca placeholdery z .env.example', () => {
      expect(() =>
        resolveSupabaseConfig({
          VITE_SUPABASE_URL: 'https://twoj-projekt.supabase.co',
          VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
        }),
      ).toThrow(/VITE_SUPABASE_URL/);
      expect(() =>
        resolveSupabaseConfig({
          VITE_SUPABASE_URL: URL,
          VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_twoj_klucz',
        }),
      ).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/);
    });

    it('odrzuca klucz w nieznanym formacie (ani sb_publishable_, ani JWT)', () => {
      for (const bad of [
        'dowolny-string',
        'sb_publishable_', // pusty sufiks
        'not.a.jwt', // trzy segmenty, ale payload nie jest base64url z JSON-em
        'a..c', // pusty środkowy segment
      ]) {
        expect(() =>
          resolveSupabaseConfig({
            VITE_SUPABASE_URL: URL,
            VITE_SUPABASE_PUBLISHABLE_KEY: bad,
          }),
        ).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/);
      }
    });

    it('akceptuje starszy klucz JWT anon', () => {
      const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = base64url(JSON.stringify({ role: 'anon', iss: 'supabase' }));
      const jwt = `${header}.${payload}.signature`;
      const config = resolveSupabaseConfig({
        VITE_SUPABASE_URL: URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: jwt,
      });
      expect(config.publishableKey).toBe(jwt);
    });

    it('odrzuca JWT z rolą inną niż anon', () => {
      const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      for (const role of ['authenticated', 'postgres', '']) {
        const payload = base64url(JSON.stringify({ role, iss: 'supabase' }));
        expect(() =>
          resolveSupabaseConfig({
            VITE_SUPABASE_URL: URL,
            VITE_SUPABASE_PUBLISHABLE_KEY: `${header}.${payload}.signature`,
          }),
        ).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/);
      }
    });

    it('odrzuca JWT, którego payload nie jest JSON-em (mimo substringu "role":)', () => {
      const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = base64url('garbage "role": "anon" garbage');
      expect(() =>
        resolveSupabaseConfig({
          VITE_SUPABASE_URL: URL,
          VITE_SUPABASE_PUBLISHABLE_KEY: `${header}.${payload}.signature`,
        }),
      ).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/);
    });

    it('odrzuca JWT bez pola role w payloadzie', () => {
      const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = base64url(JSON.stringify({ iss: 'supabase' }));
      expect(() =>
        resolveSupabaseConfig({
          VITE_SUPABASE_URL: URL,
          VITE_SUPABASE_PUBLISHABLE_KEY: `${header}.${payload}.signature`,
        }),
      ).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/);
    });
  });
});

function base64url(input: string): string {
  // btoa istnieje w Node 22 (środowisko testowe) i w przeglądarce.
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
