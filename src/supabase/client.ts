// Leniwie inicjowany singleton klienta Supabase.
//
// UWAGA: to jest uśpiona infrastruktura. Aplikacja nadal działa wyłącznie na
// localStorage (src/store/storage.ts) i nic jej jeszcze nie importuje. Walidacja
// `import.meta.env` celowo NIE wykonuje się przy imporcie modułu — dopiero przy
// pierwszym wywołaniu getSupabaseClient(), więc brak zmiennych VITE_SUPABASE_*
// nie psuje działania aplikacji.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PostgrestClient } from '@supabase/postgrest-js';
import { resolveSupabaseConfig } from './config';

let client: SupabaseClient | undefined;

/**
 * Zwraca współdzieloną instancję klienta Supabase, tworząc ją przy pierwszym
 * wywołaniu. Waliduje `import.meta.env` w miejscu użycia — brak konfiguracji
 * kończy się czytelnym błędem w każdym trybie.
 */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  try {
    const { url, publishableKey } = resolveSupabaseConfig(
      import.meta.env as unknown as Record<string, string | undefined>,
    );
    // Dane N2Click żyją w schemacie `n2click` (schema-per-app); `profiles` i
    // `companies` są widokami-mostkami do `core` w tym samym schemacie.
    // Rzutowanie: repo nie ma wygenerowanych typów bazy (wszystko `any`), a
    // parametr schematu w typie `SupabaseClient` domyślnie zakłada `public` —
    // zmiana samego parametru wymusiłaby przetypowanie każdego konsumenta.
    client = createClient(url, publishableKey, {
      db: { schema: 'n2click' },
    }) as unknown as SupabaseClient;
    return client;
  } catch (error) {
    if (import.meta.env.DEV) {
      // Dodatkowy szczegół tylko w trybie deweloperskim.
      console.error('[supabase] Nie udało się zainicjować klienta:', error);
    }
    throw error;
  }
}

/**
 * Klient z ZAMROŻONYM tokenem dostępu — dla zapisów lustra chmury
 * (CloudSyncProvider), gdzie wsad operacji musi wyjść w całości tożsamością,
 * dla której został zakolejkowany. Singleton wyżej czyta bieżącą sesję Auth
 * PRZY KAŻDYM żądaniu, więc podmiana konta w trakcie wsadu (TOCTOU między
 * sondą epoki a odczytem tokenu wewnątrz SDK) wysłałaby operacje konta A
 * tokenem konta B.
 *
 * CELOWO goły `PostgrestClient` (bezpośrednia zależność przechodnia
 * supabase-js, wersjonowana razem z nim), nie `createClient`: pełny klient
 * konstruuje GoTrue, który wiesza słuchacza `visibilitychange` na `window` —
 * porzucona instancja nigdy nie jest zwalniana, więc rotacja tokenu i
 * wylogowanie wyciekałyby klienty Auth. PostgREST z samymi nagłówkami nie ma
 * żadnych globalnych zaczepów; adaptery lustra używają wyłącznie
 * `.from()`/`.schema()`, więc rzutowanie jest strukturalnie bezpieczne (ten
 * sam wzorzec co `client.schema(...)` w plannerData). Wygaśnięcie pinu kończy
 * się zwykłym błędem przejściowym i ponowieniem ze świeżym tokenem.
 */
export function createPinnedRestClient(accessToken: string): SupabaseClient {
  const { url, publishableKey } = resolveSupabaseConfig(
    import.meta.env as unknown as Record<string, string | undefined>,
  );
  const rest = new PostgrestClient(`${url.replace(/\/+$/, '')}/rest/v1`, {
    schema: 'n2click',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return rest as unknown as SupabaseClient;
}
