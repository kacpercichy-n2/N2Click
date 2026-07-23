// Edge Function `send-notification-emails` — opcjonalne dublowanie powiadomień
// in-app zbiorczym mailem per odbiorca. Wołana cyklicznie (Supabase scheduled
// function / zewnętrzny cron co ~5 min — patrz README). Wzorzec z
// `provision-account/index.ts`.
//
// Ten plik działa WYŁĄCZNIE w runtime Deno (Supabase Edge) i NIE jest typowany
// przez tsc repo. Cała logika selekcji/treści żyje w czystym `contract.ts`
// (testowana w repo). Tu zostaje wyłącznie warstwa I/O: odczyt bazy, wysyłka
// przez Resend (czysty fetch, bez zależności) i ustawienie `emailed_at`.
//
// GRANICA ZAUFANIA: klucz service_role oraz `RESEND_API_KEY` żyją wyłącznie w
// runtime Edge; NIGDY w przeglądarce ani w repo. Bez sekretów dostawcy funkcja
// kończy się czystym no-opem (nic nie wysyła). Nie logujemy treści maili ani
// klucza API.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildRecipientEmail,
  claimBatchIds,
  eligibleRecipients,
  groupNotificationsByRecipient,
  readMailerConfig,
  type NameLookups,
  type NotificationRecord,
  type RecipientProfile,
} from './contract.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

