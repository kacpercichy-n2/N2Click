// Obszar „Zespół": hierarchia działów/osób z widocznością zależną od roli oraz
// administracyjne zakładanie kont przez zaufany endpoint provisioningu.
//
// Widoczność i walidacja żyją w czystym module `teamScope.ts` (testowalnym w
// node). Ta strona jest cienką warstwą prezentacji. Klienckie kontrole są
// wyłącznie UX — realny zakres i autoryzację wymusza serwer (RLS + Edge
// Function). Wszystkie stringi po polsku; NIGDY nie pokazujemy credentiali.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import { accessRoleForTitle, roleTitleOptions } from '../utils/roleTitles';
import { currentUser as currentUserSel, isImpersonating } from '../store/selectors';
import { useAuth } from '../auth/SessionProvider';
import { getSupabaseClient } from '../supabase/client';
import { provisionAccount } from '../supabase/provisioning';
import { useOrgData } from '../supabase/OrgDataProvider';
import { effectiveAccessRole } from '../supabase/referenceData';
import {
  PROVISION_ROLE_LABELS,
  buildCloudTeamHierarchy,
  buildProvisionRequest,
  buildTeamHierarchy,
  canViewTeam,
  cloudProfileName,
  emptyProvisionForm,
  teamAccessForUser,
  type ProvisionFormState,
  type TeamDepartmentView,
} from './teamScope';
import { TeamStructureTree, personForTreeNode } from './TeamStructureTree';
import type { Person } from '../types';
import type { AccessRole as ProvisionAccessRole } from '../../supabase/functions/provision-account/contract';

/** Tryb prezentacji obszaru Zespół: płaska lista działów vs drzewo struktury. */
type TeamView = 'list' | 'structure';

/** Serwerowa lista działów (UUID + nazwa) na potrzeby selectów formularza. */
interface ServerDepartment {
  id: string;
  name: string;
}
/** Serwerowy profil menedżera (UUID + nazwa + dział). */
interface ServerManager {
  id: string;
  name: string;
  departmentId: string | null;
}

type ServerListsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; departments: ServerDepartment[]; managers: ServerManager[] }
  | { status: 'error'; message: string };

export function TeamPage() {
  const { state } = useStore();
  const auth = useAuth();
  const org = useOrgData();
  const me = currentUserSel(state);
  const [view, setView] = useState<TeamView>('list');

  // Efektywna rola: w trybie supabase (samodzielnie, snapshot gotowy) rola z
  // chmury; w przeciwnym razie rola lokalna. Bramka nawigacji/trasy jest UX-owa.
  const effectiveRole = effectiveAccessRole(me, org.state, {
    mode: auth.mode,
    impersonating: isImpersonating(state),
  });
  const effectiveMe = me && effectiveRole ? { ...me, accessRole: effectiveRole } : me;

  // Gate UX: obszar niewidoczny dla worker (pracownik/handlowiec) → redirect.
  if (!canViewTeam(effectiveMe)) {
    return <Navigate to="/dashboard" replace />;
  }

  const isSupabase = auth.mode === 'supabase';

  // Zakładanie konta jest za jawną akcją i tylko dla lokalnego administratora w
  // trybie supabase. W trybie lokalnym pokazujemy krótką informację zamiast akcji.
  const isAdmin = me?.accessRole === 'administrator';
  const canProvision = isAdmin && isSupabase;

  return (
    <section className="page">
      <div className="page-head">
        <h1>Zespół</h1>
        <div className="cal-view-toggle" role="group" aria-label="Widok zespołu">
          <button
            type="button"
            className={`toggle-btn${view === 'list' ? ' active' : ''}`}
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            Lista
          </button>
          <button
            type="button"
            className={`toggle-btn${view === 'structure' ? ' active' : ''}`}
            aria-pressed={view === 'structure'}
            onClick={() => setView('structure')}
          >
            Struktura
          </button>
        </div>
      </div>

      {isSupabase ? (
        <CloudTeamHierarchy view={view} />
      ) : (
        <LocalTeamHierarchy
          view={view}
          people={scopedLocalPeople(state.people, teamAccessForUser(me))}
          groups={buildTeamHierarchy(state.people, state.departments, teamAccessForUser(me))}
        />
      )}

      {isAdmin && auth.mode !== 'supabase' && (
        <p className="field-hint team-provision-note">
          Zakładanie kont wymaga połączenia z serwerem. W trybie lokalnym ta akcja
          jest niedostępna.
        </p>
      )}

      {canProvision && <ProvisionSection />}
    </section>
  );
}

