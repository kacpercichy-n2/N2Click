// Czysty kontrakt Edge Function `send-notification-emails`: selekcja odbiorców,
// grupowanie wsadu, budowa polskiej treści maila oraz odczyt konfiguracji
// dostawcy z env. Wzorzec z `provision-account/contract.ts`.
//
// Ten moduł jest CELOWO pozbawiony zależności: nie importuje SDK, nie używa
// globali Deno ani Node, nie czyta env bezpośrednio. Dzięki temu konsumuje go
// zarówno bundler Deno (Edge `index.ts`), jak i tsc/vitest repo (test
// `src/supabase/notificationEmails.test.ts` ściąga go tranzytywnie pod
// `tsc --noEmit` strict). Cała logika jest czysta i deterministyczna.
//
// Nigdy nie logujemy ani nie umieszczamy w treści klucza API dostawcy.

/** Rodzaj powiadomienia — LUSTRO `NotificationType` z src/types.ts (nie
 *  importujemy, bo bundling Edge musi zostać w `supabase/functions/`). */
export type NotificationType = 'task_assigned' | 'project_comment' | 'bin_item';

/** Ładunek powiadomienia — LUSTRO `NotificationPayload` z src/types.ts. */
export interface NotificationPayload {
  taskId?: string;
  projectId?: string;
  commentId?: string;
  actorId?: string;
}

/** Jedno niewysłane powiadomienie odczytane z `public.notifications`. */
export interface NotificationRecord {
  id: string;
  recipientId: string;
  type: NotificationType;
  payload: NotificationPayload;
}

/** Profil odbiorcy istotny dla wysyłki: adres i preferencja mailowa. */
export interface RecipientProfile {
  id: string;
  email: string;
  firstName: string;
  emailNotifications: boolean;
}

/** Rozwiązane nazwy encji — wstrzykiwane do czystego buildera treści. Klucz to
 *  id encji (profilu/zadania/projektu); brak wpisu degraduje się miękko. */
export interface NameLookups {
  actors: Record<string, string>;
  tasks: Record<string, string>;
  projects: Record<string, string>;
}

/** Zbiór powiadomień jednego odbiorcy gotowy do wysłania jednego maila. */
export interface RecipientBatch {
  recipient: RecipientProfile;
  notifications: NotificationRecord[];
}

/** Konfiguracja dostawcy poczty odczytana z sekretów funkcji. */
export interface MailerConfig {
  resendApiKey: string;
  fromEmail: string;
  /** Link do huba wstawiany w treść; '' gdy operator nie ustawił NOTIFY_HUB_URL. */
  hubUrl: string;
}

/** Gotowa treść jednego maila zbiorczego. */
export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

// ---- Konfiguracja / brak sekretów (graceful no-op) --------------------------

/**
 * Czyta konfigurację dostawcy z akcesora env (np. `Deno.env.get`). Zwraca `null`,
 * gdy KTÓRYKOLWIEK wymagany sekret (`RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`) jest
 * pusty/nieustawiony — funkcja traktuje to jako świadomy no-op (loguje i kończy
 * czysto, bez wysyłki). `NOTIFY_HUB_URL` jest opcjonalny.
 */
export function readMailerConfig(getEnv: (name: string) => string | undefined): MailerConfig | null {
  const resendApiKey = (getEnv('RESEND_API_KEY') ?? '').trim();
  const fromEmail = (getEnv('NOTIFY_FROM_EMAIL') ?? '').trim();
  if (resendApiKey === '' || fromEmail === '') return null;
  return {
    resendApiKey,
    fromEmail,
    hubUrl: (getEnv('NOTIFY_HUB_URL') ?? '').trim(),
  };
}

// ---- Selekcja odbiorców i grupowanie ----------------------------------------

/**
 * Buduje mapę odbiorców UPRAWNIONYCH do maila: preferencja włączona ORAZ adres
 * niepusty. Odbiorca z wyłączoną preferencją albo bez adresu jest pomijany
 * (klucz mapy = id profilu).
 */
export function eligibleRecipients(profiles: RecipientProfile[]): Map<string, RecipientProfile> {
  const map = new Map<string, RecipientProfile>();
  for (const p of profiles) {
    if (p.emailNotifications !== true) continue;
    if (p.email.trim() === '') continue;
    map.set(p.id, p);
  }
  return map;
}

/**
 * Grupuje niewysłane powiadomienia per odbiorca, POMIJAJĄC te, których odbiorca
 * nie jest uprawniony (opt-out, brak konta/adresu). Kolejność wsadów i
 * powiadomień w nich jest zachowana wg wejścia (deterministyczna). Zwraca też
 * `skippedIds` — powiadomienia świadomie pominięte (żeby wywołujący i tak
 * ustawił im `emailed_at` i nie wybierał ich w kółko).
 */
