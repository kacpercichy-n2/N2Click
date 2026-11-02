// Statyczna walidacja migracji SQL (supabase/migrations/*.sql).
//
// Nie mamy tu działającego Postgresa, więc test pilnuje konwencji i inwariantów
// bezpieczeństwa, które da się sprawdzić na tekście migracji:
// deny-by-default (RLS na każdej tabeli), brak FORCE (rekursja funkcji
// definer), hardening funkcji (search_path), polityki tylko `to authenticated`,
// prywatny bucket awatarów i walidacja typu identyfikatora właściciela Storage
// przed politykami, które z niego korzystają.
//
// Konwencje opisuje supabase/README.md.

import { describe, expect, it } from 'vitest';

const rawMigrations = import.meta.glob('../../supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Nazwa pliku bez ścieżki, posortowane rosnąco po wersji. */
const files: Array<{ name: string; sql: string }> = Object.entries(rawMigrations)
  .map(([path, sql]) => ({ name: path.split('/').pop()!, sql }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Usuwa komentarze `-- ...` i normalizuje białe znaki do pojedynczych spacji. */
function normalize(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const allSql = normalize(files.map((f) => f.sql).join('\n'));

/** Tabele rdzenia i wymagane per-komenda pokrycie politykami. */
const EXPECTED_POLICIES: Record<string, string[]> = {
  'public.profiles': ['select', 'insert', 'update', 'delete'],
  'public.departments': ['select', 'insert', 'update', 'delete'],
  'public.projects': ['select', 'insert', 'update', 'delete'],
  // Wiersze-łączniki wymienia się przez delete+insert — celowo bez UPDATE.
  'public.project_members': ['select', 'insert', 'delete'],
  'public.tasks': ['select', 'insert', 'update', 'delete'],
  'public.task_assignments': ['select', 'insert', 'delete'],
  'storage.objects': ['select', 'insert', 'update', 'delete'],
  // Słownikowe tabele referencyjne (20260716150000_reference_tables): odczyt dla
  // wszystkich zalogowanych, zapis wyłącznie admin — pełne CRUD w politykach.
  'public.statuses': ['select', 'insert', 'update', 'delete'],
  'public.service_types': ['select', 'insert', 'update', 'delete'],
  'public.work_categories': ['select', 'insert', 'update', 'delete'],
  // Planer (20260716190000_planner_entities): klienci to referencyjne dane
  // biznesu — pełne CRUD w politykach (SELECT otwarty, zapis admin/menedżer);
  // komentarze i dziennik aktywności są DOPISYWALNE (append-only) — wyłącznie
  // SELECT + INSERT, bez UPDATE/DELETE (usunięcie encji sprząta je kaskadą FK).
  'public.clients': ['select', 'insert', 'update', 'delete'],
  'public.comments': ['select', 'insert'],
  'public.activity_events': ['select', 'insert'],
  // Wycofanie planera (20260717000000_workload_planner_retirement): zaplanowane
  // godziny i kamienie milowe to pełne CRUD (zakres ról jak dla zadań/projektów);
  // `app_settings` czyta każdy zalogowany (flaga wycofania), pisze tylko admin.
  'public.workload_entries': ['select', 'insert', 'update', 'delete'],
  'public.milestones': ['select', 'insert', 'update', 'delete'],
  'public.app_settings': ['select', 'insert', 'update', 'delete'],
  // Zgłoszenia zespołu (20260720230000_tickets): pełne CRUD w politykach —
  // insert dla każdego zalogowanego (tylko „na siebie”), select własne wiersze
  // lub administrator, update administrator / zgłaszający dopóki 'nowe',
  // delete wyłącznie administrator.
  'public.tickets': ['select', 'insert', 'update', 'delete'],
  // Słownik stanowisk (20260721150000_job_titles): odczyt dla każdego
  // zalogowanego, zapis wyłącznie administrator — pełne CRUD w politykach.
  'public.job_titles': ['select', 'insert', 'update', 'delete'],
  // Słownik spółek (20260721160000_companies): odczyt dla każdego zalogowanego,
  // zapis wyłącznie administrator — pełne CRUD w politykach.
  'public.companies': ['select', 'insert', 'update', 'delete'],
  // Wydarzenia kalendarza (20260721210000_events): kalendarz OGÓLNOFIRMOWY —
  // pełne CRUD dla każdego zalogowanego (`using (true)` / `with check (true)`),
  // bo lokalna rola handlowiec mapuje się w chmurze na worker; bramka
  // `events.manage` pozostaje UX-em po stronie klienta.
  'public.events': ['select', 'insert', 'update', 'delete'],
  // Powiadomienia in-app (20260723120000_notifications): per-użytkownik —
  // SELECT/UPDATE wyłącznie własnych wierszy (odbiorca; UPDATE oznacza jako
  // przeczytane), INSERT dla każdego zalogowanego (klient generuje zdarzenia w
  // imieniu działającego użytkownika, wstawiając wiersze dla innych odbiorców).
  // Bez DELETE — powiadomień nie kasujemy z klienta.
  'public.notifications': ['select', 'insert', 'update'],
  // Moduł Content Plan (20260803160100, schemat `contentplan` — klucze podane
  // z prawdziwym schematem, inaczej niż historyczne `public.*` rdzenia):
  // pełne CRUD dla zespołu (`admin`/`editor`), a komentarze i historia zmian są
  // DOPISYWALNE (select + insert, jak `public.comments`/`activity_events`) —
  // usuwanie idzie kaskadą FK z posta. Dodatkowe polityki `*_select_client`
  // (przyszła rola `client`: tylko `visibility='published'` przypisanej marki)
  // nie wnoszą nowych komend, więc lista poniżej ich nie powtarza.
  'contentplan.brands': ['select', 'insert', 'update', 'delete'],
  // Portal klienta (20260804120000): przypięcia marka-konto wymienia się przez
  // delete+insert (łącznik, jak project_members) — celowo bez UPDATE.
  'contentplan.brand_members': ['select', 'insert', 'delete'],
  'contentplan.posts': ['select', 'insert', 'update', 'delete'],
  'contentplan.post_channels': ['select', 'insert', 'update', 'delete'],
  'contentplan.comments': ['select', 'insert'],
  'contentplan.post_history': ['select', 'insert'],
  'contentplan.drive_folders': ['select', 'insert', 'update', 'delete'],
  // Czat wewnętrzny (20260813180000_chat, schemat `n2click` — klucze z
  // prawdziwym schematem, jak contentplan): rozmowa jest tylko do odczytu
  // i założenia (tytuł grupy poza MVP, `last_message_at` podbija trigger
  // definer, rozmów się nie kasuje z klienta), członkostwo ma pełne CRUD
  // (UPDATE = `last_read_at`/`muted_until`, DELETE = opuszczenie rozmowy),
  // a wiadomości nie mają DELETE — kasowanie jest MIĘKKIE (`deleted_at`).
  'n2click.conversations': ['select', 'insert'],
  'n2click.conversation_members': ['select', 'insert', 'update', 'delete'],
  'n2click.messages': ['select', 'insert', 'update'],
  // Reakcje (20260825120000_chat_reactions): klient wyłącznie CZYTA (osadzenie
  // w select wiadomości); każdy zapis idzie przez RPC `chat_set_reaction`
  // (security definer), więc brak polityk insert/update/delete jest celowy.
  'n2click.message_reactions': ['select'],
  // Kalendarz Google (20260825140000): konto — odczyt/`share_level`/rozłączenie
  // (DELETE) własnego wiersza; kalendarze — odczyt i przełącznik `selected`;
  // wydarzenia bazowe — tylko właściciel (zespół czyta widok maskujący).
  // INSERT i sync robią wyłącznie Edge Functions kluczem service_role.
  'n2click.google_accounts': ['select', 'update', 'delete'],
  'n2click.google_calendars': ['select', 'update'],
  'n2click.google_calendar_events': ['select'],
  // Autoryzacja prywatnych kanałów Broadcast/Presence czatu: SELECT = prawo do
  // odbierania zdarzeń topicu, INSERT = prawo do wysyłania („pisze…”, presence).
  // Tabela jest platformowa i WSPÓLNA dla appek — polityki są permisywne, więc
  // wpisy `chat_*` niczego cudzego nie zawężają.
  'realtime.messages': ['select', 'insert'],
  // Powiadomienia po przeniesieniu do `n2click` (20261102103000): polityka
  // INSERT zawężona do typów generowanych w przeglądarce; select/update
  // zostają z 20260723120000 (klucz `public.notifications` wyżej).
  'n2click.notifications': ['insert'],
};

interface ParsedPolicy {
  name: string;
  table: string;
  command: string;
  roles: string;
  statement: string;
}

const policyStatements = allSql.match(/create policy[\s\S]*?;/g) ?? [];
const policies: ParsedPolicy[] = [];
const unparsedPolicies: string[] = [];
for (const statement of policyStatements) {
  // Nazwa tabeli dopuszcza CYFRY — schemat `n2click` (polityki czatu) inaczej
  // wpadłby w `unparsedPolicies` i wyglądał jak polityka spoza konwencji.
  const head = statement.match(
    /create policy "([^"]+)" on ([a-z0-9_.]+) for (select|insert|update|delete|all) to ([a-z_, ]+?) (?=using|with)/,
  );
  if (head) {
    const [, name, table, command, roles] = head;
    policies.push({ name, table, command, roles: roles.trim(), statement });
  } else {
    unparsedPolicies.push(statement.slice(0, 120));
  }
}

describe('konwencja plików migracji', () => {
  it('zawiera migracje rdzenia oraz kolejne migracje tylko-do-przodu', () => {
    expect(files.map((f) => f.name)).toEqual([
      '20260715210000_core_schema.sql',
      '20260715210500_rls_policies.sql',
      '20260715220000_profiles_must_change_password.sql',
      '20260716150000_reference_tables.sql',
      '20260716190000_planner_entities.sql',
      '20260717000000_workload_planner_retirement.sql',
      '20260717110000_profiles_supervisor.sql',
      '20260717130000_profiles_planner_fields.sql',
      '20260718090000_clients_contact_fields.sql',
      '20260718091000_realtime_publication.sql',
      '20260720150000_assignee_visibility_and_profile_rls.sql',
      '20260720170000_task_departments.sql',
      '20260720190000_manager_task_management.sql',
      '20260720200000_task_order_index.sql',
      '20260720230000_tickets.sql',
      '20260721010000_project_documents.sql',
      '20260721020000_task_is_draft.sql',
      '20260721030000_profiles_birth_date.sql',
      '20260721130000_task_draft_hours.sql',
      '20260721150000_job_titles.sql',
      '20260721160000_companies.sql',
      '20260721170000_task_recurrence.sql',
      '20260721210000_events.sql',
      '20260721220000_workload_entry_done.sql',
      '20260722120000_project_company.sql',
      '20260722121000_full_access_for_all_profiles.sql',
      '20260722130000_client_contacts.sql',
      '20260723120000_notifications.sql',
      '20260723121800_profiles_notifications_seen.sql',
      '20260723122820_tasks_created_by_default_backfill.sql',
      '20260723130000_notifications_emailed_at.sql',
      '20260723131000_profiles_email_notifications.sql',
      // Przebudowa schema-per-app (2026-07-31, handoff n2hub-db-restructure):
      // tożsamość w `core`, domena N2Click w `n2click`, puste `clarity`/`blogoapp`.
      '20260731081544_schema_per_app_foundation.sql',
      '20260731081626_move_identity_to_core.sql',
      '20260731081703_core_app_access.sql',
      '20260731081748_core_jwt_hook_and_claim_helpers.sql',
      '20260731081831_move_n2click_tables.sql',
      '20260731081921_rewrite_app_helpers_for_new_schemas.sql',
      '20260731082129_signup_trigger_seed_access_bridge_views.sql',
      '20260731082207_rls_gating_has_app.sql',
      '20260731082805_app_access_bridge_view.sql',
      '20260731083226_pin_search_path_claim_helpers.sql',
      '20260731083246_app_access_company_idx.sql',
      '20260731084109_company_scope_via_relations.sql',
      '20260731084136_tidy_grants_core_defaults.sql',
      // Przeczytane per wpis feedu powiadomień (kolumna na core.profiles +
      // odtworzenie widoku-mostka n2click.profiles). Bez nowych polityk RLS.
      '20260803100000_profiles_notifications_read_ids.sql',
      // Wydarzenia urlopowe: kolumny `kind`/`end_date` na n2click.events
      // (addytywne, bez zmian RLS — `EXPECTED_POLICIES` zostaje bez zmian).
      '20260803120000_events_vacation.sql',
      '20260803150000_n2click_profiles_only_app_members.sql',
      '20260803151000_profiles_view_app_member_helper.sql',
      // Moduł Content Plan (faza R1): własny schemat `contentplan` — tabele
      // + RLS, polityki, widok-mostek `my_access`, seed grantów w app_access.
      '20260803160000_contentplan_schema_and_tables.sql',
      '20260803160100_contentplan_rls_policies.sql',
      '20260803160200_contentplan_my_access_view.sql',
      '20260803160300_contentplan_seed_app_access.sql',
      // Content Plan (faza R6): jednorazowy import danych live Tetra Wave —
      // SAME wiersze (brands/posts/post_channels), zero zmian schematu i RLS.
      // Plik jest generowany przez `scripts/contentplan-seed-tws.mjs`.
      '20260803170000_contentplan_seed_tws.sql',
      // Przywrócenie filtra core.app_member na widoku n2click.profiles —
      // do żywej bazy 20260803100000 trafiła PÓŹNIEJ niż
      // n2click_profiles_only_app_members i odtworzyła widok bez filtra.
      '20260804090000_restore_n2click_profiles_app_member_filter.sql',
      // Portal klienta: przypięcia marek do kont (brand_members), predykaty
      // roli client przepisane na członkostwo i RPC client_review — jedyna
      // ścieżka zapisu klienta (Akceptacja/Uwagi na opublikowanym poście).
      '20260804120000_contentplan_brand_members_client_review.sql',
      // Utajniona treść (zarząd): addytywna kolumna `is_confidential` na
      // n2click.tasks/projects/events. Maskowanie WYŁĄCZNIE po stronie klienta
      // (src/store/confidentiality.ts) — zero zmian RLS.
      '20260805120000_confidential_content.sql',
      // Wytyczne dla grafika (zakładka DESIGN edytora publikacji): addytywna
      // kolumna `design_brief` na contentplan.posts, default ''.
      '20260810120000_contentplan_design_brief.sql',
      // AUTH-03: trigger synchronizujący core.profiles.access_role →
      // core.app_access (n2click role update; contentplan grant/revoke tylko
      // wierszy role='admin') + backfill dryfu. Zero nowych tabel i polityk.
      '20260811130000_profiles_access_role_sync_app_access.sql',
      // Korekta grantu contentplan: `do nothing` zamiast nadpisania —
      // istniejący wiersz portalowego klienta (role='client') przeżywa rundę
      // awans+degradacja administratora. Tylko funkcja, zero zmian danych.
      '20260811150000_contentplan_admin_grant_preserves_client.sql',
      // Nieobecność per (wystąpienie, osoba) wydarzenia cyklicznego: addytywna
      // kolumna jsonb `absences` na n2click.events, zero zmian RLS.
      '20260811160000_events_absences.sql',
      // RSVP (jak w Google Meet): rename kolumny absences→rsvps; statusy
      // yes/no, brak wpisu = oczekuje; wpisy legacy bez `status` czytane
      // jako 'no' po stronie klienta. Zero zmian danych i RLS.
      '20260811170000_events_rsvps_rename.sql',
      // Czat wewnętrzny: n2click.conversations / conversation_members /
      // messages + helpery `app.*`, triggery Broadcast i RPC chat_overview.
      // Tabele ŚWIADOMIE poza publikacją `supabase_realtime` (postgres_changes
      // wyzwalałoby pełną rehydrację plannera) — na żywo idzie Broadcast,
      // autoryzowany politykami `chat_*` na `realtime.messages`.
      '20260813180000_chat.sql',
      // Hardening czatu z przeglądu: granty kolumnowe UPDATE (członkostwa nie
      // da się przepiąć na cudzą rozmowę, wiadomości nie da się przenieść)
      // + kanał osobisty `chat:user:<uuid>` (nowe rozmowy docierają na żywo).
      '20260813190000_chat_membership_hardening.sql',
      // Stempel rewizji: każda zmiana `body` podbija `edited_at` z zegara
      // serwera — bez tego remis rewizji był po stronie klienta
      // nierozstrzygalny (cofnięcie edycji albo jej zignorowanie).
      '20260813200000_chat_edit_stamp.sql',
      // Rewizja w całości własnością serwera: klient nie ustawi ani nie
      // wyczyści `edited_at` (przepisywany ze starego wiersza poza edycją
      // treści), kasowanie miękkie terminalne także na serwerze.
      '20260813210000_chat_revision_ownership.sql',
      // Monotoniczność rewizji per wiadomość: stempel edycji nigdy nie jest
      // <= poprzedniego znacznika, nawet przy cofniętym zegarze (NTP/failover).
      '20260813220000_chat_revision_monotonic.sql',
      // Stemple INSERT: klient nie wstawi wiersza z własnym created_at /
      // edited_at / deleted_at / last_read_at / muted_until / last_message_at
      // — wszystkie znaczniki rodzą się z zegara serwera.
      '20260813230000_chat_insert_stamps.sql',
      // Atomowe tworzenie grupy (RPC, security invoker): grupa nie ma
      // direct_key, więc częściowy zapis składu nie miał ścieżki naprawy.
      '20260813240000_chat_create_group_rpc.sql',
      // Poufność DM: direct_key musi być kanoniczną parą zawierającą
      // zakładającego, a członkiem rozmowy 1:1 jest wyłącznie strona pary
      // (koniec zawłaszczania klucza cudzej pary i wyroczni istnienia).
      '20260813250000_chat_direct_key_integrity.sql',
      // Atomowe otwarcie DM-u (RPC, security definer): znajdź-albo-załóż
      // rozmowę pary + naprawa brakujących członków obu stron — koniec
      // zakleszczenia osieroconego DM-u dla nie-twórcy (zgłoszenie 2026-08-24).
      '20260824120000_chat_open_direct_rpc.sql',
      // Fix zakleszczenia z przeglądu: członkowie DM-u wstawiani w porządku
      // kanonicznym pary (jedna kolejność blokad po obu stronach), każdy
      // wiersz pod własnym handlerem unique_violation.
      '20260824130000_chat_open_direct_member_lock_order.sql',
      // Reakcje emoji (model Messengera: jedna na osobę i wiadomość): allowlista
      // `chat_emoji` (FK zamiast regexu), tabela `message_reactions` tylko do
      // odczytu dla klienta, zapis przez definer `chat_set_reaction`, własny
      // event `reaction` przez `realtime.send` na kanale rozmowy.
      '20260825120000_chat_reactions.sql',
      // Motywy czatu (wspólne dla rozmowy): `conversations.theme_id`,
      // `messages.kind`/`meta` (wiersz systemowy przez RPC, klient wstawia
      // tylko `text`), definer `chat_set_theme` z eventem `theme_changed`,
      // `chat_overview()` odtworzone z `theme_id`.
      '20260825130000_chat_themes.sql',
      // Import Kalendarza Google (tylko odczyt): google_accounts (refresh token
      // w Vault przez definerów tylko dla service_role), google_calendars,
      // google_calendar_events (warstwa cieniowa, nigdy `events`), widok
      // maskujący dla zespołu, pg_cron co 5 min -> Edge Function sync.
      '20260825140000_google_calendar.sql',
      '20260902160000_google_events_visible_stable_id.sql',
      // Osobiste czasy wystąpień spotkań (per dzień i osoba) — addytywna
      // kolumna `personal_times` jsonb na n2click.events; nieobecność jako
      // drugi rodzaj nieobecności (CHECK `events_kind_check` rozszerzony).
      // Bez zmian RLS.
      '20260915120000_events_personal_times_and_absence_kind.sql',
      '20261005085434_service_role_app_schema.sql',
      // Karta zadania v2 (docs/karta-v2/SPEC.md): rozmowa zadania = rozmowa
      // czatu z context_type 'task' (załączniki, wzmianki, przypięcia, RPC
      // chat_open_task / chat_set_pin / chat_set_follow, broadcast `read`),
      // prywatny bucket chat-attachments, import komentarzy zadań BEZ
      // powiadomień i trigger powiadomień task_message / task_mention.
      '20261102100000_task_conversations.sql',
      '20261102101000_task_chat_storage.sql',
      '20261102102000_task_chat_backfill.sql',
      '20261102103000_task_chat_notifications.sql',
    ]);
  });

  it('nazwy mają format YYYYMMDDHHMMSS_opis.sql, a wersje są unikalne', () => {
    const versions = files.map((f) => {
      const match = f.name.match(/^(\d{14})_[a-z0-9_]+\.sql$/);
      expect(match, `Zła nazwa migracji: ${f.name}`).not.toBeNull();
      return match![1];
    });
    expect(new Set(versions).size).toBe(versions.length);
  });
});

describe('deny-by-default: RLS na każdej tabeli', () => {
  it('każda tabela w public ma enable row level security w pliku, który ją tworzy', () => {
    for (const { name, sql } of files) {
      const normalized = normalize(sql);
      const created = [...normalized.matchAll(/create table (public\.[a-z_]+)/g)].map((m) => m[1]);
      for (const table of created) {
        expect(
          normalized,
          `${name}: brak enable row level security dla ${table}`,
        ).toContain(`alter table ${table} enable row level security`);
      }
    }
  });

  it('nigdzie nie ma force row level security (rekursja funkcji definer)', () => {
    expect(allSql).not.toContain('force row level security');
  });

  it('rola anon traci domyślne uprawnienia do każdej naszej tabeli', () => {
    // Kolejne migracje tylko-do-przodu odbierają anon dostęp we WŁASNYCH plikach,
    // więc sumujemy wszystkie klauzule `revoke ... from anon` (rdzeń + słowniki).
    // Schemat `n2click` ma `alter default privileges ... grant all on tables to
    // anon`, więc świeża tabela dostaje tam ALL (z TRUNCATE, który omija RLS) —
    // jawny revoke jest jedyną rzeczą, która ją zamyka.
    const revoked = [...allSql.matchAll(/revoke all on ([a-z0-9_.,\s]+) from anon/g)]
      .map((m) => m[1])
      .join(' ');
    expect(revoked.length).toBeGreaterThan(0);
    for (const table of Object.keys(EXPECTED_POLICIES)) {
      // `storage.*` i `realtime.*` to tabele platformowe — grantów Supabase nie
      // przestawiamy, sterujemy tam wyłącznie politykami.
      if (table.startsWith('storage.') || table.startsWith('realtime.')) continue;
      expect(revoked).toContain(table);
    }
  });
});

describe('hardening funkcji pomocniczych', () => {
  const functionBlocks = allSql.match(/create function[\s\S]*?\$\$;/g) ?? [];

  it('migracje definiują funkcje pomocnicze', () => {
    expect(functionBlocks.length).toBeGreaterThanOrEqual(10);
  });

  it("każda funkcja ustawia set search_path = ''", () => {
    for (const block of functionBlocks) {
      expect(block, `Funkcja bez search_path: ${block.slice(0, 80)}`).toContain(
        "set search_path = ''",
      );
    }
  });

  it('każda funkcja security definer jest stable (odczyt, nie mutacja)', () => {
    for (const block of functionBlocks) {
      if (block.includes('security definer')) {
        expect(block, `Definer bez stable: ${block.slice(0, 80)}`).toContain('stable');
      }
    }
  });

  it('EXECUTE w schemacie app: odebrane PUBLIC, nadane authenticated', () => {
    expect(allSql).toContain('revoke all on all functions in schema app from public');
    expect(allSql).toContain('grant execute on all functions in schema app to authenticated');
  });
});

describe('polityki RLS', () => {
  it('każdy nagłówek polityki jest zgodny z konwencją (parsowalny)', () => {
    expect(unparsedPolicies).toEqual([]);
  });

  it('każda polityka jest wyłącznie to authenticated (nigdy anon/public)', () => {
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy.roles, `Polityka ${policy.name} ma role: ${policy.roles}`).toBe('authenticated');
    }
  });

  it('pokrywa każdą tabelę rdzenia wymaganymi komendami', () => {
    for (const [table, commands] of Object.entries(EXPECTED_POLICIES)) {
      const covered = policies.filter((p) => p.table === table).map((p) => p.command);
      for (const command of commands) {
        expect(covered, `${table}: brak polityki for ${command}`).toContain(command);
      }
    }
  });

  it('nie ma polityk na tabelach spoza spodziewanego zbioru', () => {
    const known = new Set(Object.keys(EXPECTED_POLICIES));
    for (const policy of policies) {
      expect(known.has(policy.table), `Polityka na nieznanej tabeli: ${policy.table}`).toBe(true);
    }
  });

  it('każda polityka insert/update ma with check', () => {
    for (const policy of policies) {
      if (policy.command === 'insert' || policy.command === 'update') {
        expect(policy.statement, `${policy.name}: brak with check`).toContain('with check');
      }
    }
  });
});

