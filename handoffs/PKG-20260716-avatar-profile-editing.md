# Handoff: Implement private-bucket avatar upload and policy-gated profile editing

- Package ID: PKG-20260716-avatar-profile-editing
- Status: ready
- Tier: developer
- Depends on: none (builds on merged stages 200–205)
- Risk: high (permission gating + auth-adjacent storage access)
- Codex review: required

## Goal

Users can upload/replace/remove a profile photo stored in the existing private
Supabase `avatars` bucket (Supabase mode only, signed-URL retrieval), and
profile field editing on PersonProfilePage is driven by a pure role/department
policy module (self / manager-own-department / administrator). Local mode keeps
today's emoji/initials behavior with zero Supabase calls.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `openwiki/n2hub/state-and-persistence.md`
- `openwiki/n2hub/testing-and-automation.md`

## Expected touchpoints

- `new: src/supabase/avatarFile.ts` — pure validation + path + signed-URL cache decision
- `new: src/supabase/avatarFile.test.ts`
- `new: src/supabase/avatarStorage.ts` — impure boundary (upload/remove/resolve signed URL, profiles.avatar_path)
- `new: src/pages/profileEditPolicy.ts` — pure role-based field policy
- `new: src/pages/profileEditPolicy.test.ts`
- `src/pages/PersonProfilePage.tsx` — consume policy + avatar photo section
- `src/components/Avatar.tsx` — optional `photoUrl` prop
- `src/pages/AccountPage.tsx` — one link "Mój profil" → `/people/{currentUserId}`
- `src/index.css` / `src/styles.css` (whichever holds `.avatar`) — small additions only
- Read-only reference: `src/auth/SessionProvider.tsx` (`useAuth`), `src/auth/profile.ts`
  (`normalizeEmail`), `src/supabase/client.ts`, `src/store/permissions.ts`,
  `supabase/migrations/20260715210500_rls_policies.sql` (existing storage policies)

## Invariants

- NO new SQL migration. The private `avatars` bucket, its storage RLS
  (`<profileId>/<file>` folder bound to `auth.uid()`, administrator override) and
  `public.profiles.avatar_path` already exist (stages 200–201).
  `src/supabase/migrations.test.ts` must keep passing unchanged.
- `src/store/storage.ts` and data version 7 untouched. No image bytes, base64
  or signed URLs are ever written to AppStore state or localStorage.
  `Person.avatar` stays the emoji string it is today.
- `AppStore.tsx` remains the only mutation boundary; profile text edits keep
  dispatching `UPDATE_PERSON`. On save, locked fields must be taken from the
  current `person`, never from the (disabled) draft inputs.
- Local mode (no/invalid `VITE_SUPABASE_*`): never call `getSupabaseClient()`;
  the photo section is absent; existing emoji avatar editing keeps working.
- Retrieval only via `storage.from('avatars').createSignedUrl(...)` or
  authorized `download`. Never `getPublicUrl`, never a public bucket.
- Client checks are UX only; the real boundary is server RLS. Managers cannot
  upload others' photos (storage RLS would deny it — the UI must not offer it).
- `supabase/functions/provision-account/` and `src/supabase/provisioning.ts`
  untouched. Calendar/bin/WeekView untouched.
- All user-facing strings Polish.

## Scope

### 1. Pure module `src/supabase/avatarFile.ts`

- `AVATAR_MAX_BYTES = 2 * 1024 * 1024` (2 MB — settled).
- `AVATAR_ALLOWED_TYPES: Record<string, string>` = `image/jpeg→'jpg'`,
  `image/png→'png'`, `image/webp→'webp'`.
- `validateAvatarFile(file: { name: string; type: string; size: number })`
  → `{ ok: true; ext: string } | { ok: false; error: string }`. Checks, in
  order: type allowed (fallback to lowercased extension `jpg/jpeg/png/webp`
  when `type` is empty), size > 0, size ≤ max. Polish messages (exact):
  - `Nieobsługiwany format pliku. Dozwolone formaty: JPG, PNG, WebP.`
  - `Plik jest pusty.`
  - `Plik jest za duży (maksymalnie 2 MB).`
- `avatarObjectPath(profileId: string, ext: string)` → `` `${profileId}/avatar.${ext}` ``
  (matches the RLS path convention `<profileId>/<file>`).
