// A tiled corner storage unit for a shower corner: a triangle that fills a 90 degree corner, with small side
// returns ("wings") where it meets the walls, a bottom shelf raised off the floor, optional middle shelves,
// and a granite top. Shapes are worked out from a few numbers so any size can be typed in. Visual only.
//
// Footprint, in the item's own box (the right-angle corner is at 0,0; the legs run along +x and +y):
//   (0,0) -> (a,0) -> (a,r) -> (r,a) -> (0,a), where a = length along each wall and r = the side return.
import { fmtIn, frame, polyArea, type DItem, type Design, type Pt } from './model';
import { colorPaint } from './finishes';
import { counterOf, matOf } from './counter';

/** Is the point inside the corner unit's own triangle? Its drawing starts at the box's top-left corner (see fixtureShape), so the box is shifted to match. */
export function cornerHit(it: DItem, pts: Pt[], x: number, y: number): boolean {
  const f = frame(it, pts); const dx = x - f.cx, dy = y - f.cy;
  const lx = dx * f.ux + dy * f.uy + it.w / 2, ly = dx * f.nx + dy * f.ny + it.d / 2;
  const poly = cornerPoly(cuOf(it)); let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > ly) !== (yj > ly) && lx < ((xj - xi) * (ly - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface CU { a: number; r: number; h: number; topT: number; shelves: number; lift: number }
type P2 = [number, number];
const S2 = Math.SQRT2;

export function cuOf(it: DItem): CU {
  const p = it.p || {}; const a = Math.max(12, p.legs || it.w || 38);
  return { a, r: Math.max(0, Math.min(p.wing ?? 3, a / 2 - 2)), h: p.h || 34, topT: p.topT || 1.25, shelves: Math.max(0, Math.min(3, p.shelves ?? 1)), lift: Math.max(0, p.lift ?? 3) };
}
/** Remove repeated points (a zero-size side return would otherwise repeat a corner). */
export function dedupe(pts: P2[]): P2[] {
  const out: P2[] = [];
  pts.forEach((q, i) => { const prev = out[out.length - 1] || pts[pts.length - 1]; if (i === 0 || Math.hypot(q[0] - prev[0], q[1] - prev[1]) > 0.05) out.push(q); });
  return out;
}
export function cornerPoly(c: CU): P2[] { return dedupe([[0, 0], [c.a, 0], [c.a, c.r], [c.r, c.a], [0, c.a]]); }
/** The open face (the long side that you reach into), in inches. */
export const faceLen = (c: CU): number => S2 * (c.a - c.r);
/** The granite top: the face pushed out a little past the tile. */
export function topPoly(c: CU, over = 1.5): P2[] { const o = over / S2; return dedupe([[0, 0], [c.a, 0], [c.a + o, c.r + o], [c.r + o, c.a + o], [0, c.a]]); }
/** The toe recess under the bottom shelf: the face pulled back a little. */
export function insetPoly(c: CU, t = 2): P2[] { const o = t / S2; return dedupe([[0, 0], [c.a, 0], [c.a - o, Math.max(0, c.r - o)], [Math.max(0, c.r - o), c.a - o], [0, c.a]]); }
/** Heights (inches off the floor) of the underside of each middle shelf. */
export function midShelves(c: CU, thick = 1): number[] {
  const lo = c.lift + thick, hi = c.h - thick; const out: number[] = [];
  for (let k = 1; k <= c.shelves; k++) out.push(lo + (k * (hi - lo)) / (c.shelves + 1) - thick / 2);
  return out;
}

/** Room corners that are right angles (the only ones this unit fits). */
export function rightCorners(d: Design): number[] {
  const n = d.pts.length; const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = d.pts[i], a = d.pts[(i + n - 1) % n], b = d.pts[(i + 1) % n];
    const u1: P2 = [b.x - p.x, b.y - p.y], u2: P2 = [a.x - p.x, a.y - p.y];
    const l1 = Math.hypot(u1[0], u1[1]) || 1, l2 = Math.hypot(u2[0], u2[1]) || 1;
    if (Math.abs((u1[0] * u2[0] + u1[1] * u2[1]) / (l1 * l2)) < 0.05) out.push(i);
  }
  return out;
}
/** Where to put and turn the unit so its right angle sits in room corner `i`. */
export function cornerPlace(d: Design, it: DItem, i: number): Partial<DItem> {
  const n = d.pts.length; const p = d.pts[i], a = d.pts[(i + n - 1) % n], b = d.pts[(i + 1) % n];
  const norm = (x: number, y: number): P2 => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  const d1 = norm(b.x - p.x, b.y - p.y), d2 = norm(a.x - p.x, a.y - p.y);
  const cross = d1[0] * d2[1] - d1[1] * d2[0];
  const ux = cross > 0 ? d1 : d2; const nx: P2 = [-ux[1], ux[0]];
  return { wall: null, rot: Math.round(Math.atan2(ux[1], ux[0]) * 18000 / Math.PI) / 100, x: p.x + ux[0] * it.w / 2 + nx[0] * it.d / 2, y: p.y + ux[1] * it.w / 2 + nx[1] * it.d / 2 };
}

/** Takeoff lines for the unit and its top. */
export function cornerLines(d: Design): Array<{ desc: string; qty: number; note: string }> {
  const out: Array<{ desc: string; qty: number; note: string }> = [];
  for (const it of d.items) {
    if (it.kind !== 'cornerunit') continue;
    const c = cuOf(it); const cp = colorPaint(it.p?.tcolor || d.counter?.color);
    out.push({ desc: 'Corner storage unit, tiled', qty: 1, note: fmtIn(c.a) + ' along each wall, face about ' + fmtIn(Math.round(faceLen(c))) + ', ' + fmtIn(c.h) + ' high, ' + (c.shelves + 1) + ' pocket' + (c.shelves ? 's' : '') });
    out.push({ desc: 'Corner unit top - ' + matOf(counterOf(d).mat).name + (cp ? ', ' + cp.name.toLowerCase() : ''), qty: 1, note: 'about ' + Math.round(polyArea(topPoly(c)) / 14.4) / 10 + ' sq ft, ' + c.topT + '" thick' });
  }
  return out;
}
