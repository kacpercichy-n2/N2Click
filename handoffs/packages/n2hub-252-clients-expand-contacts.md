# Handoff: Rozwijane karty klientów + lista osób kontaktowych + zaostrzone wymagane pola

- Package ID: PKG-20260722-clients-expand-contacts
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium (reducer validation change + cloud round-trip + MERGE_CLOUD_ENTITIES touch)
- Codex review: required — reducer/merge boundary and additive cloud column

## Goal

Clients page: collapsed client cards hide the description; clicking expands the
card in place (description + additional contact persons). Client form gains a
contact-person list (first = primary) and requires name + primary first/last
name + phone + e-mail. Data model gains an ADDITIVE `Client.contacts` list with
a full cloud round-trip. All UI strings Polish.

## Wiki context

- `openwiki/n2hub/state-and-persistence.md` (Client bullet, AUTO-SAVE bullet, invariant list)
- `openwiki/n2hub/cloud-database.md` (clients table, migration rules)

## Expected touchpoints

- `src/types.ts` — `ClientContact` + `Client.contacts?`
- `src/store/commandValidation.ts` — `isValidClientDraft` (AND rule), new `isValidClientContacts`, new `sanitizeClientContacts`
- `src/store/AppStore.tsx` — `ADD_CLIENT` / `SAVE_CLIENT` payloads + reducer cases; `mergeCloudEntities` clients handling
- `src/store/storage.ts` — new `repairClients` pass (contacts only)
- `src/supabase/cloudMirror.ts` — `clientRow`
- `src/supabase/plannerData.ts` — clients select + hydration mapping
- `src/pages/ClientsPage.tsx` — expand/collapse + new form
- `new: src/pages/clientContactForm.ts` — pure form helpers (split/join, draft, error)
- `new: src/pages/clientContactForm.test.ts`
- `src/styles.css` — card toggle, details section, contact rows
- `new: supabase/migrations/20260722130000_client_contacts.sql`
- `src/supabase/migrations.test.ts` — file list entry
- `src/store/seed.ts` — only if a demo client misses e-mail or phone (verify)
- Tests: `src/store/commandValidation.test.ts`, `src/store/storage.test.ts`,
  `src/store/cloudMerge.test.ts`, `src/supabase/cloudMirror.test.ts`,
  `src/supabase/plannerData.test.ts`

## Prior decisions (all settled — do not reopen)

1. **`notes` IS the client description.** No new `description` field. Relabel
   the UI: textarea label „Opis klienta”, expanded-card heading „Opis”. Persisted
   field name, reducer payload key, cloud column `clients.notes` all stay
   `notes`. Rationale: existing long descriptions already live in `notes` (the
   overflow bug is exactly this field), so a relabel is zero-migration and loses
   nothing; a parallel `description` would split one concept across two fields.
2. **Additional contacts shape.**
   `interface ClientContact { id: string; firstName: string; lastName: string; phone: string; email: string }`
   (`''` = brak for phone/email). `Client.contacts?: ClientContact[]` holds ONLY
   additional persons. The PRIMARY contact stays in the legacy single-string
   fields `contactName`/`contactEmail`/`contactPhone` — zero data migration,
   every existing record and every existing consumer keeps working, cloud
   columns for the primary are untouched.
3. **Canonical form: `contacts` key OMITTED when empty**, enforced at three
   boundaries (reducer, `repairClients`, cloud hydration) — exactly the
   `Task.recurrence` precedent. This keeps reference-preserving merges and the
   no-echo-write clean-load invariant: a legacy client must NOT gain a
   `contacts: []` key on load or hydration.
