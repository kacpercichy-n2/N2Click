// Portal klienta N2 Content Planu — warstwa danych i słowniki prezentacji.
// Appka jest SAMODZIELNA (własny bundle, zero kodu Huba): czyta wyłącznie
// schemat `contentplan` przez RLS roli `client`, a jedyną ścieżką zapisu jest
// RPC `client_review`. Świadoma, mała duplikacja słowników wizualnych z Huba —
// portal nie może ciągnąć bundla aplikacji wewnętrznej.
import { createClient } from '@supabase/supabase-js';

// Fallbacki na sztywno: klucz PUBLISHABLE jest z założenia publiczny (dostęp
// do danych wymusza RLS), a narzędzie deployu nie przenosi zmiennych env.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://rclcndcgxbpndpmuemww.supabase.co';
const key =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  'sb_publishable_W0jjDs4b1hpjVYTszIiWrg_8Uzf1ZAi';

export const supabase = createClient(url, key, { db: { schema: 'contentplan' } });

// ---- Model (kształt wierszy schematu contentplan) ---------------------------

export interface Platform {
  id: string;
  name: string;
  color: string;
}

export interface Brand {
  id: string;
  name: string;
  contact: string;
  accent: string;
  platforms: Platform[];
}

export interface Channel {
  id: string;
  post_id: string;
  platform_id: string;
  copy: string;
  tags: string[];
  override_tags: boolean;
  media_source: string | null;
  media_file_id: string | null;
  media_width: number | null;
  media_height: number | null;
  media_type: 'image' | 'video' | null;
}

export interface Post {
  id: string;
  brand_id: string;
  date: string;
  title: string;
  topic: string;
  format: string;
  status: string;
  base_tags: string[];
  post_channels: Channel[];
}

export async function fetchBrands(): Promise<Brand[]> {
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, contact, accent, platforms')
    .order('name');
  if (error) throw error;
  return (data ?? []) as Brand[];
}

export async function fetchPosts(): Promise<Post[]> {
  const { data, error } = await supabase
    .from('posts')
    .select(
      'id, brand_id, date, title, topic, format, status, base_tags, post_channels(*)',
    )
    .order('date');
  if (error) throw error;
  return (data ?? []) as Post[];
}

export async function sendReview(
  postId: string,
  decision: 'Akceptacja' | 'Uwagi',
  comment?: string,
): Promise<void> {
  const { error } = await supabase.rpc('client_review', {
    p_post_id: postId,
    p_decision: decision,
    ...(comment !== undefined ? { p_comment: comment } : {}),
  });
  if (error) throw error;
}

// ---- Statusy w języku klienta ------------------------------------------------

export interface ClientStatus {
  label: string;
  kind: 'pending' | 'approved' | 'commented' | 'rework' | 'ready' | 'published' | 'wip';
}

/** Mapowanie wewnętrznych statusów na świat klienta (bez kuchni agencyjnej). */
export function clientStatus(status: string): ClientStatus {
  switch (status) {
    case 'Opublikowano':
      return { label: 'Opublikowany', kind: 'published' };
    case 'Zaplanowane':
      return { label: 'Gotowy do publikacji', kind: 'ready' };
    case 'Akceptacja':
      return { label: 'Zaakceptowany przez Ciebie', kind: 'approved' };
    case 'Do akceptacji':
      return { label: 'Czeka na Twoją akceptację', kind: 'pending' };
    case 'Uwagi':
      return { label: 'Twoja uwaga wysłana', kind: 'commented' };
    case 'Wdrażane poprawki':
      return { label: 'Wprowadzamy Twoje poprawki', kind: 'rework' };
    default:
      return { label: 'W przygotowaniu', kind: 'wip' };
  }
}

// ---- Pomocnicze --------------------------------------------------------------

export const MONTHS = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
];

/** Mianownik do nagłówka hero („sierpień 2026"). */
export const MONTHS_NOM = [
  'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
];

export const DAYS_FULL = [
  'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela',
];

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayLabel(iso: string): { num: string; dow: string; long: string } {
  const d = new Date(`${iso}T12:00:00`);
  return {
    num: String(d.getDate()).padStart(2, '0'),
    dow: DAYS_FULL[(d.getDay() + 6) % 7],
    long: `${d.getDate()} ${MONTHS[d.getMonth()]}`,
  };
}

/** Proporcja kadru miniatury: wymiary pliku, inaczej heurystyka formatu. */
export function mediaRatio(channel: Channel | undefined, format: string): string {
  if (channel?.media_width && channel.media_height) {
    return `${channel.media_width} / ${channel.media_height}`;
  }
  const f = format.toLocaleLowerCase('pl-PL');
  if (f.includes('reel') || f.includes('story')) return '9 / 16';
  if (f.includes('wideo') || f.includes('video')) return '16 / 9';
  return '3 / 4';
}

export function driveThumb(fileId: string): string {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w640`;
}

/** Inicjały marki do pastylki-avatara. */
export function brandInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '??';
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase('pl-PL');
  return (words[0][0] + words[1][0]).toLocaleUpperCase('pl-PL');
}
