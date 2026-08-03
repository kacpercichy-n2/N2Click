// Czysta bramka widoczności modułu „Content plan" (trasa /content-plan) —
// wzorzec `teamScope.ts`: zero Reacta, zero DOM-u, zero localStorage, więc całość
// da się przetestować w środowisku node (patrz vitest.config.ts).
//
// TO JEST BRAMKA UX, NIGDY GRANICA BEZPIECZEŃSTWA. Realny zakres wymusza serwer
// (RLS na schemacie `contentplan`, polityki czytające core.has_app/core.app_role).
// Ten kod tylko pilnuje, żeby interfejs nie proponował miejsca, z którego
// użytkownik i tak zostanie odesłany.
//
// Decyzja operatora (2026-08-03, handoffs/content-plan-module-plan.md §2 pkt 4 i
// §4 pkt 3): na start moduł widzą WYŁĄCZNIE użytkownicy z rolą chmury
// `administrator`. Grant modułu (`contentplan.my_access`) jest już przyjmowany
// jako drugi argument, więc przyszła zmiana kryterium (np. „grant editor też
// widzi") to zmiana JEDNEJ funkcji, a nie wszystkich miejsc wywołania.
import type { Person } from '../types';
import type { AuthMode } from '../auth/mode';
import type { CloudRole, OrgState } from '../supabase/referenceData';

/**
 * Rola grantu modułu z wiersza `core.app_access` (app='contentplan'), czytana
 * przez widok-mostek `contentplan.my_access`. `null` = brak grantu ALBO tryb
 * lokalny (bez chmury nie ma czego czytać). Grant jeszcze nie jest ładowany do
 * snapshotu — do czasu fazy sync wywołujący podaje `null`.
 */
export type ContentPlanModuleRole = 'admin' | 'editor' | 'client';
export type ContentPlanModuleAccess = ContentPlanModuleRole | null;

/** Pytający: efektywna rola CHMURY bieżącego użytkownika (patrz `contentPlanViewer`). */
export interface ContentPlanViewer {
  role: CloudRole;
}

/**
 * Role chmury dopuszczone do modułu. Jedno źródło kryterium — zawężenie lub
 * poszerzenie widoczności to edycja tej stałej i testów obok.
 */
export const CONTENT_PLAN_ROLES: readonly CloudRole[] = ['administrator'];

/**
 * Efektywna rola chmury dla bramki modułu. Świadomie NIE korzysta z
 * `effectiveAccessRole`: tamta mapuje `manager` na `pelne` (kolaps ról planera),
 * a tutaj menedżer i administrator MUSZĄ być rozróżnialni.
 *
 * Kolejność źródeł jest ta sama co przy `/team`: w trybie supabase z gotowym
 * snapshotem rządzi `profile.cloudRole` (frontend nigdy nie czyta JWT), a w
 * trybie lokalnym / podczas ładowania / po błędzie zostaje lokalna `accessRole`
 * (`pelne` → administrator, `ograniczone` → worker). Brak lokalnej tożsamości =
 * `undefined` — nie ma kogo bramkować.
 */
export function contentPlanViewer(
  localUser: Person | undefined,
  org: OrgState,
  opts: { mode: AuthMode },
): ContentPlanViewer | undefined {
  if (!localUser) return undefined;
  if (opts.mode === 'supabase' && org.status === 'ready' && org.snapshot.profile) {
    return { role: org.snapshot.profile.cloudRole };
  }
  return { role: localUser.accessRole === 'ograniczone' ? 'worker' : 'administrator' };
}

/**
 * Czy moduł „Content plan" jest widoczny (pozycja w menu, paleta, trasa,
 * samo-guard strony). Brak użytkownika => false.
 *
 * `moduleAccess` jest CELOWO nieużywane w bieżącym kryterium: decyzja operatora
 * mówi „tylko administratorzy", niezależnie od tego, czy grant modułu istnieje.
 * Parametr zostaje w sygnaturze, żeby wpięcie grantu (faza sync) nie wymagało
 * dotykania wywołujących.
 */
export function canViewContentPlan(
  user: ContentPlanViewer | undefined,
  moduleAccess: ContentPlanModuleAccess,
): boolean {
  void moduleAccess;
  if (!user) return false;
  return CONTENT_PLAN_ROLES.includes(user.role);
}
