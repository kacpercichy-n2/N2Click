# Run state — 20260722-131754-n2hub-252 clients expand + contacts

## Goal

Clients page: collapsed cards hide the description (overflow fix), click
expands in place (opis + additional contact persons, keyboard-accessible).
Form: required = nazwa + imię/nazwisko głównej osoby + telefon + e-mail (AND,
was OR), plus-button list of additional contacts. Additive
`Client.contacts?: ClientContact[]` with full cloud round-trip; `notes`
relabeled „Opis klienta” (no new field). DATA_VERSION stays 7.

## Packages

- `handoffs/packages/n2hub-252-clients-expand-contacts.md` —
  PKG-20260722-clients-expand-contacts, tier: developer, ready, Codex review
  required. Code + tests in one package (inseparable).

## Changed boundaries (planned)

- `src/types.ts` (ClientContact), `commandValidation.ts` (AND rule,
  isValidClientContacts strict / sanitizeClientContacts lenient),
  `AppStore.tsx` (ADD/SAVE_CLIENT + mergeCloudEntities per-row sanitize,
  non-array fail-closed), `storage.ts` (repairClients, no echo-write).
- Cloud: `cloudMirror.clientRow.contacts`, `plannerData` select+map, new
  migration `20260722130000_client_contacts.sql` (jsonb, array CHECK, no RLS
  change; file only — NOT applied), `migrations.test.ts` list.
- UI: `ClientsPage.tsx`, new pure `src/pages/clientContactForm.ts`
  (split/join primary contactName, draft error), `styles.css`.

## Verification

Focused vitest list in the package → full `npm test` + `npm run build`.
Browser: none (no pointer/scheduling paths). Invariant-6 tests for every
changed reducer path.

## Open questions

None blocking — all decisions settled in the package (notes relabel, legacy
primary stays single-string, contacts key omitted when empty).

## Developer result (20260722)

Implemented full package: types, validation (AND rule + isValid/sanitize
contacts), reducer ADD/SAVE_CLIENT + mergeCloudEntities (invariant 6),
repairClients, cloud round-trip, migration 20260722130000 (not applied),
ClientsPage expand/collapse + clientContactForm.ts + CSS, seed. Focused +
full `npm test`: 1358 passed. `npm run build`: green. Wiki updated.

## 20260722-134519 calendar-dnd-snap (developer)
time.ts: dropStartFromAnchor helper. WeekView: BinCard drop now anchors on
card-top (grabY) + in-column .week-drop-preview portal; TimedBlock DragState +
over-bin fixed portal ghost. styles.css: .week-drop-preview/.week-drag-ghost.
No reducer/collision/pointer-lifecycle changes. Focused vitest 51 pass; npm test
1365 pass; build green. Wiki unchanged (boundaries/invariants/routes intact).
