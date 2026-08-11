// Edge Function `provision-account` — zaufana granica serwerowa zakładania kont.
//
// Ten plik działa WYŁĄCZNIE w runtime Deno (Supabase Edge) i NIE jest
// typowany przez tsc repo (`tsconfig.json` obejmuje tylko `src`). Używa
// `Deno.serve`, importuje supabase-js przez `npm:` i konsumuje czysty kontrakt
// relatywnie, z jawnym rozszerzeniem `.ts`.
//
// GRANICA ZAUFANIA: klucz service_role żyje wyłącznie w runtime Edge (auto-
// wstrzykiwany), NIGDY w przeglądarce ani w repo. Funkcja wpuszcza tylko
// uwierzytelnionego administratora (weryfikacja profilu po stronie serwera).
//
// Nigdy nie logujemy ani nie zwracamy treści ciała, hasła ani kluczy.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  PROVISIONING_MESSAGES,
  authorizeProvisioning,
  parseProvisionRequest,
  validateManagerRelationship,
} from './contract.ts';

// `Deno` jest dostępny w runtime Edge; deklaracja ucisza edytory bez typów Deno.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

/** Buduje nagłówki CORS. Origin dodajemy tylko, gdy operator ustawił env. */
function corsHeaders(): Record<string, string> {
  const origin = Deno.env.get('PROVISION_ALLOWED_ORIGIN');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, message: string): Response {
  return json(status, { error: message });
}

/**
 * Losowe hasło tymczasowe (AUTH-02): 16 znaków z alfabetu bez mylących glifów
 * (0/O, 1/l/I), ~94 bity entropii z `crypto.getRandomValues` — daleko ponad
 * MIN_PASSWORD_LENGTH. Drobny modulo-bias (256 % 57) jest bez znaczenia dla
 * hasła jednorazowego wymuszająco zmienianego przy pierwszym logowaniu.
 */
function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

