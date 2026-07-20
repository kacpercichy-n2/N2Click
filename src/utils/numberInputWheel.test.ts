// Blokada zmiany wartości input[type=number] kółkiem myszy. Środowisko node,
// bez jsdom — dokument i elementy są lekkimi atrapami zgodnymi z kontraktem
// (tagName/type/blur, addEventListener z capture).
import { describe, expect, it } from 'vitest';
import { installNumberInputWheelGuard, isFocusedNumberInput } from './numberInputWheel';

type Handler = (event: { target: unknown }) => void;

function makeInput(tagName: string, type: string) {
  return {
    tagName,
    type,
    blurCount: 0,
    blur() {
      this.blurCount += 1;
    },
  };
}

function makeDoc() {
  const listeners: Array<{ type: string; handler: Handler; capture: boolean }> = [];
  const doc = {
    activeElement: null as unknown,
    addEventListener(type: string, handler: Handler, options?: { capture?: boolean }) {
      listeners.push({ type, handler, capture: options?.capture === true });
    },
    removeEventListener(type: string, handler: Handler, options?: { capture?: boolean }) {
      const idx = listeners.findIndex(
        (l) => l.type === type && l.handler === handler && l.capture === (options?.capture === true),
      );
      if (idx >= 0) listeners.splice(idx, 1);
    },
    dispatchWheel(target: unknown) {
      for (const l of [...listeners]) {
        if (l.type === 'wheel') l.handler({ target });
      }
    },
    listenerCount: () => listeners.length,
  };
  return doc;
}

describe('isFocusedNumberInput', () => {
  it('rozpoznaje input liczbowy z fokusem', () => {
    const input = makeInput('INPUT', 'number');
    expect(isFocusedNumberInput(input, input)).toBe(true);
  });

  it('odrzuca input liczbowy bez fokusu', () => {
    const input = makeInput('INPUT', 'number');
    const other = makeInput('INPUT', 'number');
    expect(isFocusedNumberInput(input, other)).toBe(false);
    expect(isFocusedNumberInput(input, null)).toBe(false);
  });

  it('odrzuca inne typy pól i cele niebędące inputem', () => {
    const text = makeInput('INPUT', 'text');
    expect(isFocusedNumberInput(text, text)).toBe(false);
    const div = { tagName: 'DIV' };
    expect(isFocusedNumberInput(div, div)).toBe(false);
    expect(isFocusedNumberInput(null, null)).toBe(false);
  });
});

describe('installNumberInputWheelGuard', () => {
  it('zdejmuje fokus z pola liczbowego przy scrollu nad nim', () => {
    const doc = makeDoc();
    installNumberInputWheelGuard(doc as unknown as Document);
    const input = makeInput('INPUT', 'number');
    doc.activeElement = input;
    doc.dispatchWheel(input);
    expect(input.blurCount).toBe(1);
  });

  it('nie rusza pola bez fokusu ani pól tekstowych', () => {
    const doc = makeDoc();
    installNumberInputWheelGuard(doc as unknown as Document);

    const unfocused = makeInput('INPUT', 'number');
    doc.activeElement = null;
    doc.dispatchWheel(unfocused);
    expect(unfocused.blurCount).toBe(0);

    const text = makeInput('INPUT', 'text');
    doc.activeElement = text;
    doc.dispatchWheel(text);
    expect(text.blurCount).toBe(0);
  });

  it('funkcja sprzątająca usuwa listener', () => {
    const doc = makeDoc();
    const uninstall = installNumberInputWheelGuard(doc as unknown as Document);
    expect(doc.listenerCount()).toBe(1);
    uninstall();
    expect(doc.listenerCount()).toBe(0);

    const input = makeInput('INPUT', 'number');
    doc.activeElement = input;
    doc.dispatchWheel(input);
    expect(input.blurCount).toBe(0);
  });
});
