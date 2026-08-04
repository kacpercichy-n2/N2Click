// Typy mappera importu TWS. Mapper jest zwykłym `.mjs` (uruchamia go node bez
// żadnego kroku budowania), a `tsconfig.json` obejmuje wyłącznie `src` i nie ma
// `allowJs` — bez tej deklaracji test w `src/contentplan/` nie przeszedłby
// `tsc --noEmit`. Kształt trzymany ręcznie i celowo wąski: opisuje tylko to, co
// konsumuje test i skrypt I/O.

export interface TwsSeedBrandRow {
  id: string;
  name: string;
  industry: string;
  contact: string;
  accent: string;
  platforms: Array<{ id: string; name: string; color: string }>;
  topics: string[];
  formats: string[];
  n2clickClientId: string | null;
}

export interface TwsSeedPostRow {
  id: string;
  sourceId: string;
  brandId: string;
  date: string;
  title: string;
  topic: string;
  format: string;
  status: string;
  visibility: 'draft' | 'published';
  baseTags: string[];
}

export interface TwsSeedChannelRow {
  id: string;
  postId: string;
  platformId: string;
  copy: string;
  tags: string[];
  overrideTags: boolean;
  descriptionGroupId: string | null;
  mediaSource: 'gdrive' | null;
  mediaFileId: string | null;
  mediaType: 'image' | 'video' | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
}

export interface TwsSeed {
  brand: TwsSeedBrandRow;
  posts: TwsSeedPostRow[];
  channels: TwsSeedChannelRow[];
}

export interface TwsSeedMeta {
  platforms: Record<string, { name: string; color?: string }>;
  statuses: Record<string, { step: number }>;
  contentTypes: Record<string, { name: string }>;
}

export interface TwsSeedInput {
  posts: readonly unknown[];
  client: { name: string; handle?: string; color?: string };
  clientKey: string;
  meta: TwsSeedMeta;
}

export declare const TWS_IMPORT_NAMESPACE: string;
export declare const SHEET_STATUS_TO_PLANNER: Record<string, string>;
export declare const PLANNER_STATUS_TO_MODULE: Record<string, string>;
export declare const FALLBACK_MODULE_STATUS: string;
export declare const PUBLISHED_FROM_STEP: number;

export declare function uuidV5(name: string, namespace?: string): string;
export declare function brandUuid(clientKey: string): string;
export declare function postUuid(sourceId: string): string;
export declare function channelUuid(sourceId: string, platformId: string): string;
export declare function plannerStatusFromSheet(value: unknown): string;
export declare function plannerStatusOf(
  post: unknown,
  statuses: Record<string, { step: number }>,
): string;
export declare function mapTwsSeed(input: TwsSeedInput): TwsSeed;
export declare function renderSeedSql(seed: TwsSeed): string;