/** Mapuje błędy SDK „e-mail już istnieje” na 409 (bez surowego tekstu SDK). */
function isAlreadyRegistered(message: string | undefined): boolean {
  const m = (message ?? '').toLowerCase();
  return (
    m.includes('already registered') ||
    m.includes('already been registered') ||
    m.includes('already exists') ||
    m.includes('user already')
  );
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Preflight CORS.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return errorResponse(405, PROVISIONING_MESSAGES.methodNotAllowed);
  }

  // 1. JWT wywołującego.
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  const jwt = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(authHeader.indexOf(' ') + 1).trim()
    : '';
  if (!jwt) {
    return errorResponse(401, PROVISIONING_MESSAGES.missingAuthorization);
  }

  // 2. Klient service-role (auto-wstrzykiwane sekrety runtime Edge).
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('provision-account: brak SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY');
    return errorResponse(500, PROVISIONING_MESSAGES.serverConfig);
  }
  // Schemat n2click jest jedynym wystawionym w PostgREST punktem wejścia tej
  // funkcji; `profiles` i `app_access` to widoki-mostki do `core`.
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'n2click' },
  });

  // 3. Tożsamość wywołującego z JWT.
  const { data: userData, error: userError } = await serviceClient.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return errorResponse(401, PROVISIONING_MESSAGES.invalidSession);
  }
  const callerId = userData.user.id;

  // 4. Profil wywołującego + autoryzacja (service role omija RLS — świadomie).
  // `company_id` wywołującego jest źródłem spółki dla profilu i wpisu
  // `core.app_access` nowego konta.
  const { data: callerProfile, error: callerProfileError } = await serviceClient
    .from('profiles')
    .select('access_role, company_id')
    .eq('id', callerId)
    .maybeSingle();
  if (callerProfileError) {
    console.error('provision-account: nie udało się pobrać profilu wywołującego');
    return errorResponse(500, PROVISIONING_MESSAGES.serverError);
  }
  const authorized = authorizeProvisioning(callerProfile);
  if (!authorized.ok) {
    return errorResponse(authorized.status, authorized.message);
  }
  const callerCompanyId =
    (callerProfile as { company_id?: string | null } | null)?.company_id ?? null;

  // 5. Parsowanie i walidacja ciała.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse(400, PROVISIONING_MESSAGES.malformedJson);
  }
  const allowedEmailDomains = (Deno.env.get('PROVISION_ALLOWED_EMAIL_DOMAINS') ?? '')
    .split(',')
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
  const parsed = parseProvisionRequest(rawBody, { allowedEmailDomains });
  if (!parsed.ok) {
    return errorResponse(400, parsed.message);
  }
  const request = parsed.value;

  // 6. Weryfikacja istnienia działu.
  if (request.departmentId) {
    const { data: department, error: departmentError } = await serviceClient
      .from('departments')
      .select('id')
      .eq('id', request.departmentId)
      .maybeSingle();
    if (departmentError) {
      console.error('provision-account: nie udało się zweryfikować działu');
      return errorResponse(500, PROVISIONING_MESSAGES.serverError);
    }
    if (!department) {
      return errorResponse(400, PROVISIONING_MESSAGES.departmentNotFound);
    }
  }

  // 7. Spójność powiązania z menedżerem.
  if (request.managerProfileId) {
    const { data: managerProfile, error: managerError } = await serviceClient
      .from('profiles')
      .select('id, access_role, department_id')
      .eq('id', request.managerProfileId)
      .maybeSingle();
    if (managerError) {
      console.error('provision-account: nie udało się pobrać profilu menedżera');
      return errorResponse(500, PROVISIONING_MESSAGES.serverError);
    }
    const relationship = validateManagerRelationship(managerProfile ?? null, {
      managerProfileId: request.managerProfileId,
      departmentId: request.departmentId,
    });
    if (!relationship.ok) {
      return errorResponse(400, relationship.message);
    }
  }

  // 8. Utworzenie użytkownika Auth. Hasło tymczasowe jest GENEROWANE tutaj
  // (AUTH-02): losowe per konto, nigdy z żądania klienta, zwracane raz w 201.
  let newUserId: string;
  let temporaryPassword: string | null = null;
  if (request.initialPassword.mode === 'temporary-password') {
    temporaryPassword = generateTemporaryPassword();
    const { data, error } = await serviceClient.auth.admin.createUser({
      email: request.email,
      password: temporaryPassword,
      email_confirm: true,
    });
    if (error || !data?.user) {
      if (isAlreadyRegistered(error?.message)) {
        return errorResponse(409, PROVISIONING_MESSAGES.emailAlreadyExists);
      }
      console.error('provision-account: createUser nie powiódł się', error?.code ?? '');
      return errorResponse(502, PROVISIONING_MESSAGES.serverError);
    }
    newUserId = data.user.id;
  } else {
    const { data, error } = await serviceClient.auth.admin.inviteUserByEmail(request.email);
    if (error || !data?.user) {
      if (isAlreadyRegistered(error?.message)) {
        return errorResponse(409, PROVISIONING_MESSAGES.emailAlreadyExists);
      }
      console.error('provision-account: inviteUserByEmail nie powiódł się', error?.code ?? '');
      return errorResponse(502, PROVISIONING_MESSAGES.serverError);
    }
    newUserId = data.user.id;
  }

  // 9. Wiersz profilu (must_change_password zawsze true). UPSERT, nie INSERT:
  // trigger `core.handle_new_user` na auth.users tworzy szkielet profilu przy
  // każdym signupie — tu nadpisujemy go pełnymi danymi z żądania.
  const { error: insertError } = await serviceClient
    .from('profiles')
    .upsert(
      {
        id: newUserId,
        first_name: request.firstName,
        last_name: request.lastName,
        email: request.email,
        role_title: request.roleTitle,
        access_role: request.accessRole,
        department_id: request.departmentId,
        // Spółka wywołującego admina — MUSI trafić także do profilu, bo
        // app.current_company_id()/project_in_company_scope czytają profil,
        // a trigger protect_profile_privileges blokuje późniejszą samodzielną
        // korektę przez nie-admina.
        company_id: callerCompanyId,
        must_change_password: true,
      },
      { onConflict: 'id' },
    );

  if (insertError) {
    // Best-effort rollback użytkownika Auth, by nie zostawić sieroty bez profilu.
    try {
      await serviceClient.auth.admin.deleteUser(newUserId);
    } catch {
      console.error('provision-account: rollback deleteUser nie powiódł się');
    }
    console.error('provision-account: insert profilu nie powiódł się', insertError.code ?? '');
    return errorResponse(500, PROVISIONING_MESSAGES.serverError);
  }

  // 9b. Przyzwolenie dostępu do N2Click (model globalnego konta: sam profil
  // nie daje dostępu do żadnej appki). Spółka dziedziczona po wywołującym
  // administratorze; brak spółki wywołującego => wpis nada admin później.
  if (callerCompanyId) {
    const accessRoleMap: Record<string, string> = {
      administrator: 'admin',
      manager: 'manager',
      worker: 'member',
    };
    const { error: accessError } = await serviceClient
      .from('app_access')
      .upsert(
        {
          user_id: newUserId,
          app: 'n2click',
          role: accessRoleMap[request.accessRole] ?? 'member',
          company_id: callerCompanyId,
        },
        { onConflict: 'user_id,app' },
      );
    if (accessError) {
      console.error('provision-account: zapis app_access nie powiódł się', accessError.code ?? '');
      // Konto i profil istnieją; brak przyzwolenia = konto nie widzi appki.
      // Świadomie nie wycofujemy — admin może nadać dostęp ręcznie.
    }
  }

  // 10. Sukces. Wygenerowane hasło tymczasowe wraca RAZ, wyłącznie w tej
  // odpowiedzi (TLS, autoryzowany administrator) — to jedyna droga przekazania
  // go nowej osobie; nie jest nigdzie logowane ani przechowywane poza Auth.
  // `must_change_password: true` wymusza zmianę przy pierwszym logowaniu.
  return json(201, {
    userId: newUserId,
    email: request.email,
    accessRole: request.accessRole,
    mustChangePassword: true,
    initialPasswordMode: request.initialPassword.mode,
    ...(temporaryPassword !== null ? { initialPassword: temporaryPassword } : {}),
  });
});
