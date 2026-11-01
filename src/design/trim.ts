// The trim and extras page for cabinets (crown, scribe, toe kick, base shoe, furniture molding, a touch-up kit,
// and any other lines), plus the finish names that go on the takeoff. Handles are left out on purpose.
import { KINDS, type Design } from './model';
import { APP_FINISHES, FLOOR_COLORS, WALL_COLORS, TOP_COLORS, cabLabel } from './finishes';

export const TRIM_ITEMS: Array<{ id: string; label: string; hint?: string }> = [
  { id: 'crown', label: 'Crown molding' },
  { id: 'scribe', label: 'Scribe molding' },
  { id: 'toekick', label: 'Toe kick' },
  { id: 'shoe', label: 'Base shoe' },
  { id: 'furn', label: 'Furniture molding', hint: 'Tall 1x with an ogee edge, stained to match the cabinets (usually the back of an island).' },
];

/** Trim is bought in 8 ft pieces. */
export const PIECE_FT = 8;

/** Rough lengths worked out from the drawing: the feet, and how many 8 ft pieces that takes (rounded up). */
export function trimSuggest(d: Design): Record<string, { ft: number; pcs: number }> {
  let toe = 0, crown = 0, furn = 0;
  for (const it of d.items) {
    const k = KINDS[it.kind]; if (!k) continue;
    if (it.kind === 'upper') crown += it.w;
    else if (k.cab && k.layer === 'floor' && it.kind !== 'endpanel') { toe += it.w; if (it.kind === 'island') furn += it.w; }
  }
  const m = (i: number) => ({ ft: Math.round((i / 12) * 10) / 10, pcs: i > 0 ? Math.ceil(i / 12 / PIECE_FT - 0.001) : 0 });
  return { crown: m(crown), toekick: m(toe), furn: m(furn) };
}

const nameOf = (list: Array<{ id: string; name: string }>, id: string | undefined) => list.find(x => x.id === id)?.name;

/** Takeoff lines: the trim counts and the finish names. */
export function trimLines(d: Design): Array<{ desc: string; qty: number; note: string }> {
  const out: Array<{ desc: string; qty: number; note: string }> = [];
  const q = d.acc?.q || {};
  for (const t of TRIM_ITEMS) if ((q[t.id] || 0) > 0) out.push({ desc: t.label, qty: q[t.id], note: '8 ft pieces (' + q[t.id] * PIECE_FT + ' ft)' + (t.id === 'furn' ? ', stained to match the cabinets' : '') });
  const cab = cabLabel(d.finish?.cab);
  if (q.touchup) out.push({ desc: 'Touch-up kit', qty: 1, note: cab ? 'for ' + cab : '' });
  for (const r of d.acc?.x || []) if (r.label.trim() && r.qty > 0) out.push({ desc: r.label.trim(), qty: r.qty, note: r.unit === 'ft' ? 'linear feet' : '' });
  if (cab) out.push({ desc: 'Cabinet color - ' + cab, qty: 1, note: (d.finish?.cab || '').includes(':') ? 'base and tall cabinets' : 'base and tall cabinets (closest shade; confirm the maker\'s finish name)' });
  const up = cabLabel(d.finish?.upper); if (up) out.push({ desc: 'Upper cabinet color - ' + up, qty: 1, note: 'wall cabinets' });
  const own = new Map<string, string[]>();
  for (const it of d.items) { const l = cabLabel(it.p?.ccolor); if (l) own.set(l, [...(own.get(l) || []), it.label || it.code || KINDS[it.kind]?.name || it.kind]); }
  for (const [l, names] of own) out.push({ desc: 'Cabinet color - ' + l, qty: 1, note: 'only on: ' + names.slice(0, 12).join(', ') });
  const app = d.finish?.app ? nameOf(APP_FINISHES, d.finish.app) : undefined; if (app) out.push({ desc: 'Appliance finish - ' + app, qty: 1, note: '' });
  const top = nameOf(TOP_COLORS, d.counter?.color); if (top) out.push({ desc: 'Countertop color - ' + top, qty: 1, note: 'room default' });
  const wall = nameOf(WALL_COLORS, d.finish?.wall); if (wall) out.push({ desc: 'Wall paint color - ' + wall, qty: 1, note: '' });
  const fl = nameOf(FLOOR_COLORS, d.floor?.color); if (fl) out.push({ desc: 'Floor tile color - ' + fl, qty: 1, note: '' });
  return out;
}
