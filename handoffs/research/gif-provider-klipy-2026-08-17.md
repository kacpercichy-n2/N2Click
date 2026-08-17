# KLIPY GIF provider: implementation research (2026-08-17)

Target: GIF picker in a React 18 + Vite 5 client-only SPA. No backend, no proxy, no server-side key.
Provider choice: KLIPY, because production access is documented as free with unlimited requests after
Partner Panel approval, and because the docs explicitly require calls to originate from the end-user
client, which is exactly the shape a client-only SPA can offer.

All facts below come from the official sources listed in section 8. Where official evidence does not
state a value, this document says so instead of guessing.

---

## 1. Endpoints and query parameters (native v1)

Base URL, API key as a path segment:

```
https://api.klipy.com/api/v1/{API_KEY}/
```

The key is a path parameter (`app_key` in the docs). It is not a query parameter and not a header.

```
GET https://api.klipy.com/api/v1/{API_KEY}/gifs/search?q={q}&page={page}&per_page={per_page}&customer_id={customer_id}&locale={locale}&content_filter={content_filter}&format_filter={format_filter}
GET https://api.klipy.com/api/v1/{API_KEY}/gifs/trending?page={page}&per_page={per_page}&customer_id={customer_id}&locale={locale}&content_filter={content_filter}&format_filter={format_filter}
```

| Parameter | Where | Required | Allowed values | Default | Notes |
|---|---|---|---|---|---|
| `app_key` | path | Yes (docs mark it REQUIRED) | your Partner Panel key | none | first path segment after `/api/v1/` |
| `q` | query, search only | Not flagged REQUIRED in the docs parameter table, but it is the search keyword; always send it | free text | none documented | fuzzy matching is documented |
| `page` | query | No | integer, minimum `1` | `1` | page based indexing, 1-based; there is no cursor and no offset parameter |
| `per_page` | query | No | search: min `8`, max `50`; trending: min `1`, max `50` | `24` on both | |
| `customer_id` | query | No | opaque string, stable per user | none documented | docs: "make sure that the value remains consistent for the same user"; reuse the same value in the share body |
| `locale` | query | No | See the locale note below | none documented | |
| `content_filter` | query | No | `off`, `low`, `medium`, `high` | none documented, do not assume one | send `high` explicitly for an internal workplace chat |
| `format_filter` | query | No | comma separated list of `gif`, `webp`, `jpg`, `mp4`, `webm` | none documented; without it all formats are returned | `format_filter=gif` returns only the gif renditions and removes the webp/jpg/mp4/webm siblings from every tier |

Locale note: the Trending and Search pages document `locale` as an ISO 3166-1 alpha-2 country code
(examples given: `ge`, `us`, `uk`, `ru`). The Categories page on the same docs site documents `locale`
as `xx_YY` (ISO 639-1 language plus ISO 3166-1 alpha-2 country) and its sample response returns
`"locale": "en_US"`. `pl_PL` is the value observed working against search and trending. The docs are
inconsistent between the two forms; send `pl_PL` and treat the country-only form as an untested
alternative.

`format_filter` tradeoff, from the official GIF Format Sizes table: median `sm` gif is 206 KB versus
median `sm` webp 117 KB. Filtering to `gif` only is simpler for a chat message payload but gives up the
lighter webp preview. Section 2 assumes gif renditions.

Adjacent documented endpoints, not needed for v1: `GET api/v1/{app_key}/search-suggestions/{q}?limit=10`
and `GET api/v1/{app_key}/autocomplete/{q}?limit=10`.

---

## 2. Response shape

Envelope is `result` plus `data`; the item list is `data.data`; pagination fields sit next to it inside
`data`.

```ts
export type KlipyTier = 'hd' | 'md' | 'sm' | 'xs';
export type KlipyFormat = 'gif' | 'webp' | 'jpg' | 'mp4' | 'webm';

export interface KlipyRendition {
  url: string;
  width?: number;
  height?: number;
  size?: number; // bytes
}

export type KlipyFormats = Partial<Record<KlipyFormat, KlipyRendition>>;
export type KlipyFile = Partial<Record<KlipyTier, KlipyFormats>>;

export interface KlipyGif {
  slug: string;                 // stable key, used by every write endpoint
  title: string;
  type: 'gif';
  file: KlipyFile;
  tags?: string[];
  blur_preview?: string;        // "data:image/jpeg;base64,..." placeholder
  id?: number;                  // present in REST samples, not modelled by the official Android DTO
}

export interface KlipyAd {
  type: 'ad';
  width?: number;
  height?: number;
  content?: string;
}

export type KlipyItem = KlipyGif | KlipyAd;

export interface KlipyPage {
  data: KlipyItem[];
  current_page?: number;        // in every docs sample; only has_next is modelled by the Android DTO
  per_page?: number;            // in every docs sample
  has_next?: boolean;           // drives "load more"; read as (has_next ?? false)
  total?: number;               // not documented anywhere; never rely on it
  meta?: { item_min_width?: number; ad_max_resize_percent?: number };
}

export interface KlipyEnvelope<T> {
  result: boolean;
  data: T;
}

export type KlipyGifListResponse = KlipyEnvelope<KlipyPage>;
```

