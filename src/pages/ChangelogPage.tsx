// Changelog — pełna historia zmian i aktualizacji huba. Czyta statyczną
// tablicę CHANGELOG (jedyne źródło prawdy, src/data/changelog.ts) i renderuje
// wszystkie wpisy od najnowszego, reużywając ChangelogEntryBlock z popoutu
// na Panelu. Strona jest czysto prezentacyjna: bez stanu, mutacji i persystencji.
import { CHANGELOG } from '../data/changelog';
import { ChangelogEntryBlock } from '../components/ChangelogModal';

export function ChangelogPage() {
  return (
    <section className="page">
      <div className="page-head">
        <h1>Changelog</h1>
      </div>
      <div className="changelog-page">
        <p className="changelog-page-intro">
          Wszystkie zmiany i aktualizacje wprowadzone w hubie — najnowsze u góry.
        </p>
        <div className="changelog-list">
          {CHANGELOG.map((entry) => (
            <ChangelogEntryBlock key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </section>
  );
}
