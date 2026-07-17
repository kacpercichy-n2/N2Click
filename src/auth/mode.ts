// Wykrywanie trybu uwierzytelniania. Czyste — przyjmuje wstrzyknięty rekord
// zmiennych środowiskowych i NIE czyta `import.meta.env` (to robi warstwa
// React). Konfiguracja obecna i poprawna => tryb Supabase; brak lub niepoprawna
// => tryb lokalny (bezpieczny, automatyczny fallback dla dev). Nigdy nie rzuca.

import { resolveSupabaseConfig } from '../supabase/config';

export type AuthMode = 'local' | 'supabase';

export function detectAuthMode(env: Record<string, string | undefined>): AuthMode {
  try {
    resolveSupabaseConfig(env);
    return 'supabase';
  } catch {
    return 'local';
  }
}
