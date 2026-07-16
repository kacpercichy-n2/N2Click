# Run state — 20260716-092511-206 avatar and profile editing

## Goal

Secure profile photo (private Supabase `avatars` bucket, JPG/PNG/WebP ≤ 2 MB,
signed URLs) plus policy-gated profile field editing (self / manager own
department / administrator), degrading to today's emoji/initials behavior in
local mode. Polish UI, focused node tests.

## Packages

- [PKG-20260716-avatar-profile-editing](PKG-20260716-avatar-profile-editing.md)
  — Tier: developer (Opus), Risk: high, Codex: required. Status: ready.

## Changed boundaries (planned)

- New pure modules: `src/supabase/avatarFile.ts`, `src/pages/profileEditPolicy.ts`
  (+ tests); new impure boundary `src/supabase/avatarStorage.ts`
  (createSignedUrl only, never getPublicUrl).
- Edited: `src/pages/PersonProfilePage.tsx` (policy-driven field gating + photo
  section), `src/components/Avatar.tsx` (optional `photoUrl`),
  `src/pages/AccountPage.tsx` (link to own profile), styles.
- NO SQL migration — bucket, storage RLS and `profiles.avatar_path` already
  exist from stages 200–201; `src/supabase/migrations.test.ts` must pass
  unchanged. `storage.ts`/AppStore/data v7 untouched; no image data in
  localStorage.

## Verification

- Worker: `npx vitest run src/supabase/avatarFile.test.ts
  src/pages/profileEditPolicy.test.ts`, then `npx vitest run src/supabase
  src/pages src/auth` + one `npm run build`.
- Browser: none — no calendar/persistence interaction changed.
- Scheduler owns final `npm test && npm run build`.

## Open questions

None blocking. Note for reviewer: the package deliberately tightens self-edit
(email/roleTitle/departmentId become admin-only; email is the Supabase identity
link). `openwiki/n2hub/ui-navigation-and-onboarding.md` may need one line about
the avatar/profile-policy boundary after a green run — final reviewer owns that
decision.

## Developer result (20260716-0940)

Implemented all 7 touchpoints as specified. Focused: avatarFile+policy tests
27/27 pass; `src/supabase src/pages src/auth` 160/160. Full gate green: `npm
test` 779/779, `npm run build` (tsc+vite) clean. No `getPublicUrl` in src; no
`supabase/` file touched. No deviations. Next: reviewer/Codex pass.
