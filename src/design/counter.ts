// Countertops and backsplash. A top is not its own thing you place: every base cabinet, dishwasher, island and
// "blank space" can carry one (a switch on each), and neighbours along a wall are drawn as ONE continuous slab.
import { KINDS, frame, seg, type Design, type DItem, type Pt } from './model';

const INK = '#14191A';

export const OVERHANG = 1.5;           // inches past the cabinet fronts
export const SPLASH_H = 4;             // inches, the standard stone backsplash
export const TOP_KINDS = new Set(['base', 'sinkbase', 'drawer', 'island', 'dw', 'blank']);
export const MATS: Array<{ id: string; name: string; fill: string; edge: string }> = [
  { id: 'granite', name: 'Granite', fill: '#b7b4ac', edge: '#6f6c64' },
  { id: 'quartz', name: 'Quartz', fill: '#dcd8cd', edge: '#8a867a' },
  { id: 'laminate', name: 'Laminate', fill: '#cdbfa3', edge: '#8a7c5e' },
  { id: 'butcher', name: 'Butcher block', fill: '#c9a56b', edge: '#8a6a30' },
  { id: 'solid', name: 'Solid surface', fill: '#ece8dd', edge: '#9a9686' },
];
export const SPLASHES: Array<[string, string]> = [['stone', '4" matching top'], ['tile', 'Tile to the uppers'], ['none', 'None']];
export const counterOf = (d: Design) => ({ mat: d.counter?.mat || 'granite', splash: d.counter?.splash || 'stone' });
export const matOf = (id: string) => MATS.find(m => m.id === id) || MATS[0];

/** Does this item carry a countertop? The item's own switch wins; otherwise base cabinets, dishwashers and islands do, a blank space does not. */
export function hasTop(it: DItem): boolean {
  if (!TOP_KINDS.has(it.kind) || KINDS[it.kind]?.layer !== 'floor') return false;
  const v = it.p?.top; if (v !== undefined) return !!v;
  return it.kind !== 'blank';
}

/** Overhang past each side of a cabinet's top, inches. Front = the doors, Back = the side opposite (a seating side on an island). */
export interface Ov { f: number; b: number; l: number; r: number }
export function ovOf(it: DItem): Ov {
  const wall = it.wall !== null;
  const g = (k: string, dflt: number) => { const v = it.p?.[k]; return typeof v === 'number' && v >= 0 ? v : dflt; };
  return { f: g('ovF', OVERHANG), b: wall ? 0 : g('ovB', OVERHANG), l: g('ovL', wall ? 0 : OVERHANG), r: g('ovR', wall ? 0 : OVERHANG) };
}

interface Slab { poly: Pt[]; area: number; id: string }
/** One rectangle per top-carrying item. Sides that touch a neighbour's top get no overhang, so neighbours read as one slab. */
function slabs(d: Design): Slab[] {
  const out: Slab[] = []; const items = d.items.filter(hasTop);
  for (const q of items) {
    const o = ovOf(q); const f = frame(q, d.pts); let lc = false, rc = false;
    for (const n of items) {
      if (n.id === q.id) continue;
      if (q.wall !== null) {
        if (n.wall !== q.wall) continue;
        const gr = (n.t - n.w / 2) - (q.t + q.w / 2), gl = (q.t - q.w / 2) - (n.t + n.w / 2);
        if (Math.abs(gr) <= 0.75) rc = true; if (Math.abs(gl) <= 0.75) lc = true;
      } else {
        if (n.wall !== null || Math.abs((((n.rot - q.rot) % 360) + 540) % 360 - 180) > 0.6) continue;
        const g = frame(n, d.pts); const dx = (g.cx - f.cx) * f.ux + (g.cy - f.cy) * f.uy, dy = (g.cx - f.cx) * f.nx + (g.cy - f.cy) * f.ny;
        if (Math.abs(dy) >= (q.d + n.d) / 2 - 1) continue;
        const gap = Math.abs(dx) - (q.w + n.w) / 2; if (Math.abs(gap) > 0.75) continue;
        if (dx > 0) rc = true; else lc = true;
      }
    }
    const L = lc ? 0 : o.l, R = rc ? 0 : o.r;
    let poly: Pt[]; let w = q.w + L + R, dd = q.d + o.f + o.b;
    if (q.wall !== null && q.wall < d.pts.length) {
      const sg = seg(d.pts, q.wall); const P = (t: number, y: number): Pt => ({ x: sg.ax + sg.ux * t + sg.nx * y, y: sg.ay + sg.uy * t + sg.ny * y });
      const t0 = q.t - q.w / 2 - L, t1 = q.t + q.w / 2 + R; poly = [P(t0, 0), P(t1, 0), P(t1, q.d + o.f), P(t0, q.d + o.f)]; dd = q.d + o.f;
    } else {
      const a = -q.w / 2 - L, b = q.w / 2 + R, c = -q.d / 2 - o.b, e = q.d / 2 + o.f;
      poly = ([[a, c], [b, c], [b, e], [a, e]] as Array<[number, number]>).map(([x, y]) => ({ x: f.cx + f.ux * x + f.nx * y, y: f.cy + f.uy * x + f.ny * y }));
    }
    out.push({ poly, area: w * dd, id: q.id });
  }
  return out;
}

