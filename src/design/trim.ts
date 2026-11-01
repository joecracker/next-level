// The trim and extras page for cabinets (crown, scribe, toe kick, base shoe, furniture molding, a touch-up kit,
// and any other lines), plus the finish names that go on the takeoff. Handles are left out on purpose.
import { KINDS, type Design } from './model';
import { APP_FINISHES, CAB_COLORS, FLOOR_COLORS, WALL_COLORS, TOP_COLORS } from './finishes';

export const TRIM_ITEMS: Array<{ id: string; label: string; hint?: string }> = [
  { id: 'crown', label: 'Crown molding' },
  { id: 'scribe', label: 'Scribe molding' },
  { id: 'toekick', label: 'Toe kick' },
  { id: 'shoe', label: 'Base shoe' },
  { id: 'furn', label: 'Furniture molding', hint: 'Tall 1x with an ogee edge, stained to match the cabinets (usually the back of an island).' },
];

/** Rough lengths worked out from the drawing, in feet, to compare against your own count. */
export function trimSuggest(d: Design): Record<string, number> {
  let toe = 0, crown = 0, furn = 0;
  for (const it of d.items) {
    const k = KINDS[it.kind]; if (!k) continue;
    if (it.kind === 'upper') crown += it.w;
    else if (k.cab && k.layer === 'floor' && it.kind !== 'endpanel') { toe += it.w; if (it.kind === 'island') furn += it.w; }
  }
  const ft = (i: number) => Math.round((i / 12) * 10) / 10;
  return { crown: ft(crown), toekick: ft(toe), furn: ft(furn) };
}

const nameOf = (list: Array<{ id: string; name: string }>, id: string | undefined) => list.find(x => x.id === id)?.name;

/** Takeoff lines: the trim counts and the finish names. */
export function trimLines(d: Design): Array<{ desc: string; qty: number; note: string }> {
  const out: Array<{ desc: string; qty: number; note: string }> = [];
  const q = d.acc?.q || {};
  for (const t of TRIM_ITEMS) if ((q[t.id] || 0) > 0) out.push({ desc: t.label, qty: q[t.id], note: 'linear feet' + (t.id === 'furn' ? ', stained to match the cabinets' : '') });
  const cab = nameOf(CAB_COLORS, d.finish?.cab);
  if (q.touchup) out.push({ desc: 'Touch-up kit', qty: 1, note: cab ? 'for ' + cab : '' });
  for (const r of d.acc?.x || []) if (r.label.trim() && r.qty > 0) out.push({ desc: r.label.trim(), qty: r.qty, note: r.unit === 'ft' ? 'linear feet' : '' });
  if (cab) out.push({ desc: 'Cabinet color - ' + cab, qty: 1, note: 'base and tall cabinets (closest shade; confirm the maker\'s finish name)' });
  const up = nameOf(CAB_COLORS, d.finish?.upper); if (up) out.push({ desc: 'Upper cabinet color - ' + up, qty: 1, note: 'wall cabinets' });
  const app = d.finish?.app ? nameOf(APP_FINISHES, d.finish.app) : undefined; if (app) out.push({ desc: 'Appliance finish - ' + app, qty: 1, note: '' });
  const top = nameOf(TOP_COLORS, d.counter?.color); if (top) out.push({ desc: 'Countertop color - ' + top, qty: 1, note: 'room default' });
  const wall = nameOf(WALL_COLORS, d.finish?.wall); if (wall) out.push({ desc: 'Wall paint color - ' + wall, qty: 1, note: '' });
  const fl = nameOf(FLOOR_COLORS, d.floor?.color); if (fl) out.push({ desc: 'Floor tile color - ' + fl, qty: 1, note: '' });
  return out;
}
