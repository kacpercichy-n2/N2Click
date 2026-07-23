// Testy czystego kontraktu Edge Function `send-notification-emails`
// (contract.ts). Importujemy WYŁĄCZNIE moduł kontraktu (bez SDK, bez globali
// Deno) — deterministyczny w node. Świadomie ściągamy plik spoza `src/` z jawnym
// rozszerzeniem `.ts` (jak provisioning.test.ts).
import { describe, expect, it } from 'vitest';
import {
  buildRecipientEmail,
  claimBatchIds,
  eligibleRecipients,
  groupNotificationsByRecipient,
  notificationLine,
  powiadomieniaLabel,
  readMailerConfig,
  type NameLookups,
  type NotificationRecord,
  type RecipientProfile,
} from '../../supabase/functions/send-notification-emails/contract.ts';

const NAMES: NameLookups = {
  actors: { 'act-1': 'Anna Nowak' },
  tasks: { 'task-1': 'Projekt logo' },
  projects: { 'proj-1': 'Rebranding' },
};

function notif(o: Partial<NotificationRecord> & { id: string }): NotificationRecord {
  return {
    recipientId: 'rec-1',
    type: 'task_assigned',
    payload: { taskId: 'task-1', projectId: 'proj-1', actorId: 'act-1' },
    ...o,
  };
}

function recipient(o: Partial<RecipientProfile> & { id: string }): RecipientProfile {
  return { email: 'kto@x.pl', firstName: 'Kuba', emailNotifications: true, ...o };
}

describe('readMailerConfig — no-op bez sekretów', () => {
  const env = (map: Record<string, string>) => (name: string) => map[name];

  it('zwraca null, gdy brak RESEND_API_KEY', () => {
    expect(readMailerConfig(env({ NOTIFY_FROM_EMAIL: 'a@x.pl' }))).toBeNull();
  });

  it('zwraca null, gdy brak NOTIFY_FROM_EMAIL', () => {
    expect(readMailerConfig(env({ RESEND_API_KEY: 'key' }))).toBeNull();
  });

  it('zwraca null, gdy sekret jest pustym/whitespace stringiem', () => {
    expect(readMailerConfig(env({ RESEND_API_KEY: '   ', NOTIFY_FROM_EMAIL: 'a@x.pl' }))).toBeNull();
  });

  it('zwraca konfigurację, gdy oba sekrety są ustawione (hubUrl opcjonalny)', () => {
    const cfg = readMailerConfig(env({ RESEND_API_KEY: 'key', NOTIFY_FROM_EMAIL: 'a@x.pl' }));
    expect(cfg).toEqual({ resendApiKey: 'key', fromEmail: 'a@x.pl', hubUrl: '' });
    const cfg2 = readMailerConfig(
      env({ RESEND_API_KEY: 'key', NOTIFY_FROM_EMAIL: 'a@x.pl', NOTIFY_HUB_URL: 'https://hub.x.pl' }),
    );
    expect(cfg2?.hubUrl).toBe('https://hub.x.pl');
  });
});

describe('eligibleRecipients — selekcja odbiorców', () => {
  it('pomija odbiorcę z wyłączoną preferencją (opt-out)', () => {
    const map = eligibleRecipients([
      recipient({ id: 'a', emailNotifications: true }),
      recipient({ id: 'b', emailNotifications: false }),
    ]);
    expect(map.has('a')).toBe(true);
    expect(map.has('b')).toBe(false);
  });

  it('pomija odbiorcę bez adresu e-mail', () => {
    const map = eligibleRecipients([
      recipient({ id: 'a', email: '' }),
      recipient({ id: 'b', email: '  ' }),
    ]);
    expect(map.size).toBe(0);
  });
});

