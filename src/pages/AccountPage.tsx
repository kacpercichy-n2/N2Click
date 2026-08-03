// Konto = pełny profil zalogowanego użytkownika (jeden adres: /account).
// Renderuje zintegrowany panel PersonProfile w trybie konta — dane osobowe,
// godziny pracy, tydzień, projekty, zadania i zmianę hasła (w trybie Supabase
// przez realne konto — patrz CloudPasswordSection). Dawne sekcje „Profil"
// (link), „Profil w chmurze" (duplikat danych profilu) i „Kolejność menu"
// (przeniesiona do Ustawień) nie istnieją. Wejścia na /people/<własne id>
// przekierowują tutaj (PersonProfilePage).
import { useStore } from '../store/AppStore';
import { PersonProfile } from './PersonProfilePage';

export function AccountPage() {
  const { state } = useStore();
  const person = state.people.find((p) => p.id === state.currentUserId);
  // Powłoka nie renderuje się bez zalogowanej tożsamości — to tylko siatka
  // bezpieczeństwa na niespójny stan (np. usunięta osoba).
  if (!person) {
    return (
      <section className="page">
        <div className="empty-state">
          <p className="empty-title">Brak profilu dla zalogowanego konta</p>
        </div>
      </section>
    );
  }
  return <PersonProfile key={person.id} personId={person.id} accountView />;
}