Runtime strictness: the official Android DTOs declare every one of these fields nullable
(`MediaItemResponseDto`, `DataDto`, `MediaItemDto`, `DimensionsDto`, `FileTypesDto`, `FileMetaDataDto`).
The REST samples in the docs always include `url`, `width`, `height` and `size`, but narrow at the
boundary anyway: drop any item without a `slug` or without a usable gif rendition.

`id` mapping: use `slug` as the item id in the app model. The REST samples also return a numeric `id`
(for example `8041071659142944`), but the official Android DTO does not model it and every other
endpoint keys on the slug (`gifs/items?slugs=`, `gifs/share/{slug}`, `gifs/report/{slug}`,
`DELETE gifs/recent/{customer_id}?slug=`). Keep the numeric `id` out of the app model.

Rendition fallbacks:

- Preview in the grid: `file.sm.gif.url`, fall back to `file.xs.gif.url`.
- Send into the message: `file.md.gif.url`, fall back to `file.hd.gif.url`.
- If a chain yields nothing, drop the item rather than rendering a broken tile.

```ts
const pickGif = (file: KlipyFile, tiers: KlipyTier[]): string | null =>
  tiers.map(t => file[t]?.gif?.url).find(Boolean) ?? null;

const previewUrl = pickGif(item.file, ['sm', 'xs']);
const sendUrl    = pickGif(item.file, ['md', 'hd']);
```

`blur_preview` is a ready base64 JPEG data URI; use it as the placeholder while the gif loads.

Ads: ads are opt-in per key in the Partner Dashboard. With ads disabled no `type: "ad"` object is
returned. Keep ads off for an internal tool, and still discriminate on `type === 'gif'` when narrowing
the union.

---

## 3. Media host allowlist

Allow `static.klipy.com` and `static.klipy.co`. Add a further host only where official evidence supports
it. Everything in the table below is either that baseline or documented on the KLIPY Network
Requirements page, all HTTPS on port 443. Nothing else has evidence behind it, so do not widen to
`*.klipy.com`.

| Host | Evidence | Use |
|---|---|---|
| `static.klipy.com` | docs Network Requirements; every media URL in the official samples | media, `img-src` |
| `static.klipy.co` | observed serving media on 2026-08-17; not in the docs list | media, `img-src` |
| `static1.klipy.com` | docs Network Requirements | media, `img-src` |
| `static2.klipy.com` | docs Network Requirements | media, `img-src` |
| `api.klipy.com` | docs Network Requirements | API, `connect-src` |

```
img-src 'self' data: https://static.klipy.com https://static.klipy.co https://static1.klipy.com https://static2.klipy.com;
connect-src 'self' https://api.klipy.com;
```

Host allowlisting stays necessary; do not substitute an extension check. The gif renditions in the
official samples do end in `.gif`, but the same tier object also carries `.webp`, `.jpg`, `.mp4` and
`.webm` URLs, and nothing in the docs guarantees the pathname suffix. Select the rendition by reading
`file[tier].gif.url`, never by sniffing the URL, and validate the origin against the host list, because
the origin is what CSP actually enforces.

Integration Requirements that bind the media layer: use the returned URLs as provided, do not strip or
rewrite URL parameters, do not mirror, re-host or cache the media, and do not reorder, insert, remove or
filter the returned result set client side. Any filtering must be configured in the Partner Panel.

---

## 4. Attribution

Two sources with different force. Ship both.

**API Terms of Use (contractual, mandatory):** "you must (i) visibly include 'Powered by KLIPY' and our
logo within your Application". The Terms also require displaying attribution details such as usernames
or sources wherever KLIPY provides them, and forbid putting KLIPY marks in your product name or implying
endorsement.

**Docs, API Usage & Attribution Guidelines:**

