// Wykrywanie trybu uwierzytelniania. Czyste — przyjmuje wstrzyknięty rekord
// zmiennych środowiskowych i NIE czyta `import.meta.env` (to robi warstwa
// React). Konfiguracja obecna i poprawna => tryb Supabase. Brak lub niepoprawna:
// w dev bezpieczny, automatyczny fallback do trybu lokalnego; w buildzie
// produkcyjnym fail-closed => `misconfigured` (SessionProvider blokuje całą
// aplikację ekranem błędu konfiguracji zamiast otwierać lokalny CRM
// jednoklikowym wyborem osoby). Nigdy nie rzuca.

import { resolveSupabaseConfig } from '../supabase/config';

export type AuthMode = 'local' | 'supabase' | 'misconfigured';

export function detectAuthMode(
  env: Record<string, string | undefined>,
  opts: { prod?: boolean } = {},
): AuthMode {
  // Jawny opt-in trybu lokalnego (`VITE_AUTH_MODE=local`) — świadoma decyzja
  // operatora, nie fallback. W dev wystarcza sama zmienna; w buildzie
  // produkcyjnym wymagane jest DODATKOWO jawne `vite build --mode local-qa`
  // (env.MODE) — tak buduje wizualny QA i release matrix
  // (scripts/run-browser-regression.mjs). Deploy hostowany buduje w domyślnym
  // MODE=production, więc przypadkowa zmienna w środowisku deployu nigdy nie
  // otworzy lokalnego CRM.
  const explicitLocal = (env.VITE_AUTH_MODE ?? '').trim() === 'local';
  if (explicitLocal && (!opts.prod || (env.MODE ?? '').trim() === 'local-qa')) {
    return 'local';
  }
  try {
    resolveSupabaseConfig(env);
    return 'supabase';
  } catch {
    return opts.prod ? 'misconfigured' : 'local';
  }
}
