// Edge Function `google-calendar-connect` — podpięcie konta Google do profilu.
//
// Przeglądarka dostaje z GIS (tryb `popup`, authorization code flow) JEDNORAZOWY
// kod i przysyła go tutaj z JWT sesji. Funkcja wymienia kod na tokeny kluczem
// `GOOGLE_CLIENT_SECRET` (sekret funkcji, nigdy w przeglądarce), chowa refresh
// token w Vault przez definera `google_store_refresh_token` (tylko
// service_role), zakłada/odświeża wiersz `google_accounts`, a potem od razu
// woła `google-calendar-sync` dla tego konta, żeby lista kalendarzy i pierwsze
// wydarzenia pojawiły się bez czekania na cron.
//
// Ten plik działa WYŁĄCZNIE w runtime Deno i NIE jest typowany przez tsc repo.
// Nigdy nie logujemy kodu, tokenów ani e-maila.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { GCAL_MESSAGES, parseTokenExchange } from '../google-calendar-sync/contract.ts';
import { exchangeAuthorizationCode, fetchUserEmail } from '../_shared/google.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

function corsHeaders(): Record<string, string> {
  const origin = Deno.env.get('GOOGLE_ALLOWED_ORIGIN');
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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== 'POST') return json(405, { error: GCAL_MESSAGES.methodNotAllowed });

  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? '';
  const jwt = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  if (jwt === '') return json(401, { error: GCAL_MESSAGES.missingAuthorization });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
    console.error('google-calendar-connect: brak konfiguracji (SUPABASE_* / GOOGLE_CLIENT_*)');
    return json(500, { error: GCAL_MESSAGES.serverConfig });
  }
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'n2click' },
  });

  const { data: userData, error: userError } = await client.auth.getUser(jwt);
  if (userError || !userData?.user) return json(401, { error: GCAL_MESSAGES.invalidSession });
  const profileId = userData.user.id;

  let body: { code?: unknown };
  try {
    body = (await req.json()) as { code?: unknown };
  } catch {
    return json(400, { error: GCAL_MESSAGES.malformedJson });
  }
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (code === '') return json(400, { error: GCAL_MESSAGES.missingCode });

  const exchanged = await exchangeAuthorizationCode({ clientId, clientSecret }, code);
  const tokens = parseTokenExchange(exchanged.ok ? exchanged.body : null);
  if (!tokens.ok) return json(400, { error: tokens.message });

  const email = await fetchUserEmail(tokens.accessToken);

  const { data: secretId, error: secretError } = await client.rpc('google_store_refresh_token', {
    p_profile_id: profileId,
    p_token: tokens.refreshToken,
  });
  if (secretError || typeof secretId !== 'string') {
    console.error('google-calendar-connect: nie udało się zapisać sekretu');
    return json(500, { error: GCAL_MESSAGES.serverError });
  }

  const { error: upsertError } = await client.from('google_accounts').upsert(
    {
      profile_id: profileId,
      google_email: email !== '' ? email : 'konto Google',
      vault_secret_id: secretId,
      scopes: tokens.scope,
      status: 'active',
      last_error: null,
    },
    { onConflict: 'profile_id' },
  );
  if (upsertError) {
    console.error('google-calendar-connect: nie udało się zapisać konta');
    return json(500, { error: GCAL_MESSAGES.serverError });
  }

  // Pierwszy sync od razu (ten sam JWT => funkcja sync zawęzi do tego konta).
  try {
    await fetch(`${supabaseUrl}/functions/v1/google-calendar-sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch {
    // Cron dogoni; podpięcie i tak się udało.
  }

  return json(200, { ok: true, email });
});