export function groupNotificationsByRecipient(
  notifications: NotificationRecord[],
  eligible: Map<string, RecipientProfile>,
): { batches: RecipientBatch[]; skippedIds: string[] } {
  const byRecipient = new Map<string, RecipientBatch>();
  const order: string[] = [];
  const skippedIds: string[] = [];

  for (const n of notifications) {
    const recipient = eligible.get(n.recipientId);
    if (!recipient) {
      skippedIds.push(n.id);
      continue;
    }
    let batch = byRecipient.get(n.recipientId);
    if (!batch) {
      batch = { recipient, notifications: [] };
      byRecipient.set(n.recipientId, batch);
      order.push(n.recipientId);
    }
    batch.notifications.push(n);
  }

  return { batches: order.map((id) => byRecipient.get(id)!), skippedIds };
}

// ---- Budowa treści (polski) --------------------------------------------------

const dash = '—';

function actorName(names: NameLookups, id?: string): string {
  const raw = id ? names.actors[id] : undefined;
  return (raw ?? '').trim() || 'Ktoś';
}

function taskTitle(names: NameLookups, id?: string): string {
  const raw = id ? names.tasks[id] : undefined;
  return (raw ?? '').trim() || dash;
}

function projectName(names: NameLookups, id?: string): string {
  const raw = id ? names.projects[id] : undefined;
  return (raw ?? '').trim() || dash;
}

/**
 * Jedna linia treści (kto/co/gdzie) — LUSTRO logiki `notificationEntry`
 * (src/pages/dashboardPanels.ts), utrzymane jako czysta funkcja tekstowa dla
 * maila. Braki nazw degradują się miękko (aktor => „Ktoś", encja => „—").
 */
export function notificationLine(n: NotificationRecord, names: NameLookups): string {
  switch (n.type) {
    case 'task_assigned': {
      const actor = actorName(names, n.payload.actorId);
      const task = taskTitle(names, n.payload.taskId);
      const project = projectName(names, n.payload.projectId);
      return `${actor} przypisał(a) Ci zadanie „${task}” (projekt „${project}”)`;
    }
    case 'project_comment': {
      const actor = actorName(names, n.payload.actorId);
      const project = projectName(names, n.payload.projectId);
      return `${actor} skomentował(a) projekt „${project}”`;
    }
    case 'bin_item': {
      const task = taskTitle(names, n.payload.taskId);
      const project = projectName(names, n.payload.projectId);
      return `Nowa praca w zasobniku: „${task}” (projekt „${project}”)`;
    }
  }
}

/**
 * Polska odmiana rzeczownika „powiadomienie" dla licznika (1 / 2–4 / 5+ z
 * wyjątkiem nastoletnich 12–14).
 */
export function powiadomieniaLabel(count: number): string {
  const abs = Math.abs(count);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (abs === 1) return `${count} nowe powiadomienie`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} nowe powiadomienia`;
  }
  return `${count} nowych powiadomień`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Buduje jeden mail zbiorczy dla odbiorcy: temat z licznikiem, lista „kto/co/
 * gdzie", link do huba (gdy ustawiony) i krótka stopka o wyłączeniu preferencji.
 * Czyste i deterministyczne — sedno testów treści.
 */
export function buildRecipientEmail(batch: RecipientBatch, names: NameLookups, hubUrl: string): EmailContent {
  const count = batch.notifications.length;
  const greetingName = batch.recipient.firstName.trim();
  const greeting = greetingName ? `Cześć ${greetingName},` : 'Cześć,';
  const lines = batch.notifications.map((n) => notificationLine(n, names));
  const subject = `N2Hub: ${powiadomieniaLabel(count)}`;

  const textParts = [
    greeting,
    '',
    'Masz nowe powiadomienia w N2Hub:',
    '',
    ...lines.map((l) => `- ${l}`),
  ];
  const link = hubUrl.trim();
  if (link !== '') {
    textParts.push('', `Otwórz N2Hub: ${link}`);
  }
  textParts.push(
    '',
    'Ten mail dostajesz, bo masz włączone powiadomienia mailowe. Możesz je wyłączyć w profilu w N2Hub.',
  );
  const text = textParts.join('\n');

  const htmlLines = lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('');
  const htmlLink =
    link !== ''
      ? `<p><a href="${escapeHtml(link)}">Otwórz N2Hub</a></p>`
      : '';
  const html =
    `<p>${escapeHtml(greeting)}</p>` +
    `<p>Masz nowe powiadomienia w N2Hub:</p>` +
    `<ul>${htmlLines}</ul>` +
    htmlLink +
    `<p style="color:#888;font-size:12px">Ten mail dostajesz, bo masz włączone powiadomienia mailowe. Możesz je wyłączyć w profilu w N2Hub.</p>`;

  return { subject, text, html };
}
