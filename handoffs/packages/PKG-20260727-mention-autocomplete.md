# Handoff: Typing-triggered @mention autocomplete in the comment field

- Package ID: PKG-20260727-mention-autocomplete
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium — keyboard handling on a real content-entry field, one component + one pure module
- Codex review: conditional — only if the worker expands beyond the named
  touchpoints or the reviewer is unsure about the key handling

## Goal

Typing `@` in the comment textarea opens an inline person list that filters as
you type; ArrowUp/ArrowDown move the selection, Enter inserts the mention,
Escape closes. The query-extraction, filtering and insertion logic lives in a
new PURE, unit-tested module.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md` (comments panel)

## Expected touchpoints

- `new: src/components/mentionAutocomplete.ts`
- `new: src/components/mentionAutocomplete.test.ts`
- `src/components/CommentsPanel.tsx` — textarea + form actions (~lines 94, 153–182).
- `src/styles.css` — additive rules near `.mention-chips` (~3098).

## Invariants

1. `parseMentions` keeps its exact current semantics — it is what fills
   `ADD_COMMENT.mentionIds`; do not change its matching rules or signature.
2. `MentionBody` rendering is unchanged.
3. The existing person chips under the field keep working exactly as today
   (`insertMention` appends `@firstName ` at the end).
4. `ADD_COMMENT` dispatch shape is unchanged; empty/whitespace bodies still
   cannot be submitted.
5. Enter inside the textarea keeps inserting a newline whenever the list is
   CLOSED, and never submits the form.
6. No new runtime dependency (no combobox/popover library). All strings Polish.
7. No store, reducer, selector or persistence change.

## Scope

### 1. `src/components/mentionAutocomplete.ts` (pure, no React)

```ts
import type { Person } from '../types';

/** Zakres tokenu @wzmianki pod kursorem (bez znaku @ w `query`). */
export interface MentionQuery {
  /** Indeks znaku '@' w tekście. */
  start: number;
  /** Pozycja kursora (koniec tokenu, wyłącznie). */
  end: number;
  /** Tekst po '@' do kursora (może być pusty). */
  query: string;
}

/** Ile podpowiedzi pokazujemy naraz. */
export const MAX_MENTION_SUGGESTIONS = 8;

