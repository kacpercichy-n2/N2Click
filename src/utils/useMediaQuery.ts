// Jeden hook `matchMedia` na aplikację. Wcześniej `App.tsx` trzymał własną
// stałą i własny efekt, a `CalendarPage` nie miał ich wcale — teraz oba biorą
// TĘ SAMĄ zapytanie i tę samą implementację, więc powłoka telefonu (dolny pasek)
// i widok dnia kalendarza nigdy nie rozjadą się o jeden piksel breakpointu.
import { useEffect, useState } from 'react';

/** Breakpoint telefonu: poniżej niego działa dolny pasek zakładek i widok dnia. */
export const MOBILE_NAV_QUERY = '(max-width: 760px)';

/**
 * Zachowanie 1:1 z dawnym efektem w `App.tsx`: stan startowy prosto z
 * `matches` (żadnego mignięcia układu desktopowego na telefonie),
 * `addEventListener('change')` i sprzątanie przy odmontowaniu.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [query]);
  return matches;
}
