// Cienka warstwa DOM kanału ogłoszeń. Cała decyzyjność (dedup, jeden komunikat
// na kanał) siedzi w czystym `src/utils/liveRegion.ts` testowanym w node.
//
// DWA węzły są ZAWSZE zamontowane — czytnik ekranu ogłasza zmianę treści tylko
// wtedy, gdy region istniał w DOM zanim tekst się pojawił. Dlatego host wisi w
// powłoce App (tuż przed banerami), a nie przy komunikacie.
import { useSyncExternalStore } from 'react';
import { liveAnnouncer } from '../utils/liveRegion';

export function LiveRegionHost() {
  // `subscribe`/`snapshot` to stabilne referencje singletonu, a snapshot zmienia
  // obiekt WYŁĄCZNIE przy realnym ogłoszeniu (wymóg cache'owania w React 18).
  const snapshot = useSyncExternalStore(
    liveAnnouncer.subscribe,
    liveAnnouncer.snapshot,
    liveAnnouncer.snapshot,
  );
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {snapshot.polite?.text ?? ''}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {snapshot.assertive?.text ?? ''}
      </div>
    </>
  );
}
