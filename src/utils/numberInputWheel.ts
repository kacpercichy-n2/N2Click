// Globalna blokada zmiany wartości pól liczbowych kółkiem myszy.
//
// Przeglądarka „kręci" wartością input[type=number] tylko wtedy, gdy pole ma
// fokus. Jeden delegowany listener (capture) na dokumencie zdejmuje fokus w
// momencie scrolla nad takim polem, więc wartość nie zmienia się przypadkiem,
// a strona przewija się normalnie (listener jest pasywny — nie blokuje
// scrolla). Obejmuje każdy obecny i przyszły input liczbowy, także w portalach,
// bez dopisywania propsów per pole. Edycja z klawiatury pozostaje bez zmian.

/** Czy cel zdarzenia to input[type=number], który aktualnie ma fokus? */
export function isFocusedNumberInput(
  target: unknown,
  activeElement: unknown,
): target is HTMLInputElement {
  if (!target || target !== activeElement) return false;
  const el = target as { tagName?: unknown; type?: unknown };
  return el.tagName === 'INPUT' && el.type === 'number';
}

/** Instaluje globalną blokadę; zwraca funkcję sprzątającą (dla testów). */
export function installNumberInputWheelGuard(doc: Document = document): () => void {
  const onWheel = (event: Event) => {
    const target = event.target;
    if (isFocusedNumberInput(target, doc.activeElement)) {
      target.blur();
    }
  };
  doc.addEventListener('wheel', onWheel, { capture: true, passive: true });
  return () => doc.removeEventListener('wheel', onWheel, { capture: true });
}