/** Backsplash strips: one per continuous run of tops along a wall. */
function splashRuns(d: Design): Array<{ poly: Pt[]; len: number }> {
  const out: Array<{ poly: Pt[]; len: number }> = [];
  d.pts.forEach((_, wi) => {
    const L = seg(d.pts, wi); const row = d.items.filter(q => q.wall === wi && hasTop(q)).sort((a, b) => a.t - b.t);
    let run: DItem[] = [];
    const P = (t: number, y: number): Pt => ({ x: L.ax + L.ux * t + L.nx * y, y: L.ay + L.uy * t + L.ny * y });
    const flush = () => { if (!run.length) return; const t0 = run[0].t - run[0].w / 2 - ovOf(run[0]).l, t1 = run[run.length - 1].t + run[run.length - 1].w / 2 + ovOf(run[run.length - 1]).r; out.push({ poly: [P(t0, 0), P(t1, 0), P(t1, 1), P(t0, 1)], len: t1 - t0 }); run = []; };
    for (const q of row) { const last = run[run.length - 1]; if (last && q.t - q.w / 2 - (last.t + last.w / 2) > 0.75) flush(); run.push(q); }
    flush();
  });
  return out;
}

/** The slabs and backsplash as drawing markup (drawn under the wall-hung things, over the cabinets). */
export function countertopSvg(d: Design, S: number): string {
  const sl = slabs(d); const c = counterOf(d); const m = matOf(c.mat); const o: string[] = [];
  const path = (p: Pt[]) => p.map(q => `${Math.round(q.x * 100) / 100},${Math.round(q.y * 100) / 100}`).join(' ');
  if (sl.length) {
    // two passes inside one translucent group: outlines first, then fills, so neighbours merge into one slab with a clean outer edge
    o.push(`<g opacity="0.4">` + sl.map(t => `<polygon points="${path(t.poly)}" fill="${m.edge}" stroke="${m.edge}" stroke-width="${2.8 / S}" stroke-linejoin="round"/>`).join('') + sl.map(t => `<polygon points="${path(t.poly)}" fill="${m.fill}" stroke="${m.fill}" stroke-width="${0.8 / S}" stroke-linejoin="round"/>`).join('') + `</g>`);
    if (c.splash !== 'none') for (const r of splashRuns(d)) o.push(`<polygon points="${path(r.poly)}" fill="${c.splash === 'tile' ? '#6f9fb4' : m.edge}" stroke="none"/>`);
  }
  // tile up behind a freestanding range hood
  for (const q of d.items) if (q.kind === 'chimney' && q.p?.tileUp !== false && q.wall !== null && q.wall < d.pts.length) {
    const L = seg(d.pts, q.wall); const P = (t: number, y: number) => ({ x: L.ax + L.ux * t + L.nx * y, y: L.ay + L.uy * t + L.ny * y });
    o.push(`<polygon points="${path([P(q.t - q.w / 2, 0), P(q.t + q.w / 2, 0), P(q.t + q.w / 2, 1), P(q.t - q.w / 2, 1)])}" fill="#6f9fb4" stroke="none"/>`);
  }
  o.push(sinksSvg(d, S));
  return o.join('');
}

export const sinkOf = (it: DItem): string => (it.p?.sink as string) || '5050';
export const SINK_NAMES: Record<string, string> = { single: 'Single bowl', '5050': '50/50 double bowl', farm: 'Farmhouse sink' };

