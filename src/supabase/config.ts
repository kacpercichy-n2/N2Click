// Czysta walidacja konfiguracji Supabase — bez zależności od @supabase/supabase-js
// i bez odczytu `import.meta.env`. Funkcja przyjmuje wstrzyknięty rekord zmiennych
// środowiskowych, dzięki czemu jest w pełni testowalna w środowisku node.
//
// Werdykt tej walidacji decyduje o trybie uwierzytelniania (src/auth/mode.ts):
// błąd tutaj oznacza w dev tryb lokalny, a w buildzie produkcyjnym twardą
// blokadę aplikacji (`misconfigured`) — dlatego odrzucamy też wartości, które
// przeszłyby ten test, ale wywróciłyby `createClient` dopiero w runtime
// (zły format URL, placeholdery z .env.example, nieznany format klucza).

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

// Placeholdery z .env.example — skopiowane bez uzupełnienia to nadal brak
// konfiguracji, nie konfiguracja.
const PLACEHOLDER_URL = 'https://twoj-projekt.supabase.co';
const PLACEHOLDER_KEY = 'sb_publishable_twoj_klucz';

/** Adres musi być parsowalnym URL-em http(s) — inne wartości wywracają `createClient`. */
function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Znane formaty klucza klienckiego: `sb_publishable_...` albo starszy JWT `anon`. */
function looksLikePublishableKey(key: string): boolean {
  if (key.startsWith('sb_publishable_')) {
    return key.length > 'sb_publishable_'.length;
  }
  // Starszy kliencki klucz to JWT roli `anon`: trzy niepuste segmenty, payload
  // musi być poprawnym JSON-em z dokładnie `role: "anon"` (service_role odpada
  // na wcześniejszej straży, a żadna inna rola nie jest kluczem klienckim).
  const parts = key.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return false;
  const payload = decodeBase64Url(parts[1]);
  if (payload === undefined) return false;
  try {
    const parsed = JSON.parse(payload) as { role?: unknown };
    return parsed.role === 'anon';
  } catch {
    return false;
  }
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

  if (url === PLACEHOLDER_URL || !isValidHttpUrl(url!)) {
    throw new Error(
      `${URL_VAR} nie jest poprawnym adresem http(s) projektu Supabase ` +
        `(otrzymano wartość niepoprawną lub placeholder z .env.example).`,
    );
  }

  if (looksLikeSecretKey(publishableKey!)) {
    throw new Error(
      `${KEY_VAR} wygląda na klucz sekretny/service_role. ` +
        `W kodzie przeglądarki używaj wyłącznie klucza publishable — ` +
        `klucze sekretne nigdy nie trafiają do frontendu.`,
    );
  }

  if (publishableKey === PLACEHOLDER_KEY || !looksLikePublishableKey(publishableKey!)) {
    throw new Error(
      `${KEY_VAR} nie wygląda na klucz kliencki Supabase ` +
        `(oczekiwano sb_publishable_... albo starszego klucza anon w formacie JWT).`,
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