describe('storage: prywatne awatary', () => {
  // Polityki Storage żyją w pliku RLS rdzenia — wskazujemy go po nazwie, bo
  // kolejne migracje tylko-do-przodu (np. ALTER kolumny) sortują się później.
  const rlsFile = normalize(
    files.find((f) => f.name === '20260715210500_rls_policies.sql')?.sql ?? '',
  );

  it('bucket avatars powstaje jako prywatny i jest wymuszany na prywatny', () => {
    expect(rlsFile).toContain("values ('avatars', 'avatars', false)");
    expect(rlsFile).toContain('on conflict (id) do update set public = false');
  });

  it('typ owner_id jest walidowany PRZED politykami storage.objects', () => {
    const validationAt = rlsFile.indexOf("column_name = 'owner_id'");
    const firstStoragePolicyAt = rlsFile.indexOf('on storage.objects');
    expect(validationAt).toBeGreaterThan(-1);
    expect(firstStoragePolicyAt).toBeGreaterThan(-1);
    expect(validationAt).toBeLessThan(firstStoragePolicyAt);
  });

  it('polityki zapisu wiążą folder ścieżki z owner_id wgrywającego', () => {
    const writes = policies.filter(
      (p) => p.table === 'storage.objects' && p.name.startsWith('avatars_') && p.command !== 'select',
    );
    expect(writes.length).toBeGreaterThanOrEqual(3);
    for (const policy of writes) {
      expect(policy.statement).toContain("split_part(name, '/', 1) = (select auth.uid())::text");
      expect(policy.statement).toContain('owner_id = (select auth.uid())::text');
    }
  });
});

