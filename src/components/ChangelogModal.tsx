// Popout dziennika zmian („Changelog"). Wzorzec jest ten sam co w TicketModal:
// scrim + viewport z zamknięciem po kliknięciu w tło, klawisz Escape zamyka,
// body dostaje `overflow: hidden`, a wejście/wyjście animuje AnimatePresence.
// W odróżnieniu od TicketModal nie chodzi tu o edycję danych, więc modal jest
// sterowany zwykłym stanem (`open`/`onClose`), bez parametru w URL i strażnika
// nawigacji.
import { useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CHANGELOG, changelogRangeLabel } from '../data/changelog';
import type { ChangelogEntry, ChangelogItem } from '../data/changelog';
import { IconButton } from './IconButton';
import { X } from './icons';

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [requestClose]);

  return (
    <>
      <motion.div
        className="task-modal-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      />
      <div className="task-modal-viewport" onClick={requestClose}>
        <motion.div
          className="task-modal-card changelog-modal-card"
          role="dialog"
          aria-modal="true"
          aria-label="Dziennik zmian"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
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
        </motion.div>
      </div>
    </>
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
