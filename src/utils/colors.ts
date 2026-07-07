// Deterministic person colours. A fixed palette of accessible, visually distinct
// hues. To guarantee distinctness for a real team, colours are assigned by each
// person's stable position in the people list (registered once by the store).
// A hash fallback keeps personColor(id) usable for ids not yet registered.

const PALETTE = [
  '#2563eb', // blue
  '#e11d48', // rose
  '#059669', // emerald
  '#d97706', // amber
  '#7c3aed', // violet
  '#db2777', // pink
  '#0891b2', // cyan
  '#65a30d', // lime
  '#ea580c', // orange
  '#4f46e5', // indigo
];

// personId -> palette index, keyed by stable creation/list order.
const order = new Map<string, number>();

/**
 * Register the ordered list of person ids so colours are assigned by position.
 * Idempotent and cheap; safe to call on every render with the current people.
 * New ids get the next free palette slot, wrapping around the palette.
 */
export function registerPersonOrder(ids: string[]): void {
  for (const id of ids) {
    if (!order.has(id)) {
      order.set(id, order.size % PALETTE.length);
    }
  }
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0; // force 32-bit
  }
  return Math.abs(h);
}

/** Stable colour for a person id (by list position, hash fallback). */
export function personColor(id: string): string {
  const idx = order.get(id);
  if (idx !== undefined) return PALETTE[idx];
  return PALETTE[hashString(id) % PALETTE.length];
}
