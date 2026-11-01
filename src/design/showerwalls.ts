// Walls, glass, a door and a bench for a shower whose floor is drawn corner by corner (p.poly).
// Each side of the floor (corner i to corner i+1) has a kind in p.sides; p.bench puts a seat along one side.
// Coordinates are the shower's own box: (0,0) is its back-left corner.
import { T, type DItem, type Design } from './model';

const INK = '#14191A', GL = '#3f8fa8', CURB = '#9ea49a';
const f = (v: number) => Math.round(v * 100) / 100;

export const SIDE_TYPES: Array<[string, string]> = [['open', 'Open'], ['wall', 'Wall'], ['knee', 'Knee wall + glass'], ['glass', 'Glass'], ['door', 'Glass door']];

export function sidesOf(p: Record<string, any>, n: number): string[] {
  const s = p.sides as string[] | undefined;
  return Array.from({ length: n }, (_, i) => (s && s.length === n && s[i]) || 'open');
}

interface Edge { a: [number, number]; b: [number, number]; L: number; ux: number; uy: number; nx: number; ny: number }
/** Every side with its length and the direction pointing out of the floor. */
function edgesOf(poly: Array<[number, number]>): Edge[] {
  const cx = poly.reduce((s, q) => s + q[0], 0) / poly.length, cy = poly.reduce((s, q) => s + q[1], 0) / poly.length;
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]; const dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L; let nx = uy, ny = -ux;
    if (nx * ((a[0] + b[0]) / 2 - cx) + ny * ((a[1] + b[1]) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    return { a, b, L, ux, uy, nx, ny };
  });
}
const doorWidth = (p: Record<string, any>, e: Edge) => Math.min(p.doorW || 30, Math.max(6, e.L - 4));

export function polySidesSvg(it: DItem, S: number, fs: number): string {
  const p = it.p || {}; const poly = p.poly as Array<[number, number]> | undefined; if (!poly || poly.length < 3) return '';
  const n = poly.length; const sides = sidesOf(p, n); const E = edgesOf(poly); const o: string[] = []; const line1 = 1.5 / S; const curb = !!p.curb;
  const P = (x: number, y: number) => f(x) + ',' + f(y);
  const band = (e: Edge, o0: number, o1: number, fill: string) => '<polygon points="' + P(e.a[0] + e.nx * o0, e.a[1] + e.ny * o0) + ' ' + P(e.b[0] + e.nx * o0, e.b[1] + e.ny * o0) + ' ' + P(e.b[0] + e.nx * o1, e.b[1] + e.ny * o1) + ' ' + P(e.a[0] + e.nx * o1, e.a[1] + e.ny * o1) + '" fill="' + fill + '"/>';
  const seg = (x1: number, y1: number, x2: number, y2: number, stroke: string, w: number, extra = '') => '<line x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) + '" stroke="' + stroke + '" stroke-width="' + f(w) + '" ' + extra + '/>';
  const at = (e: Edge, s: number): [number, number] => [e.a[0] + e.ux * s, e.a[1] + e.uy * s];
  const glass = (e: Edge, s0: number, s1: number) => { const A = at(e, s0), B = at(e, s1); return seg(A[0], A[1], B[0], B[1], GL, 2 / S); };
  E.forEach((e, i) => {
    const t = sides[i];
    if (t === 'wall') o.push(band(e, 0, T, INK));
    else if (t === 'knee') { o.push(band(e, -T / 2, T / 2, '#a4a99f')); o.push(glass(e, 0, e.L)); }
    else if (t === 'glass') { if (curb) o.push(band(e, -2, 2, CURB)); o.push(glass(e, 0, e.L)); }
    else if (t === 'door') {
      const dw = doorWidth(p, e); const s0 = (e.L - dw) / 2, s1 = s0 + dw;
      if (curb) o.push(band(e, -2, 2, CURB));
      o.push(glass(e, 0, s0)); o.push(glass(e, s1, e.L));
      const h = at(e, s0), q = at(e, s1); const tip: [number, number] = [h[0] + e.nx * dw, h[1] + e.ny * dw];
      o.push(seg(h[0], h[1], tip[0], tip[1], GL, 2 / S));
      const sweep = e.ux * e.ny - e.uy * e.nx > 0 ? 1 : 0;
      o.push('<path d="M' + f(q[0]) + ' ' + f(q[1]) + ' A' + f(dw) + ' ' + f(dw) + ' 0 0 ' + sweep + ' ' + f(tip[0]) + ' ' + f(tip[1]) + '" fill="none" stroke="' + GL + '" stroke-width="' + f(line1) + '" stroke-dasharray="' + f(4 / S) + ' ' + f(3 / S) + '"/>');
    }
  });
  const bn = p.bench as { edge: number; depth: number } | null | undefined;
  if (bn && bn.edge >= 0 && bn.edge < n) {
    const e = E[bn.edge]; const dep = Math.max(6, bn.depth || 15); const id = 'pb' + String(it.id).replace(/[^a-zA-Z0-9]/g, '');
    const c = [e.a, e.b, [e.b[0] - e.nx * dep, e.b[1] - e.ny * dep], [e.a[0] - e.nx * dep, e.a[1] - e.ny * dep]] as Array<[number, number]>;
    const mx = c.reduce((s, q) => s + q[0], 0) / 4, my = c.reduce((s, q) => s + q[1], 0) / 4;
    o.push('<clipPath id="' + id + '"><polygon points="' + poly.map(q => P(q[0], q[1])).join(' ') + '"/></clipPath><g clip-path="url(#' + id + ')"><polygon points="' + c.map(q => P(q[0], q[1])).join(' ') + '" fill="' + (p.benchTop === 'granite' ? '#d9d3c7' : '#cfd3cb') + '" stroke="' + INK + '" stroke-width="' + f(line1) + '"/></g>');
    o.push('<text x="' + f(mx) + '" y="' + f(my + fs * 0.28) + '" font-size="' + f(fs * 0.8) + '" text-anchor="middle" fill="#555">BENCH</text>');
  }
  return o.join('');
}