- Signed-URL cache as pure decision logic with injected clock, e.g.
  `cachedSignedUrl(cache: Map<string, { url: string; expiresAtMs: number }>, path: string, nowMs: number)`
  → url or null; TTL 3600 s, refresh margin 300 s (settled numbers).

### 2. Impure boundary `src/supabase/avatarStorage.ts`

Uses `getSupabaseClient()` lazily (call-site only, mirroring SessionProvider).
Functions (all return `{ ok: true, ... } | { ok: false; error: string }` with
Polish errors, never throw):

- `fetchAvatarProfile(email)` — `from('profiles').select('id, avatar_path')`
  filtered by `normalizeEmail(email)`; `maybeSingle()`. Returns
  `{ profileId, avatarPath } | null` (null = no account row; RLS scoping
  applies). For the signed-in user themselves prefer the session `user.id`
  passed by the caller and skip the email lookup.
- `uploadAvatar({ profileId, file, ext })` — `storage.from('avatars')
  .upload(path, file, { upsert: true, contentType })`; then
  `from('profiles').update({ avatar_path: path }).eq('id', profileId)`; if the
  previous `avatar_path` differs from the new path, best-effort
  `storage.remove([old])` (ignore its error). Upload error →
  `Nie udało się wysłać awatara. Spróbuj ponownie.`
- `removeAvatar({ profileId, avatarPath })` — `storage.remove` + set
  `avatar_path` to null.
- `resolveAvatarUrl(avatarPath)` — module-level cache Map + `createSignedUrl(path, 3600)`
  via the pure cache helper. Failure → null (UI falls back to initials, non-blocking).

### 3. Pure policy `src/pages/profileEditPolicy.ts`

- `export type ProfileField = 'firstName' | 'lastName' | 'email' | 'phone'
  | 'roleTitle' | 'departmentId' | 'avatarEmoji' | 'capacity' | 'accessRole'
  | 'workDays' | 'workHours' | 'supervisorId'`.
- `editableProfileFields(actor: Person | undefined, target: Person, opts: { peopleCount: number }): ReadonlySet<ProfileField>`
  — settled matrix:
  - setup mode (`peopleCount === 0`): everything;
  - `administrator`: everything;
  - self (non-admin, `actor.id === target.id`): `firstName, lastName, phone, avatarEmoji` only
    (email/roleTitle/departmentId become admin-only — deliberate tightening:
    email is the Supabase identity link, the rest are org fields);
  - `pm` on a target in the manager's own department
    (`actor.departmentId !== '' && actor.departmentId === target.departmentId`),
    target not self and `target.accessRole !== 'administrator'`:
    `roleTitle, phone, workDays, workHours, supervisorId`;
  - otherwise: empty set. `undefined` actor: empty set.
- `canEditAnyProfileField(...)` convenience, and
  `canUploadAvatarPhoto(actor, target, mode: AuthMode, opts)` — true only in
  `mode === 'supabase'` and (setup mode ∨ actor is administrator ∨ self).

### 4. `src/pages/PersonProfilePage.tsx`

- Replace the `canManage/restrictedSelf` gating with `editableProfileFields`:
  each input disabled (+ `title={NO_PERM_TITLE}`) unless its field is in the
  set; "Edytuj" button shown when the set is non-empty; `save()` merges the
  draft over `person` taking only permitted fields.
- New "Zdjęcie profilowe" block inside the profile card, rendered only when
  `canUploadAvatarPhoto(...)` (so hidden entirely in local mode):
  - on mount: resolve profile row (self → session user id from `useAuth`
    state; other target → `fetchAvatarProfile(person.email)`), then signed URL.
    Loading: Polish text with `role="status"` (e.g. `Ładowanie zdjęcia…`).
  - empty states: no account row → `Ta osoba nie ma jeszcze konta — zdjęcie
    profilowe będzie dostępne po jego utworzeniu.`; no photo → initials/emoji
    fallback plus the upload control.
  - labelled file input, `accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"`;
    client-side `validateAvatarFile` before any network call; validation error
    shown in `.field-error` with `role="alert"`; busy state `Wysyłanie…` with
    controls disabled; success `Zapisano awatar.` with `role="status"`;
    `Usuń zdjęcie` button when a photo exists (its own busy/error handling).
  - after success re-resolve the signed URL and show the new photo.
- Photo (when resolved) is displayed via `Avatar` `photoUrl` prop.

### 5. `src/components/Avatar.tsx`

