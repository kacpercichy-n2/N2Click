# Handoff: Two-tab browser check + docs for honest persistence

- **Package ID:** PKG-20260713c-persist-browser-docs
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260713c-persist-core + PKG-20260713c-persist-ui (runs LAST)
- **Blast radius:** none in `src/` — a new script, CLAUDE.md hunks, RUN-STATE entry only.

## Goal

A repeatable Playwright verification of the whole bundle in a real browser — failed writes are visible with no false "Zapisano"; a second same-context page's write is detected; a clean page refreshes in place; a dirty page gets the explicit conflict choice and both choices work — plus CLAUDE.md updates whose wording stays scoped to SAME-BROWSER tab safety (explicitly NOT collaboration, backups, authorization, or a backend).

## Context the worker needs

- Relevant files: new `scripts/browser-check-tab-sync.mjs` (pattern source: `scripts/browser-check-placement.mjs` and `scripts/browser-check-bin-split.mjs` — `ok()`/`failures`/`notes`, PASS/FAIL verdict, `[chromium|webkit]` CLI arg, screenshots dir); `CLAUDE.md`; `handoffs/RUN-STATE.md` (append your worker entry).
- READ THE REAL SHIPPED CODE FIRST (house discipline — assert against code, not package paraphrase): `src/store/storage.ts` (`saveData` result, revision envelope, `subscribeExternalChanges`, `STORAGE_KEY = 'n2hub.data.v1'`), `src/store/AppStore.tsx` (persist effect, conflict/refresh flow, `usePersistence`), `src/components/PersistenceBanner.tsx` + `src/components/SaveStatus.tsx` + `src/utils/useSaveStatus.ts` (exact classes/roles/strings — the UI worker's RUN-STATE entry lists them), `src/components/TaskModal.tsx` (how to make a form dirty).
- Key Playwright fact (architect-verified design premise): two pages created from ONE `browser.newContext()` share an origin and localStorage, and `storage` events fire across them — use `context.newPage()` twice; do NOT use two contexts.
- ENVIRONMENT (bake-in from prior runs — do not rediscover):
  - ALL git commands denied; do not attempt, do not commit.
  - `npm run dev` / vite CLI / curl DENIED. Start the dev server via the vite node API (`vite.createServer()` from a node script), port 5173; if 5173 is already occupied by a stale server, free it via `process.kill(pid, 'SIGTERM')` from node (shell `kill` is denied) and verify the served build is THIS working tree before asserting anything (previous runs were burned by a stale sibling checkout).
  - Playwright package + browsers should already be present on this branch (a prior run did `npm install --no-save playwright`); verify, install the same way only if absent.
  - Typecheck via `node ./node_modules/typescript/bin/tsc --noEmit`; tests via `npm test`.
- Prior decisions (architect, final):
  - Simulating write failure: `page.addInitScript` wrapping `Storage.prototype.setItem` so it throws `new DOMException('quota', 'QuotaExceededError')` when the key is `n2hub.data.v1` AND `window.__blockWrites === true` — toggled per-test via `page.evaluate`. This keeps seeding/setup writes working and gives a clean restore path (no page reload needed).
  - Revision checks read the raw payload from localStorage via `page.evaluate` and parse `revision`.
  - Docs honesty constraint (from the user): CLAUDE.md must NOT claim collaboration, multi-user sync, backups, authorization, or a backend. The protocol is same-browser, same-origin tab safety for one local dataset.

## Scope

### In scope — `scripts/browser-check-tab-sync.mjs` (new)

One continuous flow, single context, screenshots to `reviews/screenshots-20260713c-persist/` (do NOT write into older runs' screenshot dirs):

(a) **Setup:** pageA + pageB from one context; seed sample data on pageA (existing house helper flow — see how prior scripts seed); reload pageB so both show the same state. Record the stored `revision`.

(b) **Clean auto-refresh:** pageB idle on `/projects` (no form open). On pageA toggle a project's paid coin. Assert on pageB: the coin state updates WITHOUT a page reload (poll the DOM), the info notice with the exact shipped copy (`Dane odświeżono — wczytano zmiany zapisane w innej karcie.`) is visible, and dismissing via `OK` hides it. Assert no write-back ping-pong: read the stored `revision` twice ~700ms apart after settling — it must be stable, and pageA must NOT show any persistence banner.

(c) **Conflict → accept external:** open TaskModal on pageB and edit the title (dirty, do not save). On pageA toggle the coin back. Assert pageB shows the conflict banner (`role="alert"`, exact shipped copy), and pageB's store was NOT silently replaced. Click `Wczytaj wersję z innej karty`, accept the `window.confirm` (page.on('dialog')). Assert: banner gone, pageB's data now matches pageA's write (coin state), stored revision unchanged by the accept (no write-back from REPLACE).

(d) **Conflict → keep local:** make pageB dirty again (TaskModal edit); pageA makes another change (e.g. coin toggle). On pageB click `Zostaw moją wersję (nadpisz)`. Assert: banner gone; the stored payload now reflects pageB's pre-conflict store state (pageA's toggle reverted in storage) and the stored `revision` is strictly greater than pageA's write; pageA subsequently receives the external change (pageA is clean → its info notice appears and its DOM reverts).

(e) **Failed write — no false Zapisano:** on pageA set `__blockWrites = true`. Open TaskModal, change the title, save. Assert: the failure banner appears with the exact quota copy (`Nie udało się zapisać danych — brak miejsca w pamięci przeglądarki.`), the save-status badge shows `Nie zapisano`, and the text `Zapisano` NEVER appears (poll for ~3s — this is the headline acceptance criterion). Assert localStorage still holds the pre-save payload (title unchanged in storage) while the app shows the new title.

(f) **Retry recovery:** set `__blockWrites = false`, click `Spróbuj ponownie`. Assert the banner clears, storage now contains the edited title, and a fresh reload of pageA shows the edited title (durability).

(g) Zero `pageerror` events on BOTH pages across the whole flow.

Structure: `ok()`/`failures`/`notes` + final PASS/FAIL and non-zero exit on failure, `[chromium|webkit]` CLI arg, ≥2 screenshots per scenario b–f.

### In scope — `CLAUDE.md` (surgical hunks only)

1. Architecture "No backend" bullet: one-two added sentences — `saveData` returns an explicit success/failure result (quota/private-mode/serialization classified); failures surface a durable Polish banner (export copy + retry) and the save indicator can never show `Zapisano` for a failed write; the payload carries a storage-envelope `revision` (not part of `AppData`) and a `storage`-event listener gives SAME-BROWSER tab safety: clean tabs refresh in place, conflicting tabs get an explicit choice. State plainly that this is not multi-user sync/collaboration/backup — that remains the future API's job.
2. Architecture "State" bullet or the provider description: one clause naming `REPLACE_FROM_STORAGE` and `usePersistence`.
3. Manual test checklist: add a new item 15 covering: simulated write failure → `Nie zapisano` + failure banner + export/retry; two same-browser tabs → clean tab auto-refresh with notice; dirty tab → conflict banner with both choices behaving as shipped.
4. Security note: extend by one sentence — the revision protocol is data-loss reduction between tabs of one browser, not a trust boundary.
Nothing else in CLAUDE.md changes. Grep-verify afterwards that the words `kolaboracj`, `backup`, `synchronizacja zespołu` do NOT appear in your added text and that `Nie zapisano` / `revision` / `REPLACE_FROM_STORAGE` DO.

### In scope — `handoffs/RUN-STATE.md`

Append your worker entry (files changed, read-before-write findings, full test matrix, deviations) per the file's existing pattern.

### Out of scope

- Any `src/` file (production OR test). If a script assertion fails, first determine whether the SCRIPT's premise is wrong (trace the real code); only report an app defect upward — never patch the app.
- Existing browser-check scripts (do not modify; a spot-run of `browser-check-bin-split.mjs chromium` after your changes is a nice-to-have sanity check, not required).
- Any claim of multi-user features in any doc.

## Implementation notes

- `storage` events need the write to actually hit localStorage — remember pageB's own writes also fire events on pageA; design assertions around WHICH page acted last.
- The conflict banner's copy and classes come from the UI worker's report — verify in `PersistenceBanner.tsx` before hardcoding.
- After scenario (e) the TaskModal may still be open/dirty on pageA — close/cancel deliberately between scenarios so dirtiness state is known at each step (the conflict predicate consults live form dirtiness).
- WebKit + `window.confirm` via Playwright dialogs works the same as Chromium; keyboard-order quirks from prior runs don't apply here (all interactions are clicks).

## Acceptance criteria

- [ ] Script passes on BOTH chromium and webkit, zero page errors, screenshots written to the new dir.
- [ ] Headline assertion present and green: after a failed write, `Zapisano` never renders and the failure banner + `Nie zapisano` badge do.
- [ ] External change detected on the sibling page in both clean (auto-refresh + notice) and dirty (conflict, both resolutions) shapes; no silent overwrite of the dirty page.
- [ ] Revision monotonic and stable when idle (no write-back loop).
- [ ] CLAUDE.md hunks exactly as scoped, honesty wording verified by grep.
- [ ] `node ./node_modules/typescript/bin/tsc --noEmit` → 0 errors; `npm test` green (no src/test file touched by you).

## Tests

- Command: `node scripts/browser-check-tab-sync.mjs` then `node scripts/browser-check-tab-sync.mjs webkit`; plus `node ./node_modules/typescript/bin/tsc --noEmit` and `npm test`.
- Expected: PASS on both engines; tsc 0 errors; vitest at the post-tests-package baseline (12 files, all green), unchanged by you.

## Report back

Synthesized summary only: script scenario list with per-engine results, CLAUDE.md hunks one-line each, any premise-vs-code mismatches found and how the script (not the app) was corrected, environment obstructions hit, deviations.