/**
 * Edycja przełożonego (tylko administrator, tryb supabase). Prawdę wymusza
 * serwer: polityka `profiles_update_self_or_admin` + trigger
 * `app.protect_profile_privileges` (kolumna admin-only) — select jest UX-em.
 */
interface SupervisorEdit {
  options: Array<{ id: string; name: string }>;
  valueById: Map<string, string>;
  busyId: string | null;
  onChange: (personId: string, supervisorId: string) => void;
}

/** Wspólna prezentacja pogrupowanej hierarchii (lokalna i chmurowa). */
function HierarchyGroups({
  groups,
  supervisorEdit,
}: {
  groups: TeamDepartmentView[];
  supervisorEdit?: SupervisorEdit;
}) {
  if (groups.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-title">Brak osób do wyświetlenia</p>
        <p className="empty-hint">
          Twoja rola nie obejmuje żadnego działu z przypisanymi osobami.
        </p>
      </div>
    );
  }
  return (
    <div className="team-hierarchy">
      {groups.map((dept) => (
        <div key={dept.id || '__none'} className="team-dept">
          <h2 className="team-dept-name">{dept.name}</h2>
          {dept.people.length === 0 ? (
            <p className="field-hint">Brak osób w tym dziale.</p>
          ) : (
            <ul className="team-person-list">
              {dept.people.map((p) => (
                <li key={p.id} className="team-person">
                  <span className="team-person-name">{p.name}</span>
                  <span className="team-person-contact">
                    {p.email && (
                      <a
                        className="team-person-email"
                        href={`mailto:${p.email}`}
                        title={`Napisz e-mail do ${p.name}`}
                      >
                        {p.email}
                      </a>
                    )}
                    {p.phone && (
                      <a
                        className="team-person-phone"
                        href={`tel:${p.phone.replace(/\s+/g, '')}`}
                        title={`Zadzwoń do ${p.name}`}
                      >
                        {p.phone}
                      </a>
                    )}
                  </span>
                  <span className="team-person-meta">
                    {p.roleTitle && <span className="team-person-role">{p.roleTitle}</span>}
                    <span className="team-person-access">{p.accessRoleLabel}</span>
                    {!supervisorEdit && p.supervisorName && (
                      <span className="team-person-sup">Przełożony: {p.supervisorName}</span>
                    )}
                    {supervisorEdit && (
                      <label className="team-person-sup">
                        Przełożony:{' '}
                        <select
                          value={supervisorEdit.valueById.get(p.id) ?? ''}
                          disabled={supervisorEdit.busyId !== null}
                          onChange={(e) => supervisorEdit.onChange(p.id, e.target.value)}
                        >
                          <option value="">—</option>
                          {supervisorEdit.options
                            .filter((o) => o.id !== p.id)
                            .map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Osoby lokalnego store'u zawężone do zakresu roli (administrator: wszyscy,
 * menedżer: własny dział). Ten sam zbiór, na którym budujemy zarówno listę, jak
 * i drzewo struktury — spójność między widokami.
 */
function scopedLocalPeople(people: Person[], access: ReturnType<typeof teamAccessForUser>): Person[] {
  if (!access.visible) return [];
  if (access.scope === 'all') return people;
  return people.filter((p) => p.departmentId === access.departmentId);
}

/** Hierarchia z lokalnego store'u (tryb lokalny): lista albo drzewo struktury. */
function LocalTeamHierarchy({
  view,
  people,
  groups,
}: {
  view: TeamView;
  people: Person[];
  groups: TeamDepartmentView[];
}) {
  if (view === 'structure') return <TeamStructureTree people={people} />;
  return <HierarchyGroups groups={groups} />;
}

/**
 * Hierarchia zbudowana z RLS-owego snapshotu chmury (tryb supabase). RLS już
 * scope'uje wiersze (admin: wszystko, menedżer: własny dział, pracownik: siebie)
 * — tu wyłącznie grupujemy. Polskie stany ładowania/błędu/pustki.
 */
function CloudTeamHierarchy({ view }: { view: TeamView }) {
  const { state, reload } = useOrgData();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [supError, setSupError] = useState<string | null>(null);

  if (state.status === 'idle' || state.status === 'loading') {
    return <p className="field-hint">Wczytywanie zespołu…</p>;
  }
  if (state.status === 'error') {
    return (
      <div className="empty-state">
        <p className="field-error">{state.message}</p>
        <button type="button" className="btn ghost" onClick={reload}>
          Spróbuj ponownie
        </button>
      </div>
    );
  }

  const { profiles, departments, profile } = state.snapshot;
  const isCloudAdmin = profile?.cloudRole === 'administrator';

  // Widok „Struktura": drzewo z relacji supervisor_id nad już zscope'owanymi
  // (RLS) profilami chmury. Konwersja CloudProfile → Person tylko na potrzeby
  // awatara i linku profilu; edycja przełożonego pozostaje w widoku listy.
  if (view === 'structure') {
    const treePeople = profiles.map((p) =>
      personForTreeNode({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        name: cloudProfileName(p),
        email: p.email,
        avatar: p.avatar,
        role: p.roleTitle,
        supervisorId: p.supervisorId ?? '',
      }),
    );
    return <TeamStructureTree people={treePeople} />;
  }

  // Edycja przełożonego tylko dla administratora chmury; RLS + trigger
  // `app.protect_profile_privileges` egzekwują to samo po stronie serwera.
  const supervisorEdit: SupervisorEdit | undefined = isCloudAdmin
    ? {
        options: profiles
          .map((p) => ({ id: p.id, name: cloudProfileName(p) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        valueById: new Map(profiles.map((p) => [p.id, p.supervisorId ?? ''])),
        busyId,
        onChange: (personId, supervisorId) => {
          if (busyId) return;
          setBusyId(personId);
          setSupError(null);
          void (async () => {
            try {
              const { error } = await getSupabaseClient()
                .from('profiles')
                .update({ supervisor_id: supervisorId || null })
                .eq('id', personId);
              if (error) {
                setSupError('Nie udało się zapisać przełożonego. Spróbuj ponownie.');
              } else {
                reload();
              }
            } catch {
              setSupError('Nie udało się zapisać przełożonego. Spróbuj ponownie.');
            } finally {
              setBusyId(null);
            }
          })();
        },
      }
    : undefined;

  return (
    <>
      {supError && (
        <p className="field-error" role="alert">
          {supError}
        </p>
      )}
      <HierarchyGroups
        groups={buildCloudTeamHierarchy(profiles, departments)}
        supervisorEdit={supervisorEdit}
      />
    </>
  );
}

/** Sekcja zakładania konta — formularz rozwijany jawną akcją administratora. */
function ProvisionSection() {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProvisionFormState>(emptyProvisionForm);
  const [lists, setLists] = useState<ServerListsState>({ status: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Po rozwinięciu formularza pobieramy serwerowe listy działów i menedżerów
  // (UUID-y wymagane przez endpoint). Polski stan ładowania/błędu.
  useEffect(() => {
    if (!open || lists.status !== 'idle') return;
    let cancelled = false;
    setLists({ status: 'loading' });
    void (async () => {
      try {
        const client = getSupabaseClient();
        const [depRes, mgrRes] = await Promise.all([
          client.from('departments').select('id, name').order('name'),
          client
            .from('profiles')
            .select('id, first_name, last_name, department_id')
            .eq('access_role', 'manager'),
        ]);
        if (cancelled) return;
        if (depRes.error || mgrRes.error) {
          setLists({ status: 'error', message: 'Nie udało się wczytać działów i menedżerów.' });
          return;
        }
        const departments: ServerDepartment[] = (depRes.data ?? []).map((d) => ({
          id: String(d.id),
          name: String(d.name),
        }));
        const managers: ServerManager[] = (mgrRes.data ?? []).map((m) => ({
          id: String(m.id),
          name: `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || 'Menedżer',
          departmentId: m.department_id ? String(m.department_id) : null,
        }));
        setLists({ status: 'ready', departments, managers });
      } catch {
        if (!cancelled) {
          setLists({ status: 'error', message: 'Nie udało się wczytać działów i menedżerów.' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, lists.status]);

  const set = <K extends keyof ProvisionFormState>(key: K, value: ProvisionFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
    setSuccess(null);
  };

  // Menedżerowie wybranego działu (relacja wymuszana też przez serwer).
  const managersForDept = useMemo(() => {
    if (lists.status !== 'ready') return [];
    if (!form.departmentId) return lists.managers;
    return lists.managers.filter((m) => m.departmentId === form.departmentId);
  }, [lists, form.departmentId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setSuccess(null);

    const parsed = buildProvisionRequest(form);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // access_token bieżącej sesji — pobierany w miejscu użycia, nigdy logowany.
      const { data } = await getSupabaseClient().auth.getSession();
      const accessToken = data.session?.access_token ?? '';
      const result = await provisionAccount(parsed.value, {
        fetch: window.fetch.bind(window),
        accessToken,
        env: import.meta.env as unknown as Record<string, string | undefined>,
      });
      if (result.ok) {
        setForm(emptyProvisionForm());
        setSuccess(result.message);
        setOpen(false);
      } else {
        setError(result.message);
      }
    } catch {
      setError('Nie udało się utworzyć konta. Spróbuj ponownie później.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="editor-section team-provision">
      <h2>Zakładanie konta</h2>
      {!open ? (
        <>
          {success && (
            <p className="field-hint" role="status">
              {success}
            </p>
          )}
          <p className="field-hint">
            Utwórz konto nowego członka zespołu. Konto otrzyma bazowe hasło
            startowe, które użytkownik musi zmienić przy pierwszym logowaniu.
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setOpen(true);
              setSuccess(null);
            }}
          >
            Utwórz konto
          </button>
        </>
      ) : (
        <form className="person-form team-provision-form" onSubmit={(e) => void submit(e)}>
          <div className="field">
            <label htmlFor="t-first">Imię *</label>
            <input
              id="t-first"
              value={form.firstName}
              onChange={(e) => set('firstName', e.target.value)}
              placeholder="np. Anna"
            />
          </div>
          <div className="field">
            <label htmlFor="t-last">Nazwisko</label>
            <input
              id="t-last"
              value={form.lastName}
              onChange={(e) => set('lastName', e.target.value)}
              placeholder="opcjonalnie"
            />
          </div>
          <div className="field">
            <label htmlFor="t-email">E-mail firmowy *</label>
            <input
              id="t-email"
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="np. anna@firma.pl"
            />
          </div>
          <div className="field">
            <label htmlFor="t-role-title">Stanowisko</label>
            <select
              id="t-role-title"
              value={form.roleTitle}
              onChange={(e) => {
                const title = e.target.value;
                // Sprzężenie stanowisko → rola dostępu (chmurowe nazwy:
                // Menadżer → manager, Specjalista → worker); wybranego
                // ręcznie administratora nigdy nie degradujemy.
                const derived = accessRoleForTitle(title);
                setForm((f) => ({
                  ...f,
                  roleTitle: title,
                  ...(derived && f.accessRole !== 'administrator'
                    ? { accessRole: (derived === 'pm' ? 'manager' : 'worker') as ProvisionAccessRole }
                    : {}),
                }));
              }}
            >
              <option value="">—</option>
              {roleTitleOptions(state.departments, form.roleTitle).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="t-access">Rola dostępu *</label>
            <select
              id="t-access"
              value={form.accessRole}
              onChange={(e) => set('accessRole', e.target.value as ProvisionAccessRole)}
            >
              {(Object.keys(PROVISION_ROLE_LABELS) as ProvisionAccessRole[]).map((r) => (
                <option key={r} value={r}>
                  {PROVISION_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="t-dept">Dział</label>
            <select
              id="t-dept"
              value={form.departmentId}
              disabled={lists.status !== 'ready'}
              onChange={(e) => {
                const departmentId = e.target.value;
                setForm((f) => ({ ...f, departmentId, managerProfileId: '' }));
                setError(null);
                setSuccess(null);
              }}
            >
              <option value="">—</option>
              {lists.status === 'ready' &&
                lists.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="t-manager">Przełożony (menedżer)</label>
            <select
              id="t-manager"
              value={form.managerProfileId}
              disabled={lists.status !== 'ready'}
              onChange={(e) => set('managerProfileId', e.target.value)}
            >
              <option value="">—</option>
              {managersForDept.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {lists.status === 'loading' && (
            <p className="field-hint">Wczytywanie działów i menedżerów…</p>
          )}
          {lists.status === 'error' && <p className="field-error">{lists.message}</p>}
          {error && <p className="field-error inline">{error}</p>}

          <div className="team-provision-actions">
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Tworzenie…' : 'Utwórz konto'}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setForm(emptyProvisionForm());
                setError(null);
              }}
            >
              Anuluj
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
