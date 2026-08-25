# Google Calendar import into N2Hub: implementation research (2026-08-25)

Target: read-only import of each employee's Google Calendar events into N2Hub (Week/Month views,
collision detection), "connect your Google account" UX like the Content Plan Drive picker.
Stack facts this document assumes: Vite/React SPA, Supabase project N2Hub (schema `n2click`,
`core.profiles` with emails), Edge Functions, pg_cron, pg_net, Vault. Supabase Auth is
email+password. Existing Google integration (`src/contentplan/google.ts`) uses the GIS token
flow with scope `drive.file`, no refresh tokens, no server storage.

Facts come from the sources linked inline. Where docs do not state a value, this says so.

---

## 0. Decision summary

1. Auth: GIS **authorization code flow** (`initCodeClient`, popup) + Edge Function exchanges the
   code and stores the refresh token in Supabase Vault. Background sync works without the user.
2. Scopes: `calendar.events.readonly` + `calendar.calendarlist.readonly` (+ `openid email`).
3. Sync: pg_cron every 5 min -> Edge Function `google-calendar-sync`, `events.list` with
   `syncToken` after a windowed full sync (-30/+90 days). No push channels in v1.
4. Storage: shadow tables `google_accounts`, `google_calendars`, `google_calendar_events`.
   Never write into `n2click.events`.
5. Visibility: owner full, matched attendees full, everyone else "Zajęty" (busy) only; private
   and confidential events hidden from non-owners. Per-user share level setting.
6. Effort: ~30-42 h (one focused week) plus Google Cloud paperwork.

---

## 1. Auth / token strategy

