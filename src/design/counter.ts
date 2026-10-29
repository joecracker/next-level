// Countertops and backsplash. A top is not its own thing you place: every base cabinet, dishwasher, island and
// "blank space" can carry one (a switch on each), and neighbours along a wall are drawn as ONE continuous slab.
import { KINDS, frame, seg, type Design, type DItem, type Pt } from './model';

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

export interface Top { poly: Pt[]; area: number; splash: Pt[] | null; splashLen: number; ids: string[] }

export function tops(d: Design): Top[] {
  const out: Top[] = [];
  d.pts.forEach((_, wi) => {
    const L = seg(d.pts, wi);
    const row = d.items.filter(q => q.wall === wi && hasTop(q)).sort((a, b) => a.t - b.t);
    let run: DItem[] = [];
    const flush = () => {
      if (!run.length) return;
      const t0 = run[0].t - run[0].w / 2, t1 = run[run.length - 1].t + run[run.length - 1].w / 2;
      const P = (t: number, y: number): Pt => ({ x: L.ax + L.ux * t + L.nx * y, y: L.ay + L.uy * t + L.ny * y });
      const poly: Pt[] = [P(t0, 0), P(t1, 0)]; let area = 0;
      for (let i = run.length - 1; i >= 0; i--) { const q = run[i]; const y = q.d + OVERHANG; poly.push(P(q.t + q.w / 2, y), P(q.t - q.w / 2, y)); area += q.w * y; }
      out.push({ poly, area, splash: [P(t0, 0), P(t1, 0), P(t1, 1), P(t0, 1)], splashLen: t1 - t0, ids: run.map(q => q.id) });
      run = [];
    };
    for (const q of row) { const last = run[run.length - 1]; if (last && q.t - q.w / 2 - (last.t + last.w / 2) > 0.75) flush(); run.push(q); }
    flush();
  });
  for (const q of d.items) {
    if (q.wall !== null || !hasTop(q)) continue;
    const f = frame(q, d.pts); const hw = q.w / 2 + OVERHANG, hd = q.d / 2 + OVERHANG;
    const poly = ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as Array<[number, number]>).map(([a, b]) => ({ x: f.cx + f.ux * a + f.nx * b, y: f.cy + f.uy * a + f.ny * b }));
    out.push({ poly, area: (q.w + 2 * OVERHANG) * (q.d + 2 * OVERHANG), splash: null, splashLen: 0, ids: [q.id] });
  }
  return out;
}

/** The slabs and backsplash as drawing markup (drawn under the wall-hung things, over the cabinets). */
export function countertopSvg(d: Design, S: number): string {
  const ts = tops(d); if (!ts.length) return '';
  const c = counterOf(d); const m = matOf(c.mat); const o: string[] = [];
  const path = (p: Pt[]) => p.map(q => `${Math.round(q.x * 100) / 100},${Math.round(q.y * 100) / 100}`).join(' ');
  for (const t of ts) {
    o.push(`<polygon points="${path(t.poly)}" fill="${m.fill}" fill-opacity="0.38" stroke="${m.edge}" stroke-width="${1.4 / S}" stroke-linejoin="round"/>`);
    if (t.splash && c.splash !== 'none') o.push(`<polygon points="${path(t.splash)}" fill="${c.splash === 'tile' ? '#6f9fb4' : m.edge}" stroke="none"/>`);
  }
  return o.join('');
}

/** What to order: slab area (rough, from the drawn tops) and backsplash length. */
export function counterSummary(d: Design): { area: number; splashLen: number; mat: string; splash: string } | null {
  const ts = tops(d); if (!ts.length) return null; const c = counterOf(d);
  return { area: ts.reduce((a, t) => a + t.area, 0) / 144, splashLen: ts.reduce((a, t) => a + t.splashLen, 0) / 12, mat: matOf(c.mat).name, splash: c.splash };
}
