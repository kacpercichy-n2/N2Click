// Popout dziennika zmian („Changelog"). Wzorzec jest ten sam co w TicketModal:
// scrim + viewport z zamknięciem po kliknięciu w tło, klawisz Escape zamyka,
// body dostaje `overflow: hidden`, a wejście/wyjście animuje AnimatePresence.
// W odróżnieniu od TicketModal nie chodzi tu o edycję danych, więc modal jest
// sterowany zwykłym stanem (`open`/`onClose`), bez parametru w URL i strażnika
// nawigacji.
import { useCallback } from 'react';
import { AnimatePresence } from 'motion/react';
import { CHANGELOG, changelogRangeLabel } from '../data/changelog';
import type { ChangelogEntry, ChangelogItem } from '../data/changelog';
import { IconButton } from './IconButton';
import { X } from './icons';
import { ModalFrame } from './ModalFrame';

/** Grupuje zmiany wpisu po panelu (`area`), zachowując kolejność pierwszego
 *  wystąpienia — bez sortowania alfabetycznego, żeby autor sam decydował o
 *  kolejności paneli w tablicy. */
function groupByArea(items: ChangelogItem[]): { area: string; items: ChangelogItem[] }[] {
  const groups: { area: string; items: ChangelogItem[] }[] = [];
  for (const item of items) {
    let group = groups.find((g) => g.area === item.area);
    if (!group) {
      group = { area: item.area, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Montowany na Panelu; widoczny tylko gdy `open`. */
export function ChangelogModal({ open, onClose }: Props) {
  return (
    <AnimatePresence>
      {open && <ChangelogModalShell key="changelog-modal" onClose={onClose} />}
    </AnimatePresence>
  );
}

function ChangelogModalShell({ onClose }: { onClose: () => void }) {
  const requestClose = useCallback(() => onClose(), [onClose]);

  return (
    <ModalFrame
      ariaLabel="Dziennik zmian"
      cardClassName="changelog-modal-card"
      onRequestClose={requestClose}
    >
      <div className="task-modal-head">
        <h1 className="task-modal-title">Co nowego</h1>
        <div className="task-modal-head-actions">
          <IconButton
            className="task-modal-close"
            icon={<X size={18} aria-hidden />}
            onClick={requestClose}
            label="Zamknij"
          />
        </div>
      </div>
      <div className="task-modal-body">
        <div className="changelog-list">
          {CHANGELOG.map((entry) => (
            <ChangelogEntryBlock key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </ModalFrame>
  );
}

/** Blok jednego wpisu — współdzielony między popoutem a stroną `/changelog`. */
export function ChangelogEntryBlock({ entry }: { entry: ChangelogEntry }) {
  const range = changelogRangeLabel(entry.dateFrom, entry.dateTo);
  const groups = groupByArea(entry.items);
  return (
    <section className="changelog-entry">
      <header className="changelog-entry-head">
        {range && <span className="changelog-entry-range">{range}</span>}
        {entry.summary && <p className="changelog-entry-summary">{entry.summary}</p>}
      </header>
      <div className="changelog-areas">
        {groups.map((group) => (
          <div key={group.area} className="changelog-area">
            <h3 className="changelog-area-title">{group.area}</h3>
            <ul className="changelog-area-items">
              {group.items.map((item, i) => (
                <li key={i} className="changelog-item">
                  <span className="changelog-item-feature">{item.feature}</span>
                  <span className="changelog-item-desc">{item.description}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
