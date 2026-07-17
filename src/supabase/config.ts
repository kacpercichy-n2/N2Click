// Czysta walidacja konfiguracji Supabase — bez zależności od @supabase/supabase-js
// i bez odczytu `import.meta.env`. Funkcja przyjmuje wstrzyknięty rekord zmiennych
// środowiskowych, dzięki czemu jest w pełni testowalna w środowisku node.
//
// Moduł jest uśpioną infrastrukturą: aplikacja korzysta wyłącznie z localStorage
// (patrz src/store/storage.ts) i nie importuje jeszcze klienta Supabase.

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

const URL_VAR = 'VITE_SUPABASE_URL';
const KEY_VAR = 'VITE_SUPABASE_PUBLISHABLE_KEY';

/** Traktuje brak, pusty łańcuch i same białe znaki jako brak wartości. */
function readVar(env: Record<string, string | undefined>, name: string): string | undefined {
  const raw = env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Dekoduje segment base64url (np. payload JWT) bez zależności zewnętrznych. */
function decodeBase64Url(segment: string): string | undefined {
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    // atob istnieje zarówno w przeglądarce (lib DOM), jak i w Node 22.
    if (typeof atob === 'function') return atob(padded);
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Wykrywa klucze, które nigdy nie mogą trafić do kodu przeglądarki:
 * - nowy format klucza sekretnego Supabase (`sb_secret_...`),
 * - starszy klucz `service_role` w postaci JWT (payload zawiera role: service_role).
 */
function looksLikeSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length === 3) {
    const payload = decodeBase64Url(parts[1]);
    if (payload && /"role"\s*:\s*"service_role"/.test(payload)) return true;
  }
  return false;
}

/**
 * Waliduje rekord zmiennych środowiskowych i zwraca konfigurację Supabase.
 * Rzuca czytelnym błędem, gdy którakolwiek zmienna jest pusta lub gdy klucz
 * wygląda na sekretny/service_role.
 */
export function resolveSupabaseConfig(env: Record<string, string | undefined>): SupabaseConfig {
  const url = readVar(env, URL_VAR);
  const publishableKey = readVar(env, KEY_VAR);

  const missing: string[] = [];
  if (!url) missing.push(URL_VAR);
  if (!publishableKey) missing.push(KEY_VAR);

  if (missing.length > 0) {
    throw new Error(
      `Brak konfiguracji Supabase: ${missing.join(', ')}. ` +
        `Skopiuj .env.example do .env.local i uzupełnij wartości.`,
    );
  }

  if (looksLikeSecretKey(publishableKey!)) {
    throw new Error(
      `${KEY_VAR} wygląda na klucz sekretny/service_role. ` +
        `W kodzie przeglądarki używaj wyłącznie klucza publishable — ` +
        `klucze sekretne nigdy nie trafiają do frontendu.`,
    );
  }

  return { url: url!, publishableKey: publishableKey! };
}

/**
 * Czysty sprawdzian środowiska (bez tworzenia klienta): czy konfiguracja Supabase
 * jest obecna i poprawna. Czyta `import.meta.env` (jedyne miejsce poza warstwą
 * React) i nigdy nie rzuca. Używa go bramka zapisu lokalnego (persistGate) do
 * decyzji o wycofaniu — w trybie lokalnym zwraca `false`, więc stary zbuforowany
 * znacznik wycofania jest ignorowany.
 */
export function isSupabaseConfigured(): boolean {
  const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  // `import.meta.env` jest autorytatywne w przeglądarce (Vite). `process.env`
  // (przez globalThis, bez zależności od @types/node) służy jako zapas dla
  // środowiska node w testach (vi.stubEnv trafia tam).
  const processEnv = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  const env: Record<string, string | undefined> = { ...processEnv, ...metaEnv };
  try {
    resolveSupabaseConfig(env);
    return true;
  } catch {
    return false;
  }
}
