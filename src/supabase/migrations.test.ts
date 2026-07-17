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
  const head = statement.match(
    /create policy "([^"]+)" on ([a-z_.]+) for (select|insert|update|delete|all) to ([a-z_, ]+?) (?=using|with)/,
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

  it('rola anon traci domyślne uprawnienia do każdej tabeli w public', () => {
    // Kolejne migracje tylko-do-przodu odbierają anon dostęp we WŁASNYCH plikach,
    // więc sumujemy wszystkie klauzule `revoke ... from anon` (rdzeń + słowniki).
    const revoked = [...allSql.matchAll(/revoke all on ([a-z_.,\s]+) from anon/g)]
      .map((m) => m[1])
      .join(' ');
    expect(revoked.length).toBeGreaterThan(0);
    for (const table of Object.keys(EXPECTED_POLICIES)) {
      if (table.startsWith('public.')) {
        expect(revoked).toContain(table);
      }
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
      (p) => p.table === 'storage.objects' && p.command !== 'select',
    );
    expect(writes.length).toBeGreaterThanOrEqual(3);
    for (const policy of writes) {
      expect(policy.statement).toContain("split_part(name, '/', 1) = (select auth.uid())::text");
      expect(policy.statement).toContain('owner_id = (select auth.uid())::text');
    }
  });
});