describe('groupNotificationsByRecipient — grupowanie i pomijanie', () => {
  it('grupuje wiele powiadomień jednego odbiorcy w jeden wsad', () => {
    const eligible = eligibleRecipients([recipient({ id: 'rec-1' })]);
    const { batches, skippedIds } = groupNotificationsByRecipient(
      [notif({ id: 'n1' }), notif({ id: 'n2', type: 'bin_item' })],
      eligible,
    );
    expect(batches).toHaveLength(1);
    expect(batches[0].notifications.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(skippedIds).toEqual([]);
  });

  it('pomija (i raportuje) powiadomienia dla odbiorcy poza zbiorem uprawnionych', () => {
    const eligible = eligibleRecipients([
      recipient({ id: 'rec-1', emailNotifications: true }),
      recipient({ id: 'rec-2', emailNotifications: false }),
    ]);
    const { batches, skippedIds } = groupNotificationsByRecipient(
      [notif({ id: 'n1', recipientId: 'rec-1' }), notif({ id: 'n2', recipientId: 'rec-2' })],
      eligible,
    );
    expect(batches).toHaveLength(1);
    expect(batches[0].recipient.id).toBe('rec-1');
    expect(skippedIds).toEqual(['n2']);
  });

  it('rozdziela dwóch uprawnionych odbiorców na dwa wsady, zachowując kolejność', () => {
    const eligible = eligibleRecipients([recipient({ id: 'rec-1' }), recipient({ id: 'rec-2' })]);
    const { batches } = groupNotificationsByRecipient(
      [notif({ id: 'n1', recipientId: 'rec-2' }), notif({ id: 'n2', recipientId: 'rec-1' })],
      eligible,
    );
    expect(batches.map((b) => b.recipient.id)).toEqual(['rec-2', 'rec-1']);
  });
});

describe('claimBatchIds — claim-before-send', () => {
  it('zwraca wszystkie id wsadu (także tych, którzy zostaną pominięci) do zaklaśnięcia', () => {
    // Pominięci (opt-out/brak adresu) MUSZĄ być w zbiorze claim, żeby kolejny
    // cron ich nie wybierał w kółko — claim stempluje cały wybrany wsad.
    const ids = claimBatchIds([{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }]);
    expect(ids).toEqual(['n1', 'n2', 'n3']);
  });

  it('deduplikuje i odrzuca puste id', () => {
    expect(claimBatchIds([{ id: 'n1' }, { id: 'n1' }, { id: '' }, { id: 'n2' }])).toEqual(['n1', 'n2']);
  });
});

describe('notificationLine — polska treść per typ', () => {
  it('task_assigned: kto/co/gdzie', () => {
    expect(notificationLine(notif({ id: 'n' }), NAMES)).toBe(
      'Anna Nowak przypisał(a) Ci zadanie „Projekt logo” (projekt „Rebranding”)',
    );
  });

  it('project_comment', () => {
    expect(
      notificationLine(notif({ id: 'n', type: 'project_comment', payload: { projectId: 'proj-1', actorId: 'act-1' } }), NAMES),
    ).toBe('Anna Nowak skomentował(a) projekt „Rebranding”');
  });

  it('bin_item', () => {
    expect(
      notificationLine(notif({ id: 'n', type: 'bin_item', payload: { taskId: 'task-1', projectId: 'proj-1' } }), NAMES),
    ).toBe('Nowa praca w zasobniku: „Projekt logo” (projekt „Rebranding”)');
  });

  it('braki nazw degradują się miękko (Ktoś / —)', () => {
    const empty: NameLookups = { actors: {}, tasks: {}, projects: {} };
    expect(notificationLine(notif({ id: 'n', payload: {} }), empty)).toBe(
      'Ktoś przypisał(a) Ci zadanie „—” (projekt „—”)',
    );
  });
});

describe('powiadomieniaLabel — polska odmiana', () => {
  it('1 / 2–4 / 5+ (z wyjątkiem 12–14)', () => {
    expect(powiadomieniaLabel(1)).toBe('1 nowe powiadomienie');
    expect(powiadomieniaLabel(3)).toBe('3 nowe powiadomienia');
    expect(powiadomieniaLabel(5)).toBe('5 nowych powiadomień');
    expect(powiadomieniaLabel(12)).toBe('12 nowych powiadomień');
    expect(powiadomieniaLabel(22)).toBe('22 nowe powiadomienia');
  });
});

describe('buildRecipientEmail — mail zbiorczy', () => {
  const batch = {
    recipient: recipient({ id: 'rec-1', firstName: 'Kuba' }),
    notifications: [notif({ id: 'n1' }), notif({ id: 'n2', type: 'bin_item' })],
  };

  it('temat zawiera licznik, treść listę kto/co/gdzie i link do huba', () => {
    const email = buildRecipientEmail(batch, NAMES, 'https://hub.x.pl');
    expect(email.subject).toBe('N2Hub: 2 nowe powiadomienia');
    expect(email.text).toContain('Cześć Kuba,');
    expect(email.text).toContain('Anna Nowak przypisał(a) Ci zadanie „Projekt logo”');
    expect(email.text).toContain('Nowa praca w zasobniku');
    expect(email.text).toContain('Otwórz N2Hub: https://hub.x.pl');
    expect(email.text).toContain('wyłączyć w profilu');
    expect(email.html).toContain('<a href="https://hub.x.pl">');
  });

  it('bez hubUrl nie wstawia linku', () => {
    const email = buildRecipientEmail(batch, NAMES, '');
    expect(email.text).not.toContain('Otwórz N2Hub');
    expect(email.html).not.toContain('<a href');
  });

  it('escapuje HTML w treści (nazwy z encjami)', () => {
    const email = buildRecipientEmail(
      { recipient: recipient({ id: 'r' }), notifications: [notif({ id: 'n', payload: { taskId: 't', projectId: 'p' } })] },
      { actors: {}, tasks: { t: '<b>x</b>' }, projects: { p: 'A & B' } },
      '',
    );
    expect(email.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(email.html).toContain('A &amp; B');
  });
});
