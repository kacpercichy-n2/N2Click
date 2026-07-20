// Rejestr wstrzymań odświeżania w tle. Czysty — bez Reacta i bez storage.
import { beforeEach, describe, expect, it } from 'vitest';
import { anyLiveSyncHold, clearLiveSyncHold, setLiveSyncHold } from './liveSyncGate';

const a = {};
const b = {};

describe('liveSyncGate', () => {
  beforeEach(() => {
    clearLiveSyncHold(a);
    clearLiveSyncHold(b);
  });

  it('bez blokad nie wstrzymuje odświeżania', () => {
    expect(anyLiveSyncHold()).toBe(false);
  });

  it('blokada trzyma, dopóki nie zostanie zdjęta', () => {
    setLiveSyncHold(a, true);
    expect(anyLiveSyncHold()).toBe(true);
    setLiveSyncHold(a, false);
    expect(anyLiveSyncHold()).toBe(false);
  });

  it('równoległe przeciągania: zwolnienie jednego nie odblokowuje drugiego', () => {
    setLiveSyncHold(a, true);
    setLiveSyncHold(b, true);
    setLiveSyncHold(a, false);
    expect(anyLiveSyncHold()).toBe(true);
    setLiveSyncHold(b, false);
    expect(anyLiveSyncHold()).toBe(false);
  });

  it('odmontowanie w trakcie przeciągania zdejmuje blokadę na zawsze', () => {
    setLiveSyncHold(a, true);
    clearLiveSyncHold(a);
    expect(anyLiveSyncHold()).toBe(false);
    // Ponowne zdjęcie nieznanego klucza jest bezpieczne (brak licznika do zgubienia).
    clearLiveSyncHold(a);
    expect(anyLiveSyncHold()).toBe(false);
  });

  it('powtórzone ustawienie tej samej blokady nie kumuluje się', () => {
    setLiveSyncHold(a, true);
    setLiveSyncHold(a, true);
    setLiveSyncHold(a, false);
    expect(anyLiveSyncHold()).toBe(false);
  });
});