| | (a) GIS token flow (current Content Plan pattern) | (b) GIS code flow + Edge Function + stored refresh token | (c) Supabase `linkIdentity({provider:'google'})` |
|---|---|---|---|
| Refresh token | No. "In the token based authorization model, there is no need to store per-user refresh tokens" ([use-token-model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)) | Yes, exchanged server-side at `https://oauth2.googleapis.com/token` with `client_secret`, `grant_type=authorization_code`, `redirect_uri=postmessage` for popup mode ([web-server](https://developers.google.com/identity/protocols/oauth2/web-server)) | Yes, if `queryParams: { access_type:'offline', prompt:'consent' }` ([auth-google](https://supabase.com/docs/guides/auth/social-login/auth-google)) |
| Background sync without user in app | Impossible ("User must be present: Yes", [choose-authorization-model](https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model)) | Yes ("User must be present: No, supports offline use") | Yes, but only if you persist `provider_refresh_token` yourself |
| Silent re-issue | Access token ~1h. Docs: "obtain a new token by calling `requestAccessToken()` from a user-driven event such as a button press". `prompt: ''` = "The user will be prompted only the first time your app requests access" ([js-reference](https://developers.google.com/identity/oauth2/web/reference/js-reference)); default `prompt` is `'select_account'`. Even with `''`, GIS opens a popup that auto-closes; needs a user gesture or popup blockers eat it ([issue #816](https://github.com/google/google-api-javascript-client/issues/816)). No iframe silent refresh exists. | Access token refreshed by Edge Function via `grant_type=refresh_token`; no UI | Supabase does NOT refresh provider tokens: "Supabase doesn't handle refreshing the provider_token using the provider_refresh_token yet" ([discussion #19384](https://github.com/orgs/supabase/discussions/19384), [issue #806](https://github.com/supabase/auth-js/issues/806)) |
| Consent persistence | Per user and client ID, persists across calls | Refresh token survives until revoked, 6 months unused, or 7-day expiry in Testing status | Same |
| Storage | Memory only | `n2click.google_accounts` + Vault | Own table anyway; `provider_refresh_token` is returned once in the callback session and never again |
| Fit with our SPA | Already built. Fine for "click to import now" only | Small: one popup (same UX as Content Plan) + 1 Edge Function | Full-page redirect through `<ref>.supabase.co/auth/v1/callback`, requires enabling Google provider + manual linking ([identity-linking](https://supabase.com/docs/guides/auth/auth-identity-linking)); turns Google into a login method |

Extra facts:

- GIS code client in popup mode ignores `redirect_uri`; the server exchange must use
  `redirect_uri: 'postmessage'` ([blog](https://blog.maffin.io/posts/client-side-google-authorization-code-model),
  [discussion #2338](https://github.com/googleapis/google-api-python-client/discussions/2338)).
  Observed, not guaranteed: GIS code client sends `access_type=offline&prompt=consent`, so a
  `refresh_token` comes back on every authorization.
- "The `refresh_token` is only returned on the first authorization" unless `prompt=consent`
  ([web-server](https://developers.google.com/identity/protocols/oauth2/web-server)).
- Limit: 100 refresh tokens per Google account per client ID, oldest silently invalidated
  ([oauth2](https://developers.google.com/identity/protocols/oauth2)). Refresh tokens die after
  6 months unused or on user revoke.
- `initCodeClient` and `initTokenClient` coexist on the same `VITE_GOOGLE_CLIENT_ID`.

**Recommendation: (b).** Reuse the lazy-loaded GIS script and the same Web client; call
`initCodeClient({ client_id, scope, ux_mode:'popup', select_account:true, callback })`; POST
`code` to Edge Function `google-calendar-connect` (user JWT verified), which exchanges it with
`client_secret` (Edge Function secret `GOOGLE_CLIENT_SECRET`), reads the Google email from
`userinfo`, stores `refresh_token` in Vault (`vault.create_secret`) and metadata in
`n2click.google_accounts`. (a) cannot sync in the background; (c) adds login semantics and a
redirect flow for nothing we need.

## 2. Google Cloud / OAuth verification

- Scope strings: `https://www.googleapis.com/auth/calendar.events.readonly` and
  `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
  ([calendar/api/auth](https://developers.google.com/workspace/calendar/api/auth),
  [scopes](https://developers.google.com/identity/protocols/oauth2/scopes)). Other granular
  scopes: `calendar.calendars.readonly`, `calendar.events.owned.readonly`,
  `calendar.events.public.readonly`, `calendar.events.freebusy`, `calendar.settings.readonly`.
  `calendar.readonly` alone also covers both calls but is broader.
- Sensitivity: Calendar scopes are **sensitive**, not restricted
  ([sensitive-scope-verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)).
  Sensitive review "typically takes 3-5 business days", needs justification, demo video,
  homepage, privacy policy, verified domain.
- Internal user type: only people in your Google Workspace / Cloud Identity org; "will not be
  subject to the unverified app screen or the 100-user cap"
  ([when verification not needed](https://support.google.com/cloud/answer/13464323?hl=en)).
  Internal requires the GCP project to sit inside a Google Cloud Organization
  ([app audience](https://support.google.com/cloud/answer/15549945?hl=en)). If project "N2" was
  created under a personal Gmail, it has no org and must be migrated.
- External + Testing: up to 100 test users, "unverified app" screen, and refresh tokens expire
  in 7 days ([oauth2](https://developers.google.com/identity/protocols/oauth2)).
  External + In production + unverified: 100-user lifetime cap, unverified screen, no 7-day expiry.
- The existing `drive.file` scope is non-sensitive, which is why Content Plan never hit this.

**Recommendation:** Workspace -> audience Internal, zero verification. Plain Gmail -> External +
"In production" without verification (20 users < 100 cap; users click through "Advanced > Go to
N2Hub"), or submit sensitive-scope verification (~1 week). Never leave it in Testing.

## 3. Calendar API surface

- `GET calendarList.list` with `minAccessRole=reader`, fields `id, summary, primary, selected,
  accessRole, timeZone, backgroundColor, hidden, deleted`
  ([calendarList.list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list)).
  Default: sync `primary` only; let the user toggle others where `selected=true`.
- `GET calendars/{calendarId}/events` ([events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)):
  `singleEvents=true`, `orderBy=startTime`, `timeMin`/`timeMax` RFC3339, `maxResults` (default
  250, max 2500), `showDeleted=true`, `eventTypes` (repeatable), `timeZone`.
- Incremental sync ([sync guide](https://developers.google.com/workspace/calendar/api/guides/sync)):
  full sync stores `nextSyncToken` (present only on the LAST page); later calls pass `syncToken`,
  which is **incompatible with** `timeMin`, `timeMax`, `orderBy`, `q`, `updatedMin`, `iCalUID`
  (400). Incremental results contain deleted entries (`status: 'cancelled'`). HTTP 410 GONE ->
  clear storage and full sync again. Consequence: the window is frozen at full-sync time.
  Twenty syncs `primary` with no timeMin at all
  ([google-calendar-get-events.service.ts](https://raw.githubusercontent.com/twentyhq/twenty/main/packages/twenty-server/src/modules/calendar/calendar-event-import-manager/drivers/google-calendar/services/google-calendar-get-events.service.ts)).
  Cal.com does `timeMin=today, timeMax=+3 months`, then `syncToken`
  ([GoogleCalendarSubscription.adapter.ts](https://raw.githubusercontent.com/calcom/cal.com/main/packages/features/calendar-subscription/adapters/GoogleCalendarSubscription.adapter.ts)).
  For us: initial window -30/+90 days, then `syncToken`; every ~30 days (or on 410) drop the
  token and re-run the windowed full sync.
- Event fields ([events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events)):
  `id`, `iCalUID`, `recurringEventId`, `originalStartTime`, `status`
  (`confirmed|tentative|cancelled`), `summary`, `description` (HTML), `location`,
  `hangoutLink`, `conferenceData.entryPoints[]{entryPointType, uri}`, `start/end{date|dateTime,timeZone}`,
  `attendees[]{email,responseStatus,self,optional,resource}`, `organizer{email,self}`,
  `visibility` (`default|public|private|confidential`), `transparency` (`opaque|transparent`),
  `eventType` (`default|outOfOffice|focusTime|workingLocation|birthday|fromGmail`), `etag`,
  `updated`, `htmlLink`. Use `fields=` mask to shrink payload.
- Meet/Zoom/Teams detection, in order: `conferenceData.entryPoints.find(e => e.entryPointType==='video').uri`;
  else `hangoutLink`; else regex over `location` + `description`:
  `/https:\/\/(meet\.google\.com\/[a-z-]+|[\w.-]*zoom\.us\/j\/\d+[^\s"<]*|teams\.microsoft\.com\/l\/meetup-join\/[^\s"<]+|teams\.live\.com\/meet\/[^\s"<]+)/i`.
- Quotas ([quota](https://developers.google.com/workspace/calendar/api/guides/quota)): 10,000
  req/min/project, 600 req/min/user, 1,000,000/day. 20 users polling every 5 min = ~6,000 req/day.
  Handle `403/429 usageLimits` with exponential backoff.
- `outOfOffice`/`focusTime`/`workingLocation` exist only on Workspace primary calendars
  ([calendar-status](https://developers.google.com/workspace/calendar/api/guides/calendar-status)).

## 4. Push notifications vs polling

- `POST calendars/{id}/events/watch` body `{ id: uuid, type:'web_hook', address, token, params:{ ttl } }`;
  default TTL 604800 s (7 days) ([events.watch](https://developers.google.com/workspace/calendar/api/v3/reference/events/watch),
  [push guide](https://developers.google.com/workspace/calendar/api/guides/push)). Cal.com asks
  for 30 days; the real cap is not published.
- Notification = POST with no body; headers `X-Goog-Channel-ID`, `X-Goog-Resource-ID`,
  `X-Goog-Resource-State` (`sync`, then `exists`/`not_exists`), `X-Goog-Channel-Token`,
  `X-Goog-Channel-Expiration`. It only says "something changed": you still run `events.list`
  with `syncToken`.
- No automatic renewal; re-`watch` before expiry and `channels.stop` old ones. The webhook
  domain must be a verified domain in the Cloud project (`*.supabase.co` cannot be verified;
  needs a custom domain or a proxy on our domain). Edge Function must run with
  `verify_jwt = false` and validate `X-Goog-Channel-Token` itself
  ([functions/auth](https://supabase.com/docs/guides/functions/auth)).
- Polling: pg_cron `*/5 * * * *` -> `net.http_post` to Edge Function with a secret from Vault
  ([schedule-functions](https://supabase.com/docs/guides/functions/schedule-functions)). Twenty
  polls every 5 minutes ([Twenty docs](https://docs.twenty.com/user-guide/calendar-emails/overview)).

**Recommendation:** pg_cron polling every 5 min with syncToken. No public webhook, no domain
verification, no renewal state machine. Add `watch` later only if a 5-minute lag hurts.

## 5. Mapping to our model

| Google | N2Hub |
|---|---|
| `start.dateTime`/`end.dateTime` | Pass `timeZone=Europe/Warsaw` so Google converts. `date = yyyy-MM-dd`, `startMinutes = floor(min/15)*15`, `durationMinutes = max(15, ceil((end-start)/15)*15)`. Round start down, end up, so the block never under-covers the meeting. Keep raw `start_at`/`end_at` timestamptz in the shadow table. |
| `start.date`/`end.date` (all-day, end exclusive) | `startMinutes 0`, `durationMinutes 1440`, `endDate = end.date - 1 day`. All-day banner, excluded from collision unless `outOfOffice`. |
| Multi-day timed | Store once; expand into per-day segments at read time in the calendar view. |
| Recurring | `singleEvents=true` expands instances; store each by its own `id` with `recurringEventId`. Do NOT translate RRULE into `TaskRecurrence`. |
| `status: 'cancelled'` | Delete row (or `deleted_at`). Instance ids look like `<parent>_<yyyymmddThhmmssZ>`. |
| `attendees[].email`, `organizer.email` | Match `core.profiles.email` (lower-cased) -> `attendee_profile_ids`; keep unmatched emails in `attendees` jsonb. `self=true` = owner's own RSVP. |
| `eventType: 'outOfOffice'` | `kind: 'urlop'`. `focusTime` -> blocking event "Focus time". Skip `workingLocation`, `birthday`, `fromGmail` via `eventTypes=default&eventTypes=outOfOffice&eventTypes=focusTime`. |
| `visibility: private/confidential` | `is_confidential = true`. |
| `transparency: 'transparent'` | Import but `is_busy=false` (Cal.com: `busy = !transparency || transparency==='opaque'`). |
| Meet/Zoom/Teams | `meeting_url` (section 3). |
| `description` | Strip HTML. |
| `htmlLink` | Store; "Otwórz w Google Calendar" in the popover. |

Storage: columns on `events` vs shadow table.

| | Columns on `n2click.events` (`source`, `external_id`, ...) | Shadow table `n2click.google_calendar_events` |
|---|---|---|
| Calendar views | Zero UI changes, one query | Second query merged client-side or a UNION view |
| Data purity | Sync writes into a user-authored table; every editor/RLS/trigger special-cases `source='google'` | Read-only rows never mix with editable ones |
| Re-sync / disconnect | `DELETE ... WHERE source='google'` on the core table | `DELETE FROM google_calendar_events WHERE account_id=...` |
| Extra Google fields (etag, rsvp, htmlLink, raw times) | Bloat on `events` | Natural home |
| Two-way later | Easier | Needs a link column |

**Recommend the shadow table.** Proposed DDL:

```sql
create table n2click.google_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references core.profiles(id) on delete cascade,
  google_email text not null,
  vault_secret_id uuid not null,
  scopes text not null,
  share_level text not null default 'busy' check (share_level in ('details','busy','hidden')),
  status text not null default 'active' check (status in ('active','revoked','error')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table n2click.google_calendars (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references n2click.google_accounts(id) on delete cascade,
  google_calendar_id text not null,
  summary text not null,
  is_primary boolean not null default false,
  selected boolean not null default false,
  sync_token text,
  last_full_sync_at timestamptz,
  last_sync_at timestamptz,
  unique (account_id, google_calendar_id)
);

create table n2click.google_calendar_events (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references n2click.google_calendars(id) on delete cascade,
  google_event_id text not null,
  ical_uid text,
  recurring_event_id text,
  etag text,
  status text not null,
  title text not null default '',
  description text not null default '',
  location text not null default '',
  meeting_url text not null default '',
  html_link text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  is_all_day boolean not null default false,
  event_date date not null,
  start_minutes integer not null,
  duration_minutes integer not null,
  end_date date,
  event_type text not null default 'default',
  visibility text not null default 'default',
  is_busy boolean not null default true,
  is_confidential boolean not null default false,
  attendees jsonb not null default '[]'::jsonb,
  attendee_profile_ids uuid[] not null default '{}',
  self_response text,
  google_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  unique (calendar_id, google_event_id)
);
```

Dedupe key = `(calendar_id, google_event_id)`; `ical_uid` only to hide the same meeting present
on two subscribed calendars. Optional later: `linked_event_id uuid -> n2click.events` for a
manual "link to N2Hub event".

Two-way sync would need scope `calendar.events`, `events.insert`/`patch` with `If-Match: <etag>`,
`conferenceDataVersion=1` for Meet creation, `sendUpdates` handling. Out of scope for v1.

## 6. Privacy / multi-user

| Product | Who sees synced events |
|---|---|
| Huly | Google `visibility` drives it: public -> everyone sees title+time, free/busy -> "Busy" slot only, private -> owner only ([Huly docs](https://docs.huly.io/integrations/google-calendar/)) |
| Twenty CRM | Per-account "Everything" vs "Metadata" (date + participants only) ([Twenty docs](https://docs.twenty.com/user-guide/calendar-emails/overview)) |
| Cal.com | Teammates only ever see "busy" ([cal.com blog](https://cal.com/blog/privacy-friendly-calendar-scheduling-for-teams)) |
| Notion Calendar | Reads teammates' calendars via Google's own sharing ACLs; nothing extra stored ([Notion help](https://www.notion.com/help/notion-calendar-for-teams)) |
| Vikunja, Plane | No Google Calendar import (Plane request [#8794](https://github.com/makeplane/plane/issues/8794)) |
| Calendly | Connected calendars used for conflicts only |

**Recommended default:** three tiers decided at read time by a view, not at import:

1. Owner: full details.
2. Attendees matched by email to `core.profiles`: full details unless `is_confidential`.
3. Everyone else: masked row `{ title: 'Zajęty' }`, nothing at all when `is_confidential` or
   `visibility='private'`. Per-user `share_level: details | busy | hidden` overrides tier 3.

Implement as a `security_invoker` view `n2click.google_calendar_events_visible` that masks
columns with `CASE`; RLS on the base table = owner only.

## 7. Off-the-shelf alternatives

Nylas ~$30-80/mo for 20 users plus the Google verification burden still lands on you
([pricing guide](https://zeeg.me/en/blog/post/nylas-api-pricing)). Cronofy $99/mo minimum
([pricing](https://www.cronofy.com/api-pricing)). Unipile ~99 EUR/mo for 20
([pricing](https://www.unipile.com/pricing-api/)). Composio is an agent-tool proxy, not a sync
engine. Verdict: not worth it. Read-only import is 3 endpoints and one cron. Revisit only if
Outlook/Exchange users appear.

## 8. Reference implementations

- **Twenty CRM** (NestJS, TS), https://github.com/twentyhq/twenty,
  `packages/twenty-server/src/modules/calendar/calendar-event-import-manager/`:
  `services/calendar-fetch-events.service.ts` (full vs partial by `syncCursor`),
  `drivers/google-calendar/services/google-calendar-get-events.service.ts` (`showDeleted`,
  `singleEvents`, `maxResults 500`), `services/calendar-event-import-exception-handler.service.ts`
  (`SYNC_CURSOR_ERROR` -> drop cursor + full resync; `INVALID_REFRESH_TOKEN` -> failed status;
  throttle counter), `calendar-event-participant-manager/` (email -> member matching). Best model
  for a polling importer.
- **Cal.com** (TS), https://github.com/calcom/cal.com:
  `packages/features/calendar-subscription/lib/CalendarSubscriptionService.ts` (watch lifecycle,
  `syncErrorCount` up to 3), `adapters/GoogleCalendarSubscription.adapter.ts`,
  `packages/app-store/googlecalendar/lib/CalendarAuth.ts` (`eagerRefreshThresholdMillis: 60000`,
  `invalid_grant` -> `invalidateCredential`).
- **Huly** (TS), https://github.com/hcengineering/platform/tree/develop/services/calendar/pod-calendar/src:
  `watch.ts`, `pushHandler.ts`, `sync.ts`, `tokens.ts`, `rateLimiter.ts`. Good for visibility
  mapping and watch renewal.
- **Supabase**: [schedule-functions](https://supabase.com/docs/guides/functions/schedule-functions),
  [vault](https://supabase.com/docs/guides/database/vault) (`vault.create_secret`; pgsodium is
  pending deprecation, use only `vault.*`), [functions/auth](https://supabase.com/docs/guides/functions/auth).
  Community webhook POC: https://github.com/frlncr-app/google-calendar-events-webhook-poc

## 9. Effort estimate (solo senior dev + Claude Code)

| Phase | Work | Hours |
|---|---|---|
| 0. Google Cloud | Enable Calendar API, add scopes to consent screen, Internal vs External/production, client secret into Edge Function secrets | 1-2 (+ ~1 week wall-clock if verification) |
| 1. Connect account | `initCodeClient` popup in Account settings, Edge Function `google-calendar-connect`, migrations for 3 tables + RLS + masking view | 6-8 |
| 2. One-off import | Edge Function `google-calendar-sync` (refresh -> access token, `calendarList.list`, windowed full sync, mapper, upsert, cancelled handling) + "Synchronizuj teraz" button | 8-10 |
| 3. Background sync | syncToken path, 410 -> full resync, `invalid_grant` -> `revoked`, pg_cron every 5 min, monthly re-window, backoff on 429 | 4-6 |
| 4. UI in Week/Month | Fetch visible view, merge into grid with Google styling, popover with Meet link + "Otwórz w Google", collision includes `is_busy`, all-day banner | 8-12 |
| 5. Settings / disconnect | Calendar picker (`selected`), share level, disconnect = `POST https://oauth2.googleapis.com/revoke` + delete rows + Vault secret | 3-4 |
| Total | | ~30-42 h |

## 10. Risks / gotchas

- Testing publishing status kills refresh tokens after 7 days; must be Internal or In production
  before rollout.
- Internal audience needs the GCP project inside a Google Cloud Organization. If "N2" lives under
  a personal Gmail, migrate the project or go External.
- External + unverified: "Google hasn't verified this app" screen; 100-user lifetime cap.
- `syncToken` cannot be combined with `timeMin/timeMax`; plan periodic re-windowing.
- `nextSyncToken` only on the last page; finish paging before saving it.
- Same event on multiple subscribed calendars: same `iCalUID`, different `id` per calendar.
- All-day `end.date` is exclusive; multi-day timed events break the single-day model.
- `description` is HTML; sanitize.
- 100 refresh tokens per user per client: always overwrite the stored secret on reconnect.
- `vault.decrypted_secrets` must never be readable by `authenticated`/`anon`; wrap reads in a
  `security definer` function callable by service role only.
- Content Plan token client defaults to `prompt:'select_account'`; sharing the client with
  `include_granted_scopes` merges consent (fine), but Drive-only users see a bigger consent
  screen next time.
- Poland DST: convert via `timeZone=Europe/Warsaw` server-side, store `timestamptz`, never
  compute `startMinutes` from a UTC clock.