/** Sink bowls (and disposal rings) drawn on the tops of sink bases. */
function sinksSvg(d: Design, S: number): string {
  const o: string[] = []; const line = 1.2 / S;
  for (const q of d.items) {
    if (q.kind !== 'sinkbase' || !hasTop(q)) continue; const sk = sinkOf(q); if (sk === 'none') continue;
    const f = frame(q, d.pts); const hw = q.w / 2, hd = q.d / 2; const iw = Math.max(12, q.w - 3);
    const y0 = -hd + 3.5; const bd = sk === 'farm' ? Math.max(12, q.d - 4.5) : Math.min(Math.max(10, q.d - 6), 18);
    const bowl = (cx: number, w: number, extra = '') => `<rect x="${cx - w / 2}" y="${y0}" width="${w}" height="${bd}" rx="${Math.min(3, w / 4)}" fill="#f7f7f4" stroke="${INK}" stroke-width="${line}"${extra}/><circle cx="${cx}" cy="${y0 + bd * 0.55}" r="0.9" fill="${INK}"/>`;
    let g = '';
    if (sk === '5050') { const bw = (iw - 1.5) / 2; g += bowl(-(bw + 1.5) / 2, bw) + bowl((bw + 1.5) / 2, bw); }
    else g += bowl(0, sk === 'farm' ? Math.min(iw, 33) : Math.min(iw, 30));
    if (sk === 'farm') g += `<line x1="${-Math.min(iw, 33) / 2}" y1="${y0 + bd}" x2="${Math.min(iw, 33) / 2}" y2="${y0 + bd}" stroke="${INK}" stroke-width="${3 / S}"/>`;
    g += `<circle cx="0" cy="${-hd + 1.7}" r="1.1" fill="#fff" stroke="${INK}" stroke-width="${line}"/>`; // faucet
    if (q.p?.disposal) { const dx = sk === '5050' ? ((iw - 1.5) / 2 + 1.5) / 2 : 0; g += `<circle cx="${dx}" cy="${y0 + bd * 0.55}" r="2.6" fill="none" stroke="${INK}" stroke-width="${line}" stroke-dasharray="${2 / S} ${1.5 / S}"/>`; }
    void hw; o.push(`<g transform="translate(${f.cx} ${f.cy}) rotate(${f.rot})">${g}</g>`);
  }
  return o.join('');
}

/** What to order: slab area (rough, from the drawn tops) and backsplash length. */
/** Area where two convex slabs overlap (e.g. the corner square where two wall runs meet), so it is not counted twice. */
function overlapArea(a: Pt[], b: Pt[]): number {
  const cross = (o: Pt, p: Pt, q: Pt) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const orient = cross(a[0], a[1], a[2]) >= 0 ? 1 : -1; let out = b.slice();
  for (let i = 0; i < a.length && out.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length]; const inp = out; out = [];
    inp.forEach((cur, j) => {
      const prev = inp[(j + inp.length - 1) % inp.length]; const cin = orient * cross(p, q, cur) >= 0, pin = orient * cross(p, q, prev) >= 0;
      if (cin !== pin) { const t = cross(p, q, prev) / (cross(p, q, prev) - cross(p, q, cur)); out.push({ x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t }); }
      if (cin) out.push(cur);
    });
  }
  let ar = 0; for (let i = 0; i < out.length; i++) { const u = out[i], v = out[(i + 1) % out.length]; ar += u.x * v.y - v.x * u.y; } return Math.abs(ar) / 2;
}
function slabArea(sl: Slab[]): number {
  let t = sl.reduce((a, x) => a + x.area, 0);
  for (let i = 0; i < sl.length; i++) for (let j = i + 1; j < sl.length; j++) t -= overlapArea(sl[i].poly, sl[j].poly);
  return t;
}

export function counterSummary(d: Design): { area: number; splashLen: number; mat: string; splash: string } | null {
  const sl = slabs(d); if (!sl.length) return null; const c = counterOf(d);
  return { area: slabArea(sl) / 144, splashLen: splashRuns(d).reduce((a, r) => a + r.len, 0) / 12, mat: matOf(c.mat).name, splash: c.splash };
}

/** Fixtures worth listing next to the counters: sinks, disposals, pot fillers, and tile behind a freestanding hood. */
export function fixtureLines(d: Design): Array<{ desc: string; qty: number; note: string }> {
  const out: Array<{ desc: string; qty: number; note: string }> = [];
  const sinks: Record<string, number> = {}; let disp = 0;
  for (const q of d.items) if (q.kind === 'sinkbase') { const k = sinkOf(q); if (k !== 'none') sinks[k] = (sinks[k] || 0) + 1; if (q.p?.disposal) disp++; }
  for (const [k, n] of Object.entries(sinks)) out.push({ desc: `Kitchen sink - ${SINK_NAMES[k] || k}`, qty: n, note: '' });
  if (disp) out.push({ desc: 'Garbage disposal', qty: disp, note: '' });
  const pf = d.items.filter(q => q.kind === 'potfiller').length; if (pf) out.push({ desc: 'Pot filler', qty: pf, note: '' });
  const ceil = d.ceiling || 96; const soffit = d.items.find(q => q.kind === 'soffit');
  for (const q of d.items) if (q.kind === 'chimney' && q.p?.tileUp !== false) {
    const top = q.p?.tileTo === 'soffit' ? ceil - (soffit?.p?.drop ?? 12) : ceil; const h = Math.max(0, top - 36);
    out.push({ desc: `Tile behind range hood, up to the ${q.p?.tileTo === 'soffit' ? 'soffit' : 'ceiling'}`, qty: 1, note: `about ${Math.round(q.w * h / 14.4) / 10} sq ft (${q.w}" wide x ${Math.round(h)}" tall)` });
  }
  return out;
}