/** Takeoff lines for the walls, glass, door and bench of drawn showers. */
export function showerLines(d: Design): Array<{ desc: string; qty: number; note: string }> {
  const out: Array<{ desc: string; qty: number; note: string }> = [];
  const ft = (inches: number) => Math.round(inches / 1.2) / 10 + ' linear ft';
  for (const it of d.items) {
    const p = it.p; if (it.kind !== 'shower' || !p?.poly || p.poly.length < 3) continue;
    const E = edgesOf(p.poly as Array<[number, number]>); const sides = sidesOf(p, E.length);
    let glass = 0, wall = 0, knee = 0, doors = 0, dw = 0;
    E.forEach((e, i) => {
      const t = sides[i];
      if (t === 'glass') glass += e.L; else if (t === 'knee') { knee += e.L; glass += e.L; } else if (t === 'wall') wall += e.L;
      else if (t === 'door') { dw = doorWidth(p, e); doors++; glass += e.L - dw; }
    });
    if (glass > 0.5) out.push({ desc: 'Shower glass panels (drawn shower)', qty: 1, note: 'about ' + ft(glass) });
    if (knee > 0.5) out.push({ desc: 'Shower knee wall (drawn shower)', qty: 1, note: 'about ' + ft(knee) });
    if (wall > 0.5) out.push({ desc: 'Shower wall, new framing (drawn shower)', qty: 1, note: 'about ' + ft(wall) });
    if (doors) out.push({ desc: 'Shower glass door (drawn shower)', qty: doors, note: Math.round(dw) + '" opening' });
    const bn = p.bench as { edge: number; depth: number } | null | undefined;
    if (bn && bn.edge >= 0 && bn.edge < E.length) out.push({ desc: 'Shower bench (drawn shower)', qty: 1, note: 'along side ' + (bn.edge + 1) + ', ' + Math.round(bn.depth || 15) + '" deep, about ' + ft(E[bn.edge].L) + ' long' });
  }
  return out;
}
