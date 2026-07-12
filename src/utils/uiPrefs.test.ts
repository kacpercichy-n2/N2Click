import { afterEach, describe, expect, it } from 'vitest';
import {
  ONBOARDING_VERSION,
  loadUiPrefs,
  onboardingForUser,
  updateOnboardingForUser,
  updateUiPrefs,
} from './uiPrefs';

class MemoryStorage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const storage = new MemoryStorage();

afterEach(() => storage.clear());

describe('device UI preferences', () => {
  it('loads the legacy sidebar-only payload without losing compatibility', () => {
    storage.setItem('n2hub.ui.v1', JSON.stringify({ sidebarCollapsed: true }));
    expect(loadUiPrefs()).toEqual({ sidebarCollapsed: true, onboardingByUser: {} });
  });

  it('preserves onboarding progress when the sidebar preference changes', () => {
    updateOnboardingForUser('ola', (current) => ({
      ...current,
      introVersionSeen: ONBOARDING_VERSION,
      autoTourHandled: true,
    }));
    updateUiPrefs({ sidebarCollapsed: true });
    const prefs = loadUiPrefs();
    expect(prefs.sidebarCollapsed).toBe(true);
    expect(onboardingForUser(prefs, 'ola').introVersionSeen).toBe(ONBOARDING_VERSION);
  });

  it('keeps progress separate for different real users', () => {
    updateOnboardingForUser('ola', (current) => ({
      ...current,
      modules: {
        shell: { status: 'completed', lastStep: 3, completedVersion: ONBOARDING_VERSION },
      },
    }));
    const prefs = loadUiPrefs();
    expect(onboardingForUser(prefs, 'ola').modules.shell?.status).toBe('completed');
    expect(onboardingForUser(prefs, 'marek').modules.shell).toBeUndefined();
  });
});

Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
});
