// Cienki klient przeglądarkowy zaufanego endpointu provisioningu konta
// (Edge Function `provision-account`). Buduje URL funkcji z konfiguracji
// Supabase, wysyła POST JSON z nagłówkiem Authorization: Bearer <access_token>
// bieżącej sesji i mapuje odpowiedź na polski komunikat sukcesu/błędu.
//
// GRANICA: realną autoryzację i tworzenie konta wykonuje serwer (service_role
// żyje wyłącznie w runtime Edge). Ten moduł NIGDY nie loguje ani nie zwraca
// credentiali, tokenów ani surowych odpowiedzi SDK — tylko polskie komunikaty.
//
// `fetch` i `env` są wstrzykiwane, dzięki czemu moduł jest testowalny w node.
import { resolveSupabaseConfig } from './config';
import { type ProvisionAccountRequest } from '../../supabase/functions/provision-account/contract';

export type ProvisionResult = { ok: true; message: string } | { ok: false; message: string };

export interface ProvisionDeps {
  /** Wstrzykiwany fetch (globalny w przeglądarce; atrapa w testach). */
  fetch: typeof fetch;
  /** access_token bieżącej sesji Supabase (nigdy nie logowany). */
  accessToken: string;
  /** Rekord zmiennych środowiskowych (w aplikacji: import.meta.env). */
  env: Record<string, string | undefined>;
}

/** Polskie komunikaty klienta — nigdy surowy tekst SDK ani wartości sekretów. */
export const PROVISION_CLIENT_MESSAGES = {
  // Hasło startowe generuje serwer (AUTH-02) i zwraca raz w odpowiedzi —
  // komunikat sukcesu skleja je funkcja niżej.
  successWithoutPassword:
    'Konto zostało utworzone. Użytkownik musi ustawić hasło przy pierwszym logowaniu.',
  network: 'Nie udało się połączyć z serwerem. Sprawdź połączenie i spróbuj ponownie.',
  generic: 'Nie udało się utworzyć konta. Spróbuj ponownie później.',
} as const;

/**
 * Komunikat sukcesu z jednorazowym hasłem startowym z odpowiedzi serwera.
 * To JEDYNE miejsce, w którym hasło pojawia się w UI — administrator przekazuje
 * je nowej osobie poza aplikacją; nie jest nigdzie zapisywane ani logowane.
 */
export function provisionSuccessMessage(initialPassword: string | null): string {
  if (initialPassword === null) return PROVISION_CLIENT_MESSAGES.successWithoutPassword;
  return `Konto zostało utworzone. Hasło startowe: ${initialPassword} — użytkownik musi je zmienić przy pierwszym logowaniu.`;
}

/** Wyciąga polski komunikat błędu z ciała odpowiedzi (`{ error: string }`). */
function extractServerMessage(body: unknown): string | null {
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;
    if (typeof record.error === 'string' && record.error.trim().length > 0) return record.error;
    if (typeof record.message === 'string' && record.message.trim().length > 0) return record.message;
  }
  return null;
}

/**
 * Wysyła żądanie provisioningu do Edge Function. Tryb hasła: serwer generuje
 * losowe hasło startowe per konto (AUTH-02) i zwraca je RAZ w odpowiedzi 201 —
 * komunikat sukcesu przekazuje je administratorowi, który komunikuje je nowej
 * osobie poza aplikacją. Sukces (2xx) → polski komunikat sukcesu; błąd →
 * polski komunikat serwera (serwer zwraca polskie komunikaty dla
 * 400/401/403/409/5xx) lub ogólny; błąd sieci → osobny komunikat. Nigdy nie
 * zwraca surowej odpowiedzi SDK.
 */
export async function provisionAccount(
  request: ProvisionAccountRequest,
  deps: ProvisionDeps,
): Promise<ProvisionResult> {
  const { url } = resolveSupabaseConfig(deps.env);
  const endpoint = `${url.replace(/\/+$/, '')}/functions/v1/provision-account`;

  let response: Response;
  try {
    response = await deps.fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deps.accessToken}`,
      },
      body: JSON.stringify(request),
    });
  } catch {
    // Świadomie nie logujemy błędu (mógłby zawierać wrażliwe szczegóły).
    return { ok: false, message: PROVISION_CLIENT_MESSAGES.network };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.ok) {
    const initialPassword =
      typeof body === 'object' &&
      body !== null &&
      typeof (body as Record<string, unknown>).initialPassword === 'string'
        ? ((body as Record<string, unknown>).initialPassword as string)
        : null;
    return { ok: true, message: provisionSuccessMessage(initialPassword) };
  }

  return { ok: false, message: extractServerMessage(body) ?? PROVISION_CLIENT_MESSAGES.generic };
}