- `Search KLIPY` as the default placeholder text in the search input: marked REQUIRED.
- KLIPY watermark on the shared content message card: marked OPTIONAL.
- Visible "Powered by KLIPY" mark wherever KLIPY content is shown: marked OPTIONAL.

The docs label "Powered by KLIPY" optional while the Terms make it mandatory. Follow the Terms.

Placement for this app: a persistent footer row inside the GIF picker popover, visible whenever KLIPY
results are on screen, using the official logo asset rather than a text-only mark. The exact visible
text is `Powered by KLIPY` next to the official logo. For a GIF that has already been sent into a
conversation, the safe N2Hub placement is a small `Powered by KLIPY` caption directly below the shared
GIF in the message bubble, which satisfies "visibly include ... within your Application" for content
that is displayed outside the picker. The official logo assets are linked from the docs attribution page
(Google Drive folder, URL in section 8).

Search placeholder: the exact string `Search KLIPY`. This is the one user-facing string in the picker
that stays in English despite the Polish UI, because KLIPY requires that wording.

Creator or source attribution: the GIF payload documented today exposes `slug`, `title`, `tags`, `type`,
`file`, `blur_preview` and `id`. No creator, username or source field is returned by the GIF endpoints,
so there is nothing extra to render today. If such a field appears in a response, the Terms require
showing it clearly.

---

## 5. Share registration

```
POST https://api.klipy.com/api/v1/{API_KEY}/gifs/share/{slug}
Content-Type: application/json

{ "customer_id": "stable-user-id", "q": "<search string that led to this share>" }
```

- API key: path segment, same position as on the GET calls. `slug`: path parameter, documented REQUIRED.
- Minimum body is `{"customer_id": "stable-user-id"}`; that single field is exactly what the official
  `TriggerViewRequestDto` carries. The docs add one more body parameter, `q`, described as "Required for
  the Search API. Keep empty when using the Trending API." Neither field is flagged REQUIRED in the docs
  parameter table.
- Content-Type: `application/json`. The official Android demo posts through Retrofit with a Gson
  converter, which sends `application/json`. The docs curl sample uses `--data` with a JSON string but
  sets no header, which in curl means `application/x-www-form-urlencoded`; follow the Android client.
- Response: the docs document `{ "result": true }` and a single `result` boolean attribute. Assume
  nothing beyond that boolean; no data payload is documented, so do not parse further.
- When to call: once per GIF, after the message send succeeds. Not on hover, not on grid render, not on
  preview, and not before the message is persisted.

