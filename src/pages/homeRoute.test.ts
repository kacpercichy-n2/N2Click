// Unit tests for the single-home routing helper (Panel merge: „Moja praca" was
// folded into „Panel"). Pure — no React, no localStorage.
import { describe, expect, it } from 'vitest';
import { HOME_PATH, LEGACY_MY_WORK_PATH, redirectTargetForPath } from './homeRoute';

describe('home route', () => {
  it('the single home is the Panel (/dashboard)', () => {
    expect(HOME_PATH).toBe('/dashboard');
  });

  it('legacy /my-work redirects to the Panel', () => {
    expect(redirectTargetForPath(LEGACY_MY_WORK_PATH)).toBe('/dashboard');
    expect(redirectTargetForPath('/my-work')).toBe('/dashboard');
  });

  it('any other path is not redirected', () => {
    expect(redirectTargetForPath('/dashboard')).toBeNull();
    expect(redirectTargetForPath('/projects')).toBeNull();
    expect(redirectTargetForPath('/')).toBeNull();
  });
});
