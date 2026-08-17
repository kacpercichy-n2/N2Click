// Wcięcie klawiatury ekranowej dla PŁYWAJĄCYCH paneli czatu (okno rozmowy i
// popover lupy). Cienka warstwa nasłuchu — cała arytmetyka siedzi w czystym
// `components/keyboardInset.ts` (testowanym w środowisku node).
//
// GRANICE / DECYZJE:
//   * Wzorzec nasłuchu jest ODBICIEM tego z `useModalShell.ts`, ale hook jest
//     osobny i `useModalShell` zostaje nietknięty: czat NIE jest modalem (bez
//     pułapki fokusa, bez blokady scrolla, bez `inert`), więc nie może brać
//     całej powłoki modala tylko po to, żeby policzyć wysokość klawiatury.
//   * Działa TYLKO poniżej `MOBILE_NAV_QUERY` i tylko gdy przeglądarka daje
//     `visualViewport`. Na desktopie i w node efekt nie ustawia niczego, więc
//     tamten układ zostaje bit w bit taki sam.
//   * Breakpoint sprawdza KAŻDY `sync`, a nie wejście do efektu, i dochodzi
//     nasłuch `change` na samym `matchMedia`. Modal zamyka się razem ze zmianą
//     kontekstu, ale okno czatu ZOSTAJE otwarte przez zmianę rozmiaru okna,
//     obrót tabletu i Split View — przy bramce na wejściu panel otwarty na
//     desktopie nigdy nie dostałby nasłuchu po zejściu poniżej 760 px i
//     klawiatura znów przykryłaby kompozytor.
//   * `applyInset` pamięta ostatnią wartość: `visualViewport` sypie zdarzeniem
//     `scroll` przy każdym drgnięciu widoku, a zapis tej samej liczby do stylu
//     tylko unieważniałby układ.
//   * Jedyny efekt uboczny to zmienna `--n2-kb-inset` na wskazanym elemencie;
//     konsumują ją wyłącznie reguły z bloku `@media (max-width: 760px)`.
//     Zero `preventDefault`, zero `stopPropagation`, zero przenoszenia fokusa —
//     Escape, wysyłka Enterem i lepki scroll listy działają bez zmian.
//   * Świadomie BEZ dosuwania aktywnego pola (`scrollIntoView`), które robi
//     modal: kompozytor stoi na dole panelu, a panel skraca się o wcięcie, więc
//     pole i tak jest widoczne — dodatkowy skok tylko szarpałby listą.
import { useEffect, type RefObject } from 'react';
import { resolveKeyboardInset } from '../../components/keyboardInset';
import { MOBILE_NAV_QUERY } from '../../utils/useMediaQuery';

export function useChatKeyboardInset(ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = ref.current;
    if (!viewport || element === null) return;
    const media = window.matchMedia(MOBILE_NAV_QUERY);

    let applied = -1;
    const applyInset = (next: number): void => {
      if (next === applied) return;
      applied = next;
      if (next === 0) element.style.removeProperty('--n2-kb-inset');
      else element.style.setProperty('--n2-kb-inset', `${next}px`);
    };
    const sync = (): void => {
      // Powyżej breakpointu wcięcia NIE MA: desktop nie ma klawiatury
      // ekranowej, a reguły konsumujące zmienną i tak siedzą wyłącznie w
      // bloku `@media (max-width: 760px)`.
      if (!media.matches) {
        applyInset(0);
        return;
      }
      applyInset(
        resolveKeyboardInset({
          innerHeight: window.innerHeight,
          viewportHeight: viewport.height,
          offsetTop: viewport.offsetTop,
        }),
      );
    };

    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    media.addEventListener('change', sync);
    return () => {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
      media.removeEventListener('change', sync);
      element.style.removeProperty('--n2-kb-inset');
    };
  }, [ref]);
}
