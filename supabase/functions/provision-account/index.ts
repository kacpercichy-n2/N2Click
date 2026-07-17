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
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 3. Tożsamość wywołującego z JWT.
  const { data: userData, error: userError } = await serviceClient.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return errorResponse(401, PROVISIONING_MESSAGES.invalidSession);
  }
  const callerId = userData.user.id;

  // 4. Profil wywołującego + autoryzacja (service role omija RLS — świadomie).
  const { data: callerProfile, error: callerProfileError } = await serviceClient
    .from('profiles')
    .select('access_role')
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

  // 8. Utworzenie użytkownika Auth.
  let newUserId: string;
  if (request.initialPassword.mode === 'temporary-password') {
    const { data, error } = await serviceClient.auth.admin.createUser({
      email: request.email,
      password: request.initialPassword.password,
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

  // 9. Wstawienie wiersza profilu (must_change_password zawsze true).
  const { error: insertError } = await serviceClient.from('profiles').insert({
    id: newUserId,
    first_name: request.firstName,
    last_name: request.lastName,
    email: request.email,
    role_title: request.roleTitle,
    access_role: request.accessRole,
    department_id: request.departmentId,
    must_change_password: true,
  });

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

  // 10. Sukces — nigdy nie zwracamy hasła.
  return json(201, {
    userId: newUserId,
    email: request.email,
    accessRole: request.accessRole,
    mustChangePassword: true,
    initialPasswordMode: request.initialPassword.mode,
  });
});
