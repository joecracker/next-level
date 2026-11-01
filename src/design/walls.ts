// Per-wall heights. d.wallH holds one height (inches) per wall, same order as d.pts; 0 or missing means
// "all the way to the ceiling". If the wall count no longer matches (a corner was added or removed some
// other way), the heights are ignored rather than put on the wrong wall.
import { T, fmtIn, seg, type Design } from './model';

export function wallHeights(d: Design): number[] {
  const w = d.wallH; const n = d.pts.length;
  return d.pts.map((_, i) => (w && w.length === n && w[i] > 0 ? w[i] : 0));
}

export function setWallHeight(d: Design, i: number, h: number): Design {
  const a = wallHeights(d); a[i] = h > 0 ? h : 0;
  return { ...d, wallH: a.some(x => x > 0) ? a : undefined };
}

/** Small label under a wall's length on the plan, only for walls with their own height. */
export function wallTag(d: Design, i: number): string {
  const h = wallHeights(d)[i];
  return h ? fmtIn(h) + ' high' : '';
}

/** Walls shorter than the ceiling get a lighter band so they read as low walls. */
export function lowWallsSvg(d: Design): string {
  const ceil = d.ceiling || 96; const o: string[] = [];
  wallHeights(d).forEach((h, i) => {
    if (!(h > 0) || h >= ceil - 0.01) return;
    const s = seg(d.pts, i); const k = T / 2; // the wall band sits outside the room edge, so shift outward by half a wall
    const f = (v: number) => String(Math.round(v * 100) / 100);
    o.push('<line x1="' + f(s.ax - s.nx * k) + '" y1="' + f(s.ay - s.ny * k) + '" x2="' + f(s.bx - s.nx * k) + '" y2="' + f(s.by - s.ny * k) + '" stroke="#c9cdc7" stroke-width="' + T + '"/>');
  });
  return o.join('');
}

/** Takeoff lines for walls that stop short of the ceiling. */
export function wallLines(d: Design): Array<{ desc: string; qty: number; note: string }> {
  const ceil = d.ceiling || 96; const out: Array<{ desc: string; qty: number; note: string }> = [];
  wallHeights(d).forEach((h, i) => {
    if (h > 0 && h < ceil - 0.01) out.push({ desc: 'Short wall - ' + fmtIn(h) + ' high', qty: 1, note: 'Wall ' + (i + 1) + ', ' + fmtIn(seg(d.pts, i).L) + ' long' });
  });
  return out;
}