describe('karta zadania v2: rozmowy zadań, załączniki, powiadomienia', () => {
  const kartaFiles = files.filter((f) => f.name.startsWith('20261102'));
  const sqlOf = (name: string): string =>
    normalize(files.find((f) => f.name === name)?.sql ?? '');
  const conversations = sqlOf('20261102100000_task_conversations.sql');
  const storage = sqlOf('20261102101000_task_chat_storage.sql');
  const backfill = sqlOf('20261102102000_task_chat_backfill.sql');
  const notify = sqlOf('20261102103000_task_chat_notifications.sql');
  const kartaSql = kartaFiles.map((f) => normalize(f.sql)).join(' ');

  /** Ciało funkcji `schema.name(` od nagłówka do zamykającego `$$;`. */
  function functionBody(sql: string, qualifiedName: string): string {
    const start = sql.indexOf(`create or replace function ${qualifiedName}(`);
    expect(start, `brak funkcji ${qualifiedName}`).toBeGreaterThan(-1);
    const end = sql.indexOf('$$;', sql.indexOf('$$', start) + 2);
    return sql.slice(start, end + 3);
  }

  it('wszystkie cztery pliki istnieją i nie zawierają jawnych begin/commit', () => {
    expect(kartaFiles.map((f) => f.name)).toHaveLength(4);
    for (const f of kartaFiles) {
      expect(normalize(f.sql), f.name).not.toMatch(/(^|;)\s*(begin|commit)\s*;/);
    }
  });

  it("każda nowa funkcja ma set search_path = '' i nikt nie dostaje EXECUTE jako anon", () => {
    const blocks = kartaSql.match(/create or replace function[\s\S]*?\$\$;/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(12);
    for (const block of blocks) {
      expect(block, block.slice(0, 90)).toContain("set search_path = ''");
    }
    expect(kartaSql).not.toMatch(/grant execute on function [^;]* to [^;]*\banon\b/);
  });

  it('chat_open_task: definer, reguła tasks_select, bez anon', () => {
    const body = functionBody(conversations, 'n2click.chat_open_task');
    expect(body).toContain('security definer');
    expect(body).toContain('app.chat_can_read_task(p_task_id)');
    expect(body).toContain("errcode = '42501'");
    expect(conversations).toContain('revoke all on function n2click.chat_open_task(uuid) from public, anon');

    // Lustro polityki tasks_select: has_app + (admin | manager | przypisany) + spółka projektu.
    const rule = functionBody(conversations, 'app.chat_can_read_task');
    for (const part of [
      "core.has_app('n2click')",
      'app.is_administrator()',
      'app.is_manager()',
      'app.is_assigned_to_task(t.id)',
      'app.company_ok_project(t.project_id)',
    ]) {
      expect(rule).toContain(part);
    }
  });

  it('członkostwo w rozmowie zadania wymaga bieżącego wglądu w zadanie', () => {
    const member = functionBody(conversations, 'app.is_conversation_member');
    expect(member).toContain("c.context_type is distinct from 'task' or app.chat_can_read_task(c.context_id)");
  });

  it('wyrocznia „czy osoba X widzi zadanie” nie jest wystawiona klientom', () => {
    expect(conversations).toContain(
      'revoke all on function app.chat_user_can_read_task(uuid, uuid) from public, anon, authenticated',
    );
    expect(kartaSql).not.toMatch(/grant execute on function app\.chat_user_can_read_task\(uuid, uuid\) to [^;]*authenticated/);
    expect(kartaSql).not.toMatch(/grant execute on function app\.chat_can_read_task\(uuid\) to [^;]*authenticated/);
  });

  it('rozmowy zadań nie powstają ani nie dostają członków przez ogólne API', () => {
    const insertConv = policies.find((p) => p.name === 'chat_conversations_insert' && p.statement.includes("'task'"));
    expect(insertConv?.statement).toContain("context_type is distinct from 'task'");
    const insertMember = policies.filter((p) => p.name === 'chat_conversation_members_insert').pop();
    expect(insertMember?.statement).toContain('not app.chat_is_task_conversation(conversation_id)');
  });

  it('klient nie edytuje załączników, wzmianek, przypięć ani reply_to', () => {
    expect(kartaSql).not.toMatch(/grant update \([^)]*(attachments|mention_ids|pinned_at|pinned_by|reply_to)/);
  });

  it('ścieżka załącznika jest sprawdzana po stronie serwera', () => {
    const body = functionBody(conversations, 'n2click.chat_validate_message_content');
    expect(body).toContain("new.conversation_id::text || '/'");
    expect(body).toContain('new.pinned_at := null');
    expect(conversations).toContain('before insert on n2click.messages for each row execute function n2click.chat_validate_message_content()');
  });

  it('auto-obserwujący tylko w rozmowach zadań i przed triggerem powiadomień', () => {
    const body = functionBody(conversations, 'n2click.chat_message_auto_members');
    expect(body).toContain("c.context_type = 'task'");
    expect(body).toContain('app.chat_user_can_read_task(u.uid, v_task)');
    expect(body).toContain('on conflict (conversation_id, user_id) do nothing');
    expect('chat_messages_auto_members' < 'chat_messages_notify_task').toBe(true);
  });

  it('odczyt rozsyła event `read` na kanale rozmowy', () => {
    const body = functionBody(conversations, 'n2click.chat_broadcast_read');
    expect(body).toContain("'read', 'chat:conv:' || new.conversation_id::text, true");
    expect(conversations).toContain('after update of last_read_at on n2click.conversation_members');
  });

  it('chat_overview zwraca muted_until członków', () => {
    expect(functionBody(conversations, 'n2click.chat_overview')).toContain("'muted_until', mem.muted_until");
  });

  it('bucket chat-attachments: prywatny, 10 MB, obrazy bez SVG, bez UPDATE', () => {
    expect(storage).toContain("'chat-attachments', 'chat-attachments', false, 10485760");
    expect(storage).toContain("array['image/webp', 'image/png', 'image/jpeg', 'image/gif']");
    expect(storage).not.toContain('svg');
    expect(storage.indexOf("column_name = 'owner_id'")).toBeLessThan(storage.indexOf('on storage.objects'));
    const chatStorage = policies.filter((p) => p.name.startsWith('chat_attachments_'));
    expect(chatStorage.map((p) => p.command).sort()).toEqual(['delete', 'insert', 'select']);
    for (const p of chatStorage) expect(p.statement).toContain("bucket_id = 'chat-attachments'");
    const insert = chatStorage.find((p) => p.command === 'insert')!;
    expect(insert.statement).toContain('owner_id = (select auth.uid())::text');
    expect(insert.statement).toContain('app.chat_attachment_member(name)');
    expect(chatStorage.find((p) => p.command === 'select')!.statement).toContain('app.chat_attachment_member(name)');
    expect(chatStorage.find((p) => p.command === 'delete')!.statement).toContain('owner_id = (select auth.uid())::text');
  });

  it('backfill nie kasuje komentarzy i nie tworzy powiadomień', () => {
    expect(backfill).not.toMatch(/delete from|truncate|drop table/);
    expect(backfill).not.toContain('n2click.notifications');
    expect(backfill).toContain('disable trigger chat_messages_notify_task');
    expect(backfill).toContain('disable trigger chat_messages_stamp_insert');
    expect(backfill).toContain('on conflict (id) do nothing');
    // Trigger powiadomień powstaje dopiero w pliku PO backfillu.
    expect(backfill).not.toContain('create trigger');
    expect(files.findIndex((f) => f.name === '20261102102000_task_chat_backfill.sql')).toBeLessThan(
      files.findIndex((f) => f.name === '20261102103000_task_chat_notifications.sql'),
    );
  });

  it('powiadomienia: wzmianka wygrywa, odbiorca widzi zadanie, bez maila', () => {
    const body = functionBody(notify, 'n2click.chat_notify_task_message');
    expect(body).toContain("case when m.user_id = any(new.mention_ids) then 'task_mention' else 'task_message' end");
    expect(body).toContain('m.user_id <> new.author_id');
    expect(body).toContain('app.chat_user_can_read_task(m.user_id, v_task)');
    expect(body).toContain('emailed_at');
    expect(notify).toContain('after insert on n2click.messages for each row execute function n2click.chat_notify_task_message()');
  });

  it('klient nie podrobi task_message / task_mention', () => {
    const insert = policies.filter((p) => p.name === 'notifications_insert').pop();
    expect(insert?.table).toBe('n2click.notifications');
    expect(insert?.statement).toContain("type in ('task_assigned', 'project_comment', 'bin_item')");
  });
});
