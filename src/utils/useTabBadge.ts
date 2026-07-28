// Hook badge'a karty przeglądarki: dostaje licznik nieprzeczytanych powiadomień
// (z tego samego stanu co karta „Powiadomienia” — realtime-merge aktualizuje go
// także, gdy karta jest w tle) i aktualizuje faviconę + document.title.
// Efekt jest kluczowany ETYKIETĄ (10 → 11 zostaje `9+`, zero przerysowań),
// a applier dodatkowo pomija powtórzenia — brak migotania. Cleanup przy
// odmontowaniu przywraca oryginalny tytuł i faviconę. Cała logika w tabBadge.ts.
import { useEffect, useRef } from 'react';
import {
  createDomTabBadgeHost,
  createTabBadgeApplier,
  unreadBadgeLabel,
  type TabBadgeApplier,
} from './tabBadge';

export function useTabBadge(count: number): void {
  const applierRef = useRef<TabBadgeApplier | null>(null);
  const label = unreadBadgeLabel(count);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!applierRef.current) {
      applierRef.current = createTabBadgeApplier(createDomTabBadgeHost(document));
    }
    applierRef.current.apply(count);
    // Klucz `label`, nie `count`: ta sama etykieta => brak przerysowania.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);

  useEffect(
    () => () => {
      applierRef.current?.dispose();
    },
    [],
  );
}