export function mentionQueryAt(text: string, caret: number): MentionQuery | null;
export function filterMentionPeople(people: readonly Person[], query: string): Person[];
export function applyMention(text: string, range: MentionQuery, person: Person): { text: string; caret: number };
```

`mentionQueryAt` rules (exact):
- `caret` outside `[0, text.length]` → `null`.
- Scan backwards from `caret - 1`. Stop and return `null` on the first
  whitespace (space, tab, newline) before finding `@`.
- The found `@` must be at index 0 or immediately preceded by whitespace
  (so `mail@domena` never opens the list).
- `query = text.slice(atIndex + 1, caret)`; it must contain no whitespace by
  construction. `query.length > 32` → `null` (runaway guard).
- Otherwise return `{ start: atIndex, end: caret, query }`.

`filterMentionPeople` rules:
- Comparison is case- AND diacritics-insensitive: normalize with
  `s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()` (no new
  dependency; `u` flag required).
- Empty query → every person, in `people` order.
- Otherwise: first the people whose `firstName` STARTS WITH the query (in
  `people` order), then the remaining people whose `name` CONTAINS it (in
  `people` order). No duplicates.
- People with an empty `firstName` are skipped (mirrors `parseMentions`).
- Result truncated to `MAX_MENTION_SUGGESTIONS`.

`applyMention`: replaces `text.slice(range.start, range.end)` with
`@${person.firstName} ` (single trailing space) and returns the new text plus a
caret positioned right after that trailing space.

### 2. `src/components/CommentsPanel.tsx`

- `const taRef = useRef<HTMLTextAreaElement>(null);`
- `const [caret, setCaret] = useState(0);` updated from `onChange`, `onSelect`
  and `onClick` via `e.currentTarget.selectionStart ?? 0`.
- `const [dismissed, setDismissed] = useState(false);` — Escape sets it; any
  later text change resets it to `false`.
- `const range = useMemo(() => (dismissed ? null : mentionQueryAt(body, caret)), [body, caret, dismissed]);`
- `const options = useMemo(() => (range ? filterMentionPeople(state.people, range.query) : []), [range, state.people]);`
- `const open = range !== null && options.length > 0;`
- `const [active, setActive] = useState(0);` — reset to `0` in an effect keyed by
  `range?.query` and by `options.length`; always read it clamped
  (`Math.min(active, options.length - 1)`).
- `onKeyDown` on the textarea, only when `open`:
  - `ArrowDown` → `preventDefault()`, `active = (active + 1) % options.length`;
  - `ArrowUp` → `preventDefault()`, `active = (active - 1 + options.length) % options.length`;
  - `Enter` → `preventDefault()`, insert the active option;
  - `Escape` → `preventDefault()`, `setDismissed(true)`;
  - anything else falls through untouched. When the list is closed, the handler
    does nothing at all.
- Insert helper: `const { text, caret: next } = applyMention(body, range, person);`
  → `setBody(text)`, `setDismissed(true)` for that keystroke is NOT needed (the
  token is consumed, so `mentionQueryAt` returns `null` after the trailing space),
  store `next` in `pendingCaretRef` and apply it in a `useEffect` on `body`:
  `taRef.current?.focus(); taRef.current?.setSelectionRange(next, next); setCaret(next);`
  then clear the ref.
- Dropdown markup, rendered inside a positioned wrapper around the textarea:
  `<ul className="mention-autocomplete" role="listbox" aria-label="Podpowiedzi wzmianek">`
  with `<li role="option" aria-selected={i === active}>` containing a
  `<button type="button" className={i === active ? 'mention-option active' : 'mention-option'}>`.
  Each option button uses `onMouseDown={(e) => e.preventDefault()}` (so the
  textarea keeps focus) and `onClick={() => insert(p)}`, and shows
  `@{p.firstName}` plus a muted `{p.name}`.
- Textarea gets `role="combobox"`, `aria-expanded={open}`,
  `aria-autocomplete="list"`, `aria-controls` / `aria-activedescendant` wired to
  stable option ids. `onBlur` closes the list (`setDismissed(true)`); typing
  reopens it.
- The placeholder text and the submit button stay exactly as today.

### 3. `src/styles.css`

Additive rules near `.mention-chips` (~3098): a positioned wrapper class for the
textarea (e.g. `.comment-input-wrap { position: relative; }`), plus
`.mention-autocomplete` (absolute, above the field, max-height with scroll,
card background/border/shadow consistent with existing popovers, `z-index`
above the form) and `.mention-option` / `.mention-option.active`. Do not modify
existing rules.

### 4. Tests (`src/components/mentionAutocomplete.test.ts`, new)

`mentionQueryAt`:
- `('@', 1)` → `{ start: 0, end: 1, query: '' }`;
- `('Hej @an', 7)` → `query: 'an'`, `start: 4`;
- caret BEFORE the `@` → `null`; caret in the middle of a token returns the
  partial query up to the caret;
- `('mail@firma.pl', 13)` → `null` (no whitespace before `@`);
- `('@Ala kolejne', 12)` → `null` (whitespace passed while scanning back);
- newline before `@` still opens; `('@' + 'a'.repeat(33), 34)` → `null`;
- out-of-range caret (`-1`, `text.length + 1`) → `null`.

`filterMentionPeople`:
- empty query → everyone, original order, capped at `MAX_MENTION_SUGGESTIONS`
  (build 10 people to prove the cap);
- prefix matches come before substring matches, each in people order, no dupes;
- diacritics + case insensitive both ways (`'lu'` matches `Łukasz`, `'Ł'`
  matches `lukasz`);
- a person with `firstName: ''` never appears;
- no match → `[]`.

`applyMention`:
- inserting into `'Hej @an'` yields `'Hej @Anna '` with the caret at the end;
- inserting mid-text keeps the suffix intact and puts the caret before it;
- the result of a real `mentionQueryAt` → `applyMention` round trip is matched by
  `parseMentions(result.text, people)` (imported from `./CommentsPanel`) — this
  is the contract that makes `ADD_COMMENT.mentionIds` correct.

## Out of scope

- Changing `parseMentions` / `MentionBody` / `insertMention` (chips).
- Multi-word `@First Last` autocomplete queries.
- Mentions anywhere other than the comment textarea.
- Notifications produced by mentions, email, `notificationEvents.ts`.
- Any store/reducer/persistence change; a shared generic autocomplete component.

## Acceptance

- [ ] Typing `@` opens the list; typing more letters filters it live.
- [ ] ArrowDown/ArrowUp cycle the highlighted option; Enter inserts it and
      closes the list; Escape closes without inserting.
- [ ] The inserted text is `@Imię ` at the `@` token position, the caret lands
      after the trailing space, and the textarea keeps focus.
- [ ] Clicking an option inserts it without losing focus.
- [ ] `mail@domena` and a space-broken token never open the list.
- [ ] With the list closed, Enter still inserts a newline and never submits.
- [ ] The submitted comment's `mentionIds` are unchanged in semantics
      (`parseMentions` still resolves the inserted token).
- [ ] `mentionQueryAt` / `filterMentionPeople` / `applyMention` are pure and
      fully unit-tested.

## Verification

- Worker: `npx vitest run src/components/mentionAutocomplete.test.ts`
- Browser: none — no calendar/bin pointer lifecycle or covered browser-check
  interaction changes; the control is a plain React list over a textarea.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- The query is a SINGLE token (no spaces) and insertion uses `firstName`,
  matching the existing chips (`@${p.firstName} `) and `parseMentions`, which
  already resolves a bare first name.
- Diacritics-insensitive matching via `NFD` + `\p{Diacritic}` — Polish names make
  strict matching unusable, and it needs no dependency.
- Suggestions capped at 8, prefix matches first — deterministic and testable.
- Escape sets a `dismissed` flag rather than mutating the text, so the token
  stays intact and the next keystroke can reopen the list.
- The pure logic lives in its own module (not exported from the `.tsx`) so the
  test is a plain node-env unit test with no React render.