Required versus recommended: the docs do not label this call REQUIRED the way they label the
`Search KLIPY` placeholder. It is analytics and personalization ("improves personalization and helps
surface more relevant content"; "No personal data is collected"). Implement it anyway, because the
Integration Requirements forbid interfering with ranking, measurement, reporting or attribution, and
because it feeds the Recent Items endpoint. Treat it as fire and forget: never block, delay or fail the
message send on its result.

Related endpoints, out of scope for v1: `POST api/v1/{app_key}/gifs/report/{slug}` with
`{ customer_id, reason }` from the documented reason list. Note that the official Android service also
declares `POST gifs/view/{slug}`, which is not in the public GIF endpoint list; do not implement it.

---

## 6. Operator key setup

1. Sign in at https://partner.klipy.com, open API Keys, and use Add Platform to create a Web platform,
   giving it the App URL of the deployed SPA; the panel issues the test key for that platform.
2. A new key is in Testing mode and is capped at 100 API calls per hour per key.
3. Build and verify against the test key, then request Production access from the form in the Partner
   Panel; the form asks for the app category, estimated MAU and a screen recording of the integration.
4. After approval, production is documented as unlimited API requests and free.
5. Put the key into `VITE_KLIPY_API_KEY` and add it to `.env.example`.

---

## 7. CORS and pure-browser suitability

- The key travels in the URL path and ships inside the Vite bundle. It is a public client key, not a
  secret. `VITE_*` variables are inlined at build time; treat the key as published and rotate it from
  the Partner Panel if it is abused.
- No `Authorization` header and no custom request headers on the GET calls, so search and trending are
  CORS-simple requests with no preflight.
- Browser probe on 2026-08-17: the native endpoints responded with `Access-Control-Allow-Origin: *`.
  Plain `fetch()` from the SPA works with no proxy and no server component.
- This is the sanctioned shape, not a workaround: the Integration Requirements state that API requests
  and media loads must originate from the user's browser or app, and forbid routing them through
  partner-operated servers, proxies or CDNs without prior written approval. The same section forbids
  storing, mirroring or re-hosting the media, so load every rendition directly from the static hosts
  with `<img src>`.
- The share POST sends `Content-Type: application/json`, which is not a CORS-simple header value, so it
  triggers an `OPTIONS` preflight. Verify that preflight once against the real key during
  implementation. Because the call is fire and forget, a preflight failure must not affect the send path.
- The Partner Panel records an App URL for each platform, but no referrer or origin restriction is
  documented anywhere in the API docs or terms. Do not assume one exists and do not rely on one.

---

## 8. Sources

Official KLIPY:

- Developers: https://klipy.com/developers
- API Overview: https://klipy.com/api-overview
- Docs, Getting Started: https://docs.klipy.com/getting-started
- Docs, Integration Requirements: https://docs.klipy.com/integration-requirements
- Docs, Network Requirements: https://docs.klipy.com/network-requirements
- Docs, GIF API index: https://docs.klipy.com/gifs-api
- Docs, GIF Trending API: https://docs.klipy.com/gifs-api/gifs-trending-api
- Docs, GIF Search API: https://docs.klipy.com/gifs-api/gifs-search-api
- Docs, GIF Share Trigger API: https://docs.klipy.com/gifs-api/gifs-share-trigger-api
- Docs, GIF Format Sizes: https://docs.klipy.com/gifs-api/gifs-format-sizes
- Docs, API Usage & Attribution Guidelines: https://docs.klipy.com/attribution
- Docs, Content filtering: https://docs.klipy.com/content-filtering
- Docs, Migrate from Tenor: https://docs.klipy.com/migrate-from-tenor
- Migration landing page: https://klipy.com/migrate
- Migration repo: https://github.com/KLIPY-com/Migrate-From-Tenor-To-Klipy
- API Terms of Use: https://klipy.com/support/api-terms
- Partner Panel guide (blog): https://klipy.com/blog/klipy-partner-panel
- Partner Panel: https://partner.klipy.com and https://partner.klipy.com/api-keys
- Official logo assets, linked from the docs attribution page:
  https://drive.google.com/drive/u/3/folders/1ix5_5221kgbJHPqhCxwPsqHlHexhQP2w

Official Android demo app (MIT): https://github.com/KLIPY-com/klipy-android-demo-app
Source files used here, all under `https://github.com/KLIPY-com/klipy-android-demo-app/blob/main/`:

- `app/src/main/java/com/klipy/demoapp/data/service/GifService.kt` gives `GET gifs/trending`,
  `GET gifs/search` (`q`, `page`, `per_page`), `POST gifs/share/{slug}`, `POST gifs/report/{slug}`,
  `GET gifs/recent/{customer_id}`
- `app/src/main/java/com/klipy/demoapp/data/di/NetworkModule.kt` gives the Retrofit base URL
  `https://api.klipy.com/api/v1/$secretKey/`
- `app/src/main/java/com/klipy/demoapp/data/dto/MediaItemResponseDto.kt` gives `result`, `data`
- `app/src/main/java/com/klipy/demoapp/data/dto/DataDto.kt` gives `data`, `has_next`, `meta`
- `app/src/main/java/com/klipy/demoapp/data/dto/MediaItemDto.kt` gives `slug`, `title`, `blur_preview`,
  `file`, `type`
- `app/src/main/java/com/klipy/demoapp/data/dto/DimensionsDto.kt` gives `hd`, `md`, `sm`, `xs`
- `app/src/main/java/com/klipy/demoapp/data/dto/FileTypesDto.kt` gives `gif`, `webp`, `mp4`
- `app/src/main/java/com/klipy/demoapp/data/dto/FileMetaDataDto.kt` gives `url`, `width`, `height`,
  `size`
- `app/src/main/java/com/klipy/demoapp/data/dto/request/TriggerViewRequestDto.kt` gives `customer_id`.
  Note the `request/` segment: the file is under `data/dto/request/`, not directly under `data/dto/`.

Official iOS demo app: https://github.com/KLIPY-com/klipy-ios-demo-app

Verification, 2026-08-17: endpoint paths, parameter tables, defaults, limits, sample responses,
attribution guidelines, network host list and the share body were read directly from docs.klipy.com;
the base URL, service paths and DTO field names were read from the raw sources of the official Android
demo; the attribution clause was read from the API Terms of Use; the wildcard CORS header comes from a
browser probe of the native endpoints on that date.