4. **Form model: unified person rows, primary = row 1.** The form renders a
   list of contact persons with fields Imię / Nazwisko / Telefon / E-mail.
   Row 1 („Główna osoba kontaktowa”) maps to the legacy fields via split/join:
   - `splitContactName(name)`: trim, split on `/\s+/`; first token → `firstName`,
     rest joined with single spaces → `lastName` (e.g. „Anna Maria Nowak” →
     „Anna” + „Maria Nowak”; „Anna” → „Anna” + „”).
   - `joinContactName(first, last)`: trimmed parts joined by one space.
   Rows 2+ map to `contacts`. „+ Dodaj osobę kontaktową” appends an empty row
   (id = `uid()`); each additional row has an „Usuń” remove button.
5. **Required-field rules (two layers, deliberately different):**
   - FORM layer (`clientDraftError`, gates submit AND auto-save): client name;
     primary Imię AND Nazwisko AND Telefon AND E-mail; every additional row
     Imię AND Nazwisko (its phone/e-mail optional). First-failing Polish message.
   - REDUCER layer (`isValidClientDraft`): presence-only — `name`,
     `contactName`, `contactEmail`, `contactPhone` all non-blank (this changes
     today's e-mail OR phone to AND), plus `contacts` (when present) passing
     strict `isValidClientContacts`. NO shape checks (no two-word rule, no
     e-mail regex) — the valid-legacy philosophy in the existing doc comment
     stays; only the form enforces first+last split. Form rule ⟹ reducer rule,
     so an auto-saved draft can never be reducer-rejected.
6. **Cloud:** new forward-only migration `20260722130000_client_contacts.sql`
   modeled byte-for-byte on `20260721010000_project_documents.sql`:
   `alter table public.clients add column if not exists contacts jsonb not null
   default '[]'::jsonb;` + drop/add check `clients_contacts_is_array`
   (`jsonb_typeof(contacts) = 'array'`). Embedded column, NOT a table: contact
   visibility ≡ client visibility, RLS inherits from the `clients` row — zero
   new policies, no realtime change (clients already published). Migration file
   + `migrations.test.ts` list entry only; do NOT apply to the hosted project.
7. **Merge semantics for contacts (mirror the `events` attendee precedent):**
   fail-closed only structurally — a payload client whose `contacts` key is
   present but NOT an array returns the SAME state reference. Malformed ROWS
   are filtered deterministically via `sanitizeClientContacts` (idempotent, so
   the background refresh stays reference-preserving).
8. **`dataImport.ts` stays untouched** — it already imports clients as
   id/name/archived only (no contact columns); the jsonb default covers it.
9. UI expand state is local component state, single-expanded accordion
   (`expandedId: string`); it is NOT persisted.

## Scope

### 1. Model + validation

- `src/types.ts`: add `ClientContact` (doc comment in Polish, `''` = brak) and
  `contacts?: ClientContact[]` on `Client` („wyłącznie DODATKOWE osoby; główna
  osoba zostaje w contactName/contactEmail/contactPhone; brak klucza = brak”).
- `src/store/commandValidation.ts`:
  - Extend `ClientContactDraft` with `contacts?: unknown`.
  - `isValidClientDraft`: name + contactName + contactEmail + contactPhone all
    `isRequiredName`, AND (`contacts === undefined ||
    isValidClientContacts(contacts)`). Update the doc comment (AND rule; legacy
    records are asked to complete the missing channel on their next edit — same
    established pattern).
  - New `isValidClientContacts(value: unknown): value is ClientContact[]`
    (strict, reducer gate): array; every row an object with non-empty string
    `id` (unique within the array), non-blank `firstName` and `lastName` after
    trim, `phone`/`email` strings (missing treated as `''`).
  - New `sanitizeClientContacts(value: unknown): ClientContact[] | undefined`
    (lenient, load/hydration): non-array → `undefined`; per row: drop unless
    object with non-empty string `id`; coerce non-string
    firstName/lastName/phone/email to `''`; trim all four; drop a row whose
    firstName AND lastName are both empty; dedupe by id (first wins); empty
    result → `undefined`. Deterministic and idempotent
    (`sanitize(sanitize(x)) ≡ sanitize(x)`).

### 2. Reducer (`src/store/AppStore.tsx`)

- Action types: `ADD_CLIENT` and `SAVE_CLIENT` gain
  `contacts?: ClientContact[]`.
- Both cases: gate through updated `isValidClientDraft` (invalid ⇒ SAME state
  reference, invariant 6). On write, trim each contact's four text fields and
  spread `...(trimmed.length > 0 ? { contacts: trimmed } : {})` — never store
  an empty array; SAVE_CLIENT with `contacts: []` REMOVES the key from the
  stored client.
- `mergeCloudEntities`: after the existing `isObjWithId` block, validate/clean
  clients per decision 7: any client with a present non-array `contacts` ⇒
  `return state`; otherwise map clients through `sanitizeClientContacts`
  (row without the key passes through as the SAME object; sanitized-empty ⇒
  object without the key) before `reconcileRows(state.clients, mapped)`.
- `RENAME_CLIENT`, `SET_CLIENT_ARCHIVED`, `DELETE_CLIENT` untouched (spread
  semantics already preserve `contacts`).

### 3. Storage (`src/store/storage.ts`)

- New `repairClients(data)` pass running on the RESULT of BOTH load paths,
  directly after `repairEvents` (same comment style: pole ADDYTYWNE): map each
  client through `sanitizeClientContacts` on its `contacts`; client without the
  key is returned as the same object. `DATA_VERSION` stays 7 — no migration
  step, no version bump. A clean current-version payload without `contacts`
  must produce `needsWriteback: false` (no echo-write).

### 4. Cloud round-trip

- `src/supabase/cloudMirror.ts` → `clientRow`: add
  `contacts: c.contacts ?? []`.
- `src/supabase/plannerData.ts`: add `contacts` to the clients select column
  list; in the clients mapping, `const contacts =
  sanitizeClientContacts(row.contacts);` then spread
  `...(contacts ? { contacts } : {})`. Import the helper from
  `commandValidation` (plannerData already depends on store validation? if not,
  importing this pure module is acceptable and precedented by shared canonical
  helpers — note it in the report).
- Migration file per decision 6 + `migrations.test.ts`: append
  `'20260722130000_client_contacts.sql'` to the expected list;
  `EXPECTED_POLICIES` unchanged.

### 5. UI — `src/pages/ClientsPage.tsx` (+ `src/pages/clientContactForm.ts`, `src/styles.css`)

Extract to `src/pages/clientContactForm.ts` (pure, no React): draft types
(`ClientFormDraft` with `name`, primary row, `contacts: ClientContactRow[]`,
`notes`), `emptyDraft`, `draftOf(client)` (uses `splitContactName`),
`splitContactName`, `joinContactName`, `clientDraftError`,
`draftToActionPayload` (joins the primary name, trims, returns the dispatch
fields), and a `normalizedDraft` helper used for dirty comparison.

Card (read mode):

- Collapsed card layout/width stays as today: name (+ „(zarchiwizowany)”),
  primary contactName, mailto/tel links, project-count link and action buttons.
  `c.notes` is NO LONGER rendered collapsed (this is the bug fix).
- The title area becomes a native `<button type="button"
  className="client-card-toggle" aria-expanded={expanded}
  aria-controls={`client-details-${c.id}`}>` containing the name and a chevron
  (`ChevronRight` from `../components/icons`, CSS class rotates 90° when
  expanded). Keyboard: native button ⇒ Enter/Space toggle for free. The
  mailto/tel links and action buttons stay OUTSIDE the button (no nested
  interactive elements). Additionally the non-interactive area of
  `client-card-main` may toggle on click for pointer convenience (guard:
  ignore clicks whose target is/closest an `a`/`button`).
- Expanded: `<div className="client-card-details" id={`client-details-${c.id}`}>`
  with sections „Opis” (renders `c.notes`, `white-space: pre-line`) and
  „Dodatkowe osoby kontaktowe” (one row per `contacts` entry: „Imię Nazwisko”
  + tel link + mailto link, `''` fields skipped). Neither present ⇒ muted
  „Brak dodatkowych informacji”. Single-expanded accordion (`expandedId`
  state); entering edit mode replaces the card content as today.
- If `contacts` exists collapsed, show a small muted count badge next to the
  name, e.g. „+2 os. kontaktowe” (use `polishCount(n, 'osoba kontaktowa',
  'osoby kontaktowe', 'osób kontaktowych')`) — cheap affordance that there is
  more inside.

Form (create + edit share components):

- Fields: „Nazwa klienta *”; „Główna osoba kontaktowa”: „Imię *”,
  „Nazwisko *”, „Telefon *”, „E-mail *” (DELETE the hint „Wystarczy jedno z
  pól…” — both are now required); additional person rows with „Imię *”,
  „Nazwisko *”, „Telefon”, „E-mail” + „Usuń” per row; ghost button
  `<Plus/> Dodaj osobę kontaktową`; textarea „Opis klienta” (maps to `notes`,
  placeholder stays sensible Polish).
- `clientDraftError` messages (first failure wins, Polish), e.g.: „Nazwa
  klienta jest wymagana”, „Imię i nazwisko głównej osoby kontaktowej są
  wymagane”, „Telefon głównej osoby kontaktowej jest wymagany”, „E-mail głównej
  osoby kontaktowej jest wymagany”, „Każda dodatkowa osoba kontaktowa musi mieć
  imię i nazwisko”.
- Auto-save (edit): keep `useAutoSave`; `valid` becomes
  `clientDraftError(editDraft) === ''` (form rule — strictly stronger than the
  reducer gate, so no dispatched auto-save can be silently rejected and a
  failed save can never show „Zapisano”); `signature`/`dirty` include the
  contacts rows via `normalizedDraft` JSON (dirty must compare against
  `draftOf(client)` — both sides split-derived — so merely opening the editor
  of a legacy client is NOT dirty). The live `editError` + „Auto-zapis
  wstrzymany do czasu uzupełnienia wymaganych pól.” hint pattern stays; legacy
  clients missing phone/e-mail/nazwisko simply pause auto-save until completed
  (established behavior).
- Dispatches pass `contacts` built from rows 2+ (trimmed by the reducer).

Also verify `src/store/seed.ts`: every demo client must carry BOTH
`contactEmail` and `contactPhone` (fill realistic Polish values where one is
missing); optionally give one demo client a `contacts` entry so the expanded
card and cloud mirror path have live demo data.

### 6. Tests (implementation and tests in this one package)

- `src/pages/clientContactForm.test.ts` (new): split/join round-trip
  („Anna Maria Nowak”, single name, extra whitespace), `draftOf`+dirty
  stability for a legacy client, `clientDraftError` matrix (each required
  field, additional-row rule), `draftToActionPayload` join/trim.
- `src/store/commandValidation.test.ts`: FLIP the OR-rule expectations —
  email-only and phone-only drafts are now INVALID; both-present valid; add
  `isValidClientContacts` matrix (valid rows, missing id, duplicate id, blank
  firstName or lastName, non-string phone, non-array). Extend the existing
  ADD_CLIENT/SAVE_CLIENT reducer blocks: invalid contacts payload ⇒ SAME state
  reference (invariant 6); valid save trims rows and stores them; `contacts:
  []` save removes the key; existing missing-phone fixtures now expect
  rejection.
- `src/store/cloudMerge.test.ts`: MERGE_CLOUD_ENTITIES with client `contacts`:
  (a) non-array contacts ⇒ SAME state reference (invariant 6); (b) malformed
  rows filtered deterministically, blank-both-names dropped; (c) valid contacts
  replace the collection authoritatively; (d) reference preservation — a
  value-identical client row (with and without contacts) keeps its object and
  a no-op merge returns the ORIGINAL state reference.
- `src/store/storage.test.ts`: `repairClients` — legacy client without the key
  loads unchanged with `needsWriteback` false (no echo-write); stored
  malformed contacts (non-array, rows without id, non-string fields) repaired
  per sanitize rules; valid contacts survive verbatim.
- `src/supabase/cloudMirror.test.ts`: `clientRow` carries `contacts` (`[]`
  when the local client has no key; the array verbatim otherwise).
- `src/supabase/plannerData.test.ts`: hydration maps the jsonb column to
  sanitized `ClientContact[]` and OMITS the key for `[]`/null/malformed; plus a
  ROUND-TRIP test: local client with contacts → `clientRow` → fake select row →
  `loadPlannerSnapshot` mapping → deep-equal canonical client (and the
  no-contacts client round-trips WITHOUT gaining a key).
- `src/supabase/migrations.test.ts`: expected-file list gains the new
  migration; `EXPECTED_POLICIES` untouched.
- Check `src/store/taskMeta.test.ts` (references ADD_CLIENT) and any other
  fixture dispatching client actions with only one contact channel — update to
  the AND rule.

## Invariants

- Invariant 6: every changed/added rejection path (`ADD_CLIENT`, `SAVE_CLIENT`,
  `MERGE_CLOUD_ENTITIES`) returns the SAME state reference — tested.
- `DATA_VERSION` stays 7; the change is purely additive; a clean
  current-version load never echo-writes; legacy clients (no contacts, single
  contact channel, single-word contactName) stay readable and are only asked to
  complete fields on their next deliberate edit.
- Reference-preserving merge: deterministic contact sanitize; no-op hydration
  returns the original state reference (background refresh must not flicker).
- Auto-save: a paused (invalid) draft never dispatches; a failed save never
  reports „Zapisano”; explicit tab conflict still pauses auto-save.
- `MERGE_CLOUD_*` still never touch people/statuses/savedFilters/lastFilters/
  dictionaries by reference.
- Retirement mode stays off; migration file is NOT applied to the hosted DB.

## Out of scope

- No new `description` field, no contacts table, no RLS/realtime changes, no
  `dataImport.ts` changes, no changes to project pages consuming clients, no
  e-mail/phone format validation, no persistence of the expand state, no
  browser-matrix runs (release verification owns them), no applying the SQL
  migration to the hosted project.

## Acceptance

- [ ] Collapsed client card never shows `notes`; layout/width unchanged
      otherwise; long descriptions cannot overflow the collapsed card.
- [ ] Card expands/collapses in place via mouse AND keyboard (native button,
      `aria-expanded`/`aria-controls`); expanded view shows „Opis” and
      „Dodatkowe osoby kontaktowe”.
- [ ] Create/edit form: required = nazwa, imię+nazwisko głównej osoby, telefon,
      e-mail; plus button adds/removes additional persons; „Opis klienta”
      textarea edits `notes`.
- [ ] Auto-save pauses with a live Polish message on any missing required
      field (including legacy records) and resumes when completed; no false
      „Zapisano”.
- [ ] `Client.contacts` round-trips: reducer → mirror `clientRow` → hydration →
      `MERGE_CLOUD_ENTITIES`, canonical key-omitted-when-empty at every
      boundary.
- [ ] All listed tests added/updated and green.

## Verification

- Worker: focused first —
  `npx vitest run src/pages/clientContactForm.test.ts src/store/commandValidation.test.ts src/store/storage.test.ts src/store/cloudMerge.test.ts src/supabase/cloudMirror.test.ts src/supabase/plannerData.test.ts src/supabase/migrations.test.ts`
  then full `npm test` and `npm run build`.
- Browser: none — no calendar/bin pointer paths touched; ClientsPage
  interaction is covered by unit-level helpers and release verification owns
  the browser matrix.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Wiki impact (report at the end; final reviewer adjudicates)

- `openwiki/n2hub/state-and-persistence.md` — Client bullet is now stale:
  AND rule (e-mail AND telefon), `contacts` additive field + canonical
  omission + `repairClients`, notes relabeled „Opis klienta”.
- `openwiki/n2hub/cloud-database.md` — clients table gains the `contacts`
  jsonb column + migration registry entry.