- Optional `photoUrl?: string` prop: when set, render `<img>` (`alt=""`,
  wrapper already `aria-hidden`) filling the circle; otherwise behavior is
  byte-identical to today. Only PersonProfilePage passes it in this package.

### 6. `src/pages/AccountPage.tsx`

- Add a small section/link `Mój profil` navigating to `/people/{currentUserId}`
  (read `currentUserId` via store). No other AccountPage changes.

### 7. Tests (node, vitest — no jsdom; role-based UI behavior is covered via the pure policy)

- `src/supabase/avatarFile.test.ts`: accepted types (incl. extension fallback,
  case-insensitivity), rejected types (gif/svg/pdf/empty), 0-byte, boundary
  sizes (exactly 2 MB ok, 2 MB + 1 rejected), exact Polish messages, path
  builder, cache hit/miss/expiry-margin with injected now.
- `src/pages/profileEditPolicy.test.ts`: full matrix — admin all; self
  tightened set (email NOT included); pm same-dept target set; pm other-dept /
  self-dept-'' / admin-target / self → correct sets; worker/handlowiec on
  others empty; undefined actor empty; setup mode all;
  `canUploadAvatarPhoto` × mode/role/self.

## Out of scope

- Any SQL migration or edit under `supabase/` (bucket + RLS already exist).
- Syncing name/phone/role text fields to the server `profiles` table (local
  `Person` stays the planner's source of truth; only `avatar_path` is touched).
- App-wide photo avatars (WeekView, TeamPage, nav, comments) — initials/emoji
  stay everywhere except PersonProfilePage.
- Arbitrary file attachments, public storage, image cropping/resizing,
  provisioning changes, `src/store/permissions.ts` matrix changes,
  onboarding/tour changes, data-version bump.

## Acceptance

- [ ] `validateAvatarFile` accepts only JPG/PNG/WebP ≤ 2 MB with the exact Polish
      messages above; `avatarObjectPath` yields `<profileId>/avatar.<ext>`.
- [ ] No occurrence of `getPublicUrl` in the diff; retrieval uses
      `createSignedUrl` with the 3600 s TTL / 300 s refresh-margin cache.
- [ ] In local mode the app renders PersonProfilePage without creating a
      Supabase client and without the photo section; emoji avatar editing
      unchanged.
- [ ] PersonProfilePage inputs are enabled exactly per `editableProfileFields`;
      a pm can edit `roleTitle/phone/workDays/workHours/supervisorId` of
      same-department non-admin members and nothing of others; a non-admin
      self cannot edit email/department/accessRole/capacity; save never writes
      locked fields.
- [ ] Avatar photo UI exposes accessible loading (`role="status"`), empty
      (no-account and no-photo), busy, success (`role="status"`) and error
      (`role="alert"`) states, all in Polish.
- [ ] `src/supabase/migrations.test.ts` passes without modification; no file
      under `supabase/` changed.
- [ ] New focused tests pass; `npm test` and `npm run build` green.

## Verification

- Worker: `npx vitest run src/supabase/avatarFile.test.ts src/pages/profileEditPolicy.test.ts`
  then `npx vitest run src/supabase src/pages src/auth` and a full
  `npm run build` once before reporting.
- Browser: none — no calendar/bin/persistence interaction changes; profile page
  behavior is covered by pure-module tests, and no hosted Supabase project is
  configured in this environment.
- Scheduler owns final `npm test && npm run build`.

## Prior decisions

- Size limit 2 MB; formats JPG/PNG/WebP only (validated by MIME with extension
  fallback).
- Object path `<profileId>/avatar.<ext>` with `upsert: true`; server reference
  stored in the existing `profiles.avatar_path` column; stale object with a
  different extension removed best-effort.
- Signed URL TTL 3600 s, in-memory module cache with 300 s refresh margin;
  cache-decision logic is pure and clock-injected for tests.
- Avatar photos are a Supabase-mode-only feature; localStorage schema (v7) and
  `Person.avatar` (emoji) are unchanged — no migration, no new persisted field.
- Field policy matrix as specified in Scope §3, including the deliberate
  tightening that email/roleTitle/departmentId become admin-only for self-edit
  (email is the account identity link per `src/auth/profile.ts`).
- Managers never get avatar upload for others — mirrors the existing storage
  RLS (`avatars_insert_own`/`_update_own`/`_delete_own`: own folder or
  administrator).
