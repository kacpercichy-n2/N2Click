// Jeden gradient na całą listę (efekt Messengera): moje dymki są „oknami" na
// wspólny gradient o wysokości widocznej listy, więc kolor płynie w górę i w
// dół razem z przewijaniem.
//
// DLACZEGO NIE `background-attachment: fixed`: to pozycja względem okna
// PRZEGLĄDARKI, nie kontenera przewijania; okno czatu pływa w różnych
// miejscach ekranu, a iOS Safari traktuje `fixed` jak `scroll`. Wariant z
// `mix-blend-mode` psuje GIF-y, emoji i pigułki reakcji wewnątrz dymka.
// Robimy to, co natywnie robią Telegram Desktop i iOS: każdy dymek przesuwa ten
// sam gradient o własne położenie w liście (`--bubble-top`, pomiar po zmianie
// listy), a scroll aktualizuje JEDNĄ zmienną na kontenerze (`--chat-scroll-y`).
//
// WYDAJNOŚĆ: nasłuch scrolla jest pasywny i pisze jedną własność CSS raz na
// klatkę (rAF); pomiary `offsetTop` idą w osobnym przebiegu PO zmianie listy
// (odczyty zebrane przed zapisami), nigdy w handlerze scrolla. Przy
// `prefers-reduced-motion` hook nie robi nic — CSS spada na statyczny gradient
// per dymek (`.n2chat-window.has-static-gradient`).
import { useLayoutEffect, type RefObject } from 'react';

/** Selektor dymków, które dzielą gradient (GIF-y celowo poza: `.is-gif`). */
const MINE_BUBBLES = '.n2chat-group.is-mine .n2chat-bubble-msg:not(.is-gif)';

export function useSharedBubbleGradient(
  listRef: RefObject<HTMLElement>,
  /** Cokolwiek, co zmienia układ listy (elementy, reakcje, „starsze"). */
  layoutKey: unknown,
  enabled: boolean,
): void {
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!enabled || list === null) return;
    let raf = 0;

    const writeScroll = (): void => {
      raf = 0;
      list.style.setProperty('--chat-scroll-y', `${Math.round(list.scrollTop)}px`);
    };
    const onScroll = (): void => {
      if (raf === 0) raf = requestAnimationFrame(writeScroll);
    };

    const measure = (): void => {
      const listTop = list.getBoundingClientRect().top;
      const scrollTop = list.scrollTop;
      const bubbles = Array.from(list.querySelectorAll<HTMLElement>(MINE_BUBBLES));
      // Najpierw WSZYSTKIE odczyty, potem wszystkie zapisy — bez przeplatania
      // layout/paint w pętli.
      const tops = bubbles.map((bubble) => bubble.getBoundingClientRect().top - listTop + scrollTop);
      list.style.setProperty('--chat-viewport-h', `${list.clientHeight}px`);
      bubbles.forEach((bubble, index) => {
        bubble.style.setProperty('--bubble-top', `${Math.round(tops[index])}px`);
      });
      writeScroll();
    };

    measure();
    list.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(() => measure());
    observer.observe(list);

    return () => {
      list.removeEventListener('scroll', onScroll);
      observer.disconnect();
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [listRef, layoutKey, enabled]);
}
