// Deterministic person colours. A fixed palette of visually distinct hues,
// re-picked for the N2 Media DARK theme. Constraints for this palette:
//   1. Every colour must read clearly on dark glass surfaces (--n2-surface),
//      so they are light/saturated variants (also used as dark-text avatar fills).
//   2. No hue may be confusable with --n2-danger (#ff4f72, a rose-red) used for
//      overload/error tinting — the rose/red-pink region (~330-360°) is dropped
//      entirely (sweep runs orange → gold → green → cyan → blue → violet only).
//   3. Colours are assigned by each person's stable position in the people list
//      (registered once by the store); a hash fallback keeps personColor(id)
//      usable for ids not yet registered.
// Order interleaves the most-different hues first so small teams stay maximal.

const PALETTE = [
  '#5b9dff', // azure blue
  '#3fe0a3', // spring green
  '#ffca45', // gold
  '#c58bff', // violet
  '#38d0e0', // cyan
  '#ff9640', // orange
  '#7fe05b', // green
  '#a98bff', // indigo
  '#d8e84f', // chartreuse
  '#7c8cff', // cornflower
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
