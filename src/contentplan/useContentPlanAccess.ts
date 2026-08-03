// Cienka warstwa React nad czystą bramką `pages/contentPlanScope.ts`: zbiera
// trzy konteksty, których ta bramka potrzebuje (lokalna tożsamość ze store'u,
// tryb logowania, snapshot organizacji) i zwraca jedno `boolean`.
//
// Istnieje po to, żeby bramka miała JEDNO wyliczenie na całą aplikację: powłoka
// (`App.tsx` — filtr menu + `<Route>`), paleta wyszukiwania, edytor kolejności
// menu i samo-guard strony muszą odpowiadać dokładnie to samo. To bramka UX,
// nigdy granica bezpieczeństwa — autoryzacja żyje w RLS.
import { useStore } from '../store/AppStore';
import { useAuth } from '../auth/SessionProvider';
import { useOrgData } from '../supabase/OrgDataProvider';
import { canViewContentPlan, contentPlanViewer } from '../pages/contentPlanScope';

export function useContentPlanAccess(): boolean {
  const { state } = useStore();
  const { mode } = useAuth();
  const org = useOrgData();
  const currentUser = state.people.find((p) => p.id === state.currentUserId);
  // Grant modułu (`contentplan.my_access`) nie jest jeszcze ładowany do
  // snapshotu — do czasu fazy synchronizacji podajemy `null`. Bieżące kryterium
  // (tylko rola `administrator`) i tak go nie czyta.
  return canViewContentPlan(contentPlanViewer(currentUser, org.state, { mode }), null);
}
