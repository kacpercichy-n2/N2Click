// Leniwie inicjowany singleton klienta Supabase.
//
// UWAGA: to jest uśpiona infrastruktura. Aplikacja nadal działa wyłącznie na
// localStorage (src/store/storage.ts) i nic jej jeszcze nie importuje. Walidacja
// `import.meta.env` celowo NIE wykonuje się przy imporcie modułu — dopiero przy
// pierwszym wywołaniu getSupabaseClient(), więc brak zmiennych VITE_SUPABASE_*
// nie psuje działania aplikacji.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
    client = createClient(url, publishableKey);
    return client;
  } catch (error) {
    if (import.meta.env.DEV) {
      // Dodatkowy szczegół tylko w trybie deweloperskim.
      console.error('[supabase] Nie udało się zainicjować klienta:', error);
    }
    throw error;
  }
}