/** Ile powiadomień przetwarzamy w jednym wywołaniu (kolejne wybierze następny cron). */
const BATCH_LIMIT = 50;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Deduplikacja i odfiltrowanie pustych id do zapytań `in(...)`. */
function uniq(ids: Array<string | undefined | null>): string[] {
  return [...new Set(ids.filter((v): v is string => typeof v === 'string' && v !== ''))];
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Niedozwolona metoda.' });
  }

  // 1. Sekrety dostawcy. Brak => świadomy no-op (nie spamujemy, nie błąd).
  const mailer = readMailerConfig((name) => Deno.env.get(name));
  if (!mailer) {
    console.log('send-notification-emails: brak RESEND_API_KEY/NOTIFY_FROM_EMAIL — no-op (nic nie wysłano)');
    return json(200, { ok: true, configured: false, sent: 0, skipped: 0 });
  }

  // 2. Klient service-role (auto-wstrzykiwane sekrety runtime Edge).
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('send-notification-emails: brak SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY');
    return json(500, { error: 'Błąd serwera: nieprawidłowa konfiguracja serwera.' });
  }
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 3. Wybór wsadu niewysłanych powiadomień (najstarsze pierwsze) — tylko id.
  const { data: pendingRows, error: notifError } = await db
    .from('notifications')
    .select('id')
    .is('emailed_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);
  if (notifError) {
    console.error('send-notification-emails: nie udało się pobrać powiadomień', notifError.code ?? '');
    return json(500, { error: 'Błąd serwera. Spróbuj ponownie później.' });
  }
  const batchIds = claimBatchIds((pendingRows ?? []).map((r) => ({ id: String(r.id) })));
  if (batchIds.length === 0) {
    return json(200, { ok: true, configured: true, sent: 0, skipped: 0 });
  }

  // 3b. CLAIM-BEFORE-SEND: JEDNYM UPDATE-em stempluj `emailed_at` na wybranym
  //     wsadzie z warunkiem `emailed_at is null` i zwróć REALNIE zaklaśnięte
  //     wiersze (`.select()`). Nakładające się cykle / druga instancja cronu
  //     dostają ROZŁĄCZNE podzbiory — wiersz już zaklaśnięty gdzie indziej
  //     wypada z `emailed_at is null`. Po tym kroku żaden zaklaśnięty wiersz nie
  //     zostanie wybrany ponownie: porażka wysyłki = najwyżej brak jednego maila
  //     (powiadomienie i tak żyje in-app), NIGDY zbiorczy duplikat co cykl.
  const stampedAt = new Date().toISOString();
  const { data: claimedRows, error: claimError } = await db
    .from('notifications')
    .update({ emailed_at: stampedAt })
    .in('id', batchIds)
    .is('emailed_at', null)
    .select('id, recipient_id, type, payload');
  if (claimError) {
    console.error('send-notification-emails: nie udało się zaklaśnąć wsadu', claimError.code ?? '');
    return json(500, { error: 'Błąd serwera. Spróbuj ponownie później.' });
  }
  // `.select()` po UPDATE nie gwarantuje kolejności `created_at`, więc
  // przywracamy porządek NAJSTARSZE-PIERWSZE wg pozycji w `batchIds` (wsad był
  // sortowany rosnąco po `created_at`) — treść maila ma linie w tej kolejności.
  const orderOf = new Map(batchIds.map((id, i) => [id, i]));
  const notifications: NotificationRecord[] = (claimedRows ?? [])
    .map((r) => ({
      id: String(r.id),
      recipientId: String(r.recipient_id),
      type: r.type,
      payload: (r.payload ?? {}) as NotificationRecord['payload'],
    }))
    .sort((a, b) => (orderOf.get(a.id) ?? 0) - (orderOf.get(b.id) ?? 0));
  if (notifications.length === 0) {
    // Inny przebieg zaklaśnął cały wsad w międzyczasie — nic do zrobienia.
    return json(200, { ok: true, configured: true, sent: 0, skipped: 0 });
  }

  // 4. Encje potrzebne do treści: profile (odbiorcy + aktorzy), zadania, projekty.
  const recipientIds = uniq(notifications.map((n) => n.recipientId));
  const actorIds = uniq(notifications.map((n) => n.payload.actorId));
  const profileIds = uniq([...recipientIds, ...actorIds]);
  const taskIds = uniq(notifications.map((n) => n.payload.taskId));
  const projectIds = uniq(notifications.map((n) => n.payload.projectId));

  const [profilesRes, tasksRes, projectsRes] = await Promise.all([
    db.from('profiles').select('id, first_name, last_name, email, email_notifications').in('id', profileIds),
    taskIds.length > 0
      ? db.from('tasks').select('id, title').in('id', taskIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length > 0
      ? db.from('projects').select('id, name').in('id', projectIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profilesRes.error || tasksRes.error || projectsRes.error) {
    console.error('send-notification-emails: nie udało się pobrać encji treści');
    return json(500, { error: 'Błąd serwera. Spróbuj ponownie później.' });
  }

  const recipientProfiles: RecipientProfile[] = [];
  const names: NameLookups = { actors: {}, tasks: {}, projects: {} };
  for (const p of profilesRes.data ?? []) {
    const id = String(p.id);
    const first = typeof p.first_name === 'string' ? p.first_name : '';
    const last = typeof p.last_name === 'string' ? p.last_name : '';
    names.actors[id] = [first, last].filter((s) => s.trim() !== '').join(' ');
    recipientProfiles.push({
      id,
      email: typeof p.email === 'string' ? p.email : '',
      firstName: first,
      emailNotifications: p.email_notifications === true,
    });
  }
  for (const t of tasksRes.data ?? []) {
    names.tasks[String(t.id)] = typeof t.title === 'string' ? t.title : '';
  }
  for (const pr of projectsRes.data ?? []) {
    names.projects[String(pr.id)] = typeof pr.name === 'string' ? pr.name : '';
  }

  // 5. Grupowanie per odbiorca (opt-out / brak adresu => pominięte).
  const eligible = eligibleRecipients(recipientProfiles);
  const { batches, skippedIds } = groupNotificationsByRecipient(notifications, eligible);

  // 6. Wysyłka: jeden mail per odbiorca. Wsad jest JUŻ zaklaśnięty (krok 3b), więc
  //    `emailed_at` jest ustawione — nie ma tu żadnego zapisu. Porażka wysyłki po
  //    zaklaśnięciu = najwyżej brak jednego maila (powiadomienie żyje in-app),
  //    NIGDY zbiorczy duplikat. Pominięci (opt-out/brak adresu) też są już
  //    zaklaśnięci, więc kolejny cron ich nie wybierze.
  let sent = 0;
  for (const batch of batches) {
    const email = buildRecipientEmail(batch, names, mailer.hubUrl);
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${mailer.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: mailer.fromEmail,
          to: [batch.recipient.email],
          subject: email.subject,
          text: email.text,
          html: email.html,
        }),
      });
      if (!res.ok) {
        // Nie logujemy ciała (może zawierać dane) — tylko status.
        console.error('send-notification-emails: dostawca odrzucił wysyłkę, status', res.status);
        continue;
      }
      sent += 1;
    } catch (_e) {
      console.error('send-notification-emails: błąd sieci przy wysyłce do dostawcy');
      // Zaklaśnięte wcześniej — świadomie NIE ponawiamy (unikamy duplikatów).
    }
  }

  return json(200, { ok: true, configured: true, sent, skipped: skippedIds.length });
});
