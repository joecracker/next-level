// Design Studio data and geometry. What gets stored on a job as project.design.
// All sizes are inches. A wall item is placed by wall number + distance along the wall (t = its CENTER,
// measured from the wall's start corner); a free item by x, y (center) + rot degrees.
// The room is a list of corners drawn clockwise as seen on screen (y grows downward); a wall's "inside"
// is its right-hand side.
export interface Pt { x: number; y: number }
export interface DItem {
  id: string;
  kind: string;
  label?: string;      // text printed on the drawing / takeoff description
  code?: string;       // maker's catalog code, e.g. B24
  w: number; d: number; h?: number;
  wall: number | null; t: number;
  x: number; y: number; rot: number;
  hinge?: 'left' | 'right'; swing?: 'in' | 'out';   // doors
  sill?: number;       // windows: sill height
  p?: Record<string, any>;   // kind-specific options (shower sides, drain, vanity sinks, ...)
  notes?: string;
}
export interface Design {
  v: 1;
  mode: 'bath' | 'kitchen';
  pts: Pt[];
  items: DItem[];
  ceiling?: number;    // ceiling height, inches
  accepted?: Record<string, boolean>; // robot checks Tim chose to keep as they are
  counter?: { mat?: string; splash?: 'stone' | 'tile' | 'none' }; // countertop material and backsplash for the whole drawing
}

export type Layer = 'floor' | 'hung' | 'inwall' | 'ceiling';
export type Cat = 'Walls' | 'Doors' | 'Plumbing' | 'Electrical' | 'Cabinets' | 'Accessories';
export type Mode = 'bath' | 'kitchen';
export interface Kind { name: string; layer: Layer; snap: boolean; w: number; d: number; h?: number; cab?: boolean; cat: Cat; modes: Mode[]; inWall?: boolean; props?: Record<string, any> }
export const T = 4.5; // wall thickness
const SHOWER = { left: 'wall', right: 'wall', front: 'glass', entry: 'front', doorPos: 'left', door: true, doorType: 'swing', doorW: 30, curb: true, drain: 'endL', valve: 'left', valveType: 'standard', tile: true, tileSize: '2', tileDir: 'v', free: false, bench: 'none', benchW: 15, benchTop: 'granite', niche: 'none', nicheH: 24, shelves: 'none' };

export const KINDS: Record<string, Kind> = {
  shower:   { name: 'Shower', layer: 'floor', snap: true, w: 60, d: 32, props: SHOWER, cat: 'Plumbing', modes: ['bath'] },
  tub:      { name: 'Tub', layer: 'floor', snap: true, w: 60, d: 30, props: { drain: 'left', door: false, doorH: 58, niche: 'none', shelves: 'none' }, cat: 'Plumbing', modes: ['bath'] },
  ftub:     { name: 'Freestanding tub', layer: 'floor', snap: false, w: 60, d: 30, cat: 'Plumbing', modes: ['bath'] },
  tubfiller:{ name: 'Tub filler', layer: 'hung', snap: true, w: 6, d: 3, cat: 'Plumbing', modes: ['bath'] },
  rainhead: { name: 'Rain head', layer: 'ceiling', snap: false, w: 8, d: 8, props: { size: 8 }, cat: 'Plumbing', modes: ['bath'] },
  toilet:   { name: 'Toilet', layer: 'floor', snap: true, w: 20, d: 29, props: { bowl: 'elong' }, cat: 'Plumbing', modes: ['bath'] },
  vanity:   { name: 'Vanity', layer: 'floor', snap: true, w: 36, d: 21, props: { sinks: 1 }, h: 34.5, cab: true, cat: 'Cabinets', modes: ['bath'] },
  linen:    { name: 'Linen tower', layer: 'floor', snap: true, w: 18, d: 21, h: 84, cab: true, cat: 'Cabinets', modes: ['bath'] },
  pedestal: { name: 'Pedestal sink', layer: 'floor', snap: true, w: 20, d: 17, cat: 'Plumbing', modes: ['bath'] },
  desk:     { name: 'Powder desk', layer: 'floor', snap: true, w: 30, d: 21, h: 32, cab: true, cat: 'Cabinets', modes: ['bath'] },
  utility:  { name: 'Utility cabinet', layer: 'floor', snap: true, w: 18, d: 12, h: 84, cab: true, cat: 'Cabinets', modes: ['bath'] },
  base:     { name: 'Base cabinet', layer: 'floor', snap: true, w: 24, d: 24, h: 34.5, cab: true, cat: 'Cabinets', modes: ['kitchen'] },
  sinkbase: { name: 'Sink base', layer: 'floor', snap: true, w: 36, d: 24, h: 34.5, cab: true, cat: 'Cabinets', modes: ['kitchen'] },
  drawer:   { name: 'Drawer base', layer: 'floor', snap: true, w: 18, d: 24, h: 34.5, cab: true, cat: 'Cabinets', modes: ['kitchen'] },
  blank:    { name: 'Blank space (open, with optional top)', layer: 'floor', snap: true, w: 36, d: 24, h: 34.5, cat: 'Cabinets', modes: ['kitchen', 'bath'] },
  pantry:   { name: 'Tall pantry', layer: 'floor', snap: true, w: 24, d: 24, h: 84, cab: true, cat: 'Cabinets', modes: ['kitchen'] },
  fridge:   { name: 'Refrigerator', layer: 'floor', snap: true, w: 36, d: 30, cat: 'Accessories', modes: ['kitchen'] },
  range:    { name: 'Range', layer: 'floor', snap: true, w: 30, d: 26, cat: 'Accessories', modes: ['kitchen'] },
  dw:       { name: 'Dishwasher', layer: 'floor', snap: true, w: 24, d: 24, cat: 'Accessories', modes: ['kitchen'] },
  island:   { name: 'Island', layer: 'floor', snap: false, w: 60, d: 36, h: 34.5, cab: true, cat: 'Cabinets', modes: ['kitchen'] },
  endpanel: { name: 'Fridge end panel', layer: 'floor', snap: true, w: 1, d: 27, cab: true, cat: 'Cabinets', modes: ['kitchen'] },
  upper:    { name: 'Upper cabinet', layer: 'hung', snap: true, w: 30, d: 12, h: 30, cab: true, cat: 'Cabinets', modes: ['kitchen'] },
  hood:     { name: 'Range hood', layer: 'hung', snap: true, w: 30, d: 20, cat: 'Accessories', modes: ['kitchen'] },
  microwave:{ name: 'Microwave over the range', layer: 'hung', snap: true, w: 30, d: 16, cat: 'Accessories', modes: ['kitchen'] },
  chimney:  { name: 'Freestanding range hood', layer: 'hung', snap: true, w: 30, d: 20, props: { tileUp: true, tileTo: 'ceiling' }, cat: 'Accessories', modes: ['kitchen'] },
  potfiller:{ name: 'Pot filler', layer: 'hung', snap: true, w: 6, d: 3, cat: 'Plumbing', modes: ['kitchen'] },
  dedout:   { name: 'Dedicated outlet (fridge, microwave, disposal, dishwasher)', layer: 'hung', snap: true, w: 4, d: T, inWall: true, cat: 'Electrical', modes: ['kitchen'] },
  out240:   { name: '240V range outlet', layer: 'hung', snap: true, w: 5, d: T, inWall: true, cat: 'Electrical', modes: ['kitchen'] },
  gfci20:   { name: '20-amp counter GFCI', layer: 'hung', snap: true, w: 5, d: T, inWall: true, cat: 'Electrical', modes: ['kitchen'] },
  dswitch:  { name: 'Disposal switch', layer: 'hung', snap: true, w: 4, d: T, inWall: true, cat: 'Electrical', modes: ['kitchen'] },
  islout:   { name: 'Island outlet', layer: 'ceiling', snap: false, w: 5, d: 5, cat: 'Electrical', modes: ['kitchen'] },
  cfan:     { name: 'Ceiling fan', layer: 'ceiling', snap: false, w: 44, d: 44, cat: 'Electrical', modes: ['kitchen'] },
  valance:  { name: 'Valance', layer: 'hung', snap: true, w: 36, d: 4, cab: true, cat: 'Cabinets', modes: ['kitchen'] },
  ucl:      { name: 'Under-cabinet light', layer: 'hung', snap: true, w: 24, d: 10, cat: 'Electrical', modes: ['kitchen'] },
  mirror:   { name: 'Mirror', layer: 'hung', snap: true, w: 24, d: 1.5, cat: 'Accessories', modes: ['bath'] },
  medcab:   { name: 'Medicine cabinet', layer: 'hung', snap: true, w: 16, d: 4, cat: 'Accessories', modes: ['bath'] },
  grab:     { name: 'Grab bar', layer: 'hung', snap: true, w: 24, d: 3, cat: 'Accessories', modes: ['bath'] },
  door:     { name: 'Door', layer: 'inwall', snap: true, w: 30, d: T, props: { type: 'swing' }, cat: 'Doors', modes: ['bath', 'kitchen'] },
  window:   { name: 'Window', layer: 'inwall', snap: true, w: 36, d: T, cat: 'Doors', modes: ['bath', 'kitchen'] },
  kneewall: { name: 'Knee wall', layer: 'floor', snap: false, w: 48, d: 4.5, h: 36, props: { height: 36 }, cat: 'Walls', modes: ['bath', 'kitchen'] },
  partition:{ name: 'Inside wall (to the ceiling)', layer: 'floor', snap: false, w: 48, d: 4.5, cat: 'Walls', modes: ['bath', 'kitchen'] },
  vlight:   { name: 'Vanity light', layer: 'hung', snap: true, w: 24, d: 2, cat: 'Electrical', modes: ['bath'] },
  outlet:   { name: 'Outlet', layer: 'hung', snap: true, w: 4, d: T, inWall: true, cat: 'Electrical', modes: ['bath', 'kitchen'] },
  gfci:     { name: 'GFCI outlet', layer: 'hung', snap: true, w: 5, d: T, inWall: true, cat: 'Electrical', modes: ['bath', 'kitchen'] },
  switch:   { name: 'Switch', layer: 'hung', snap: true, w: 4, d: T, inWall: true, cat: 'Electrical', modes: ['bath', 'kitchen'] },
  fan:      { name: 'Exhaust fan', layer: 'ceiling', snap: false, w: 10, d: 10, cat: 'Electrical', modes: ['bath', 'kitchen'] },
  can:      { name: 'Can light', layer: 'ceiling', snap: false, w: 6, d: 6, cat: 'Electrical', modes: ['bath', 'kitchen'] },
  wet:      { name: 'Shower light (wet rated)', layer: 'ceiling', snap: false, w: 6, d: 6, cat: 'Electrical', modes: ['bath'] },
  pendant:  { name: 'Pendant', layer: 'ceiling', snap: false, w: 8, d: 8, cat: 'Electrical', modes: ['kitchen'] },
  soffit:   { name: 'Soffit', layer: 'ceiling', snap: true, w: 48, d: 24, props: { drop: 12 }, cat: 'Walls', modes: ['bath', 'kitchen'] },
};
export const CATS: Cat[] = ['Walls', 'Doors', 'Plumbing', 'Electrical', 'Cabinets', 'Accessories'];
/** Menu heading for a category in a given kind of room. */
export const catLabel = (c: Cat, mode: Mode) => c === 'Walls' ? 'Walls' : c === 'Doors' ? 'Doors & windows' : c === 'Accessories' ? (mode === 'kitchen' ? 'Appliances' : 'Accessories') : c;
export const kindsFor = (c: Cat, mode: Mode) => Object.entries(KINDS).filter(([, k]) => k.cat === c && k.modes.includes(mode));
export const isCab = (kind: string) => !!KINDS[kind]?.cab;

export const hasDesign = (d?: Design | null): d is Design => !!d && (d.pts?.length >= 3 || (d.items?.length ?? 0) > 0);

const uid = () => Math.random().toString(36).slice(2, 9);
export function mkItem(kind: string, over: Partial<DItem> = {}): DItem {
  const k = KINDS[kind];
  return { id: uid(), kind, w: k.w, d: k.d, ...(k.h ? { h: k.h } : {}), wall: null, t: 0, x: 0, y: 0, rot: 0, ...(k.props ? { p: { ...k.props } } : {}), ...over };
}
/** Starter rooms: an empty box and a door (bath 5' x 8', kitchen 12' x 12'). */
export function template(mode: 'bath' | 'kitchen'): Design {
  const bath = mode === 'bath';
  const W = bath ? 60 : 144, H = bath ? 96 : 144;
  return { v: 1, mode, ceiling: 96, pts: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }],
    items: [mkItem('door', { wall: 2, t: bath ? 24 : 36, w: bath ? 30 : 34 })] };
}

// ---------- inches <-> text ----------
/** 94.5 -> 7'-10 1/2"  (nearest 1/16) */
export function fmtIn(inches: number): string {
  const neg = inches < 0; let v = Math.round(Math.abs(inches) * 16);
  const ft = Math.floor(v / 192); v -= ft * 192;
  const whole = Math.floor(v / 16); const fr = v % 16;
  let frac = '';
  if (fr) { let n = fr, dn = 16; while (n % 2 === 0) { n /= 2; dn /= 2; } frac = whole ? ` ${n}/${dn}` : `${n}/${dn}`; }
  const inch = `${whole || !frac ? whole : ''}${frac}"`;
  return (neg ? '-' : '') + (ft ? `${ft}'-${inch}` : inch);
}
/** Reads 24, 24 1/2, 3/4, 2' 6, 7'-10 1/2" ... returns NaN when it can't. */
export function parseIn(txt: string): number {
  let t = String(txt || '').trim().replace(/"/g, '').replace(/-/g, ' ');
  let ft = 0;
  const m = t.match(/^(\d+(?:\.\d+)?)\s*'\s*(.*)$/);
  if (m) { ft = parseFloat(m[1]); t = m[2].trim(); }
  if (!t) return m ? ft * 12 : NaN;
  const mm = t.match(/^(\d+(?:\.\d+)?)?\s*(?:(\d+)\/(\d+))?$/);
  if (!mm || (!mm[1] && !mm[2])) return NaN;
  const whole = mm[1] ? parseFloat(mm[1]) : 0;
  const fr = mm[2] ? parseInt(mm[2], 10) / parseInt(mm[3], 10) : 0;
  return ft * 12 + whole + fr;
}
export const snapTo = (v: number, step: number) => Math.round(v / step) * step;

// ---------- geometry ----------
export interface Seg { ax: number; ay: number; bx: number; by: number; L: number; ux: number; uy: number; nx: number; ny: number }
export function seg(pts: Pt[], i: number): Seg {
  const n = pts.length; const a = pts[i], b = pts[(i + 1) % n];
  const dx = b.x - a.x, dy = b.y - a.y; const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  return { ax: a.x, ay: a.y, bx: b.x, by: b.y, L, ux, uy, nx: -uy, ny: ux };
}
export interface Frame { cx: number; cy: number; rot: number; ux: number; uy: number; nx: number; ny: number }
export function frame(it: DItem, pts: Pt[]): Frame {
  const k = KINDS[it.kind];
  if (it.wall !== null && it.wall !== undefined && it.wall < pts.length) {
    const s = seg(pts, it.wall);
    const off = k.layer === 'inwall' || k.inWall ? -T / 2 : it.d / 2;
    return { cx: s.ax + s.ux * it.t + s.nx * off, cy: s.ay + s.uy * it.t + s.ny * off, rot: Math.atan2(s.uy, s.ux) * 180 / Math.PI, ux: s.ux, uy: s.uy, nx: s.nx, ny: s.ny };
  }
  const r = (it.rot || 0) * Math.PI / 180; const ux = Math.cos(r), uy = Math.sin(r);
  return { cx: it.x, cy: it.y, rot: it.rot || 0, ux, uy, nx: -uy, ny: ux };
}
export function corners(it: DItem, f: Frame): Array<[number, number]> {
  const hw = it.w / 2, hd = it.d / 2;
  return ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as Array<[number, number]>)
    .map(q => [f.cx + f.ux * q[0] + f.nx * q[1], f.cy + f.uy * q[0] + f.ny * q[1]] as [number, number]);
}
/** Is the point (x,y) inside the item's rectangle (grown by `pad` inches)? */
export function hitItem(it: DItem, pts: Pt[], x: number, y: number, pad = 0): boolean {
  const f = frame(it, pts); const dx = x - f.cx, dy = y - f.cy;
  const lx = dx * f.ux + dy * f.uy, ly = dx * f.nx + dy * f.ny;
  return Math.abs(lx) <= it.w / 2 + pad && Math.abs(ly) <= it.d / 2 + pad;
}
/** Nearest wall to a point: its number, distance along it (t), signed distance off it (positive = inside the room). */
export function nearestWall(pts: Pt[], x: number, y: number): { i: number; t: number; off: number; dist: number; L: number } {
  let best = { i: 0, t: 0, off: 0, dist: Infinity, L: 1 };
  for (let i = 0; i < pts.length; i++) {
    const s = seg(pts, i); const dx = x - s.ax, dy = y - s.ay;
    const t = dx * s.ux + dy * s.uy, off = dx * s.nx + dy * s.ny;
    const tc = Math.max(0, Math.min(s.L, t));
    const dist = Math.hypot(x - (s.ax + s.ux * tc), y - (s.ay + s.uy * tc));
    if (dist < best.dist) best = { i, t, off, dist, L: s.L };
  }
  return best;
}
export const clampT = (it: DItem, L: number, t: number) => Math.max(it.w / 2, Math.min(Math.max(it.w / 2, L - it.w / 2), t));

/** Fix anything a corner move could have pushed out of range (items off the end of a wall). */
export function normalize(d: Design): Design {
  const items = d.items.map(it => {
    if (it.wall === null || it.wall === undefined) return it;
    if (it.wall >= d.pts.length) return { ...it, wall: null, x: it.x, y: it.y };
    const L = seg(d.pts, it.wall).L; const t = clampT(it, L, it.t);
    return t === it.t ? it : { ...it, t };
  });
  return { ...d, items };
}
export function orient(pts: Pt[]): Pt[] { // clockwise on screen
  let a = 0; pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; });
  return a < 0 ? pts.slice().reverse() : pts;
}

// ---------- distance to neighbours along a wall (the "live numbers") ----------
export function ray(px: number, py: number, dx: number, dy: number, segs: number[][]): number {
  let best = Infinity;
  for (const g of segs) {
    const ex = g[2] - g[0], ey = g[3] - g[1]; const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const ax = g[0] - px, ay = g[1] - py;
    const t = (ax * ey - ay * ex) / den, r = (ax * dy - ay * dx) / den;
    if (t > 0.01 && r >= -1e-6 && r <= 1 + 1e-6 && t < best) best = t;
  }
  return best;
}
/** Gaps from an item's left and right ends to the next wall or same-level item (Infinity if none). */
export function gaps(it: DItem, d: Design): { a: number; b: number } {
  const k = KINDS[it.kind]; const f = frame(it, d.pts);
  const layers: Layer[] = k.layer === 'inwall' || k.layer === 'ceiling' ? [] : k.layer === 'hung' ? ['hung', 'inwall'] : ['floor'];
  const segs: number[][] = [];
  d.pts.forEach((a, i) => { const b = d.pts[(i + 1) % d.pts.length]; segs.push([a.x, a.y, b.x, b.y]); });
  d.items.forEach(o => {
    if (o.id === it.id || !layers.includes(KINDS[o.kind].layer)) return;
    const c = corners(o, frame(o, d.pts));
    for (let j = 0; j < 4; j++) segs.push([c[j][0], c[j][1], c[(j + 1) % 4][0], c[(j + 1) % 4][1]]);
  });
  const inwall = k.layer === 'inwall' || !!k.inWall;
  const toW = (lx: number, ly: number): [number, number] => [f.cx + f.ux * (lx - it.w / 2) + f.nx * (ly - it.d / 2), f.cy + f.uy * (lx - it.w / 2) + f.ny * (ly - it.d / 2)];
  const sh = inwall ? T / 2 + 0.5 : 0;
  const L0 = toW(0.02, it.d / 2), R0 = toW(it.w - 0.02, it.d / 2);
  return {
    a: ray(L0[0] + f.nx * sh, L0[1] + f.ny * sh, -f.ux, -f.uy, segs),
    b: ray(R0[0] + f.nx * sh, R0[1] + f.ny * sh, f.ux, f.uy, segs),
  };
}

/** Outline segments of the room walls plus every item on the given layers (for measuring clear space). */
export function segsOf(d: Design, layers: Layer[], exceptId?: string): number[][] {
  const segs: number[][] = [];
  d.pts.forEach((a, i) => { const b = d.pts[(i + 1) % d.pts.length]; segs.push([a.x, a.y, b.x, b.y]); });
  d.items.forEach(o => {
    if (o.id === exceptId || !layers.includes(KINDS[o.kind].layer)) return;
    const c = corners(o, frame(o, d.pts));
    for (let j = 0; j < 4; j++) segs.push([c[j][0], c[j][1], c[(j + 1) % 4][0], c[(j + 1) % 4][1]]);
  });
  return segs;
}
/** A point given in an item's own box (0,0 = back-left corner, w,d = front-right) as a spot on the plan. */
export function toWorld(it: DItem, f: Frame, lx: number, ly: number): [number, number] {
  return [f.cx + f.ux * (lx - it.w / 2) + f.nx * (ly - it.d / 2), f.cy + f.uy * (lx - it.w / 2) + f.ny * (ly - it.d / 2)];
}
export function inPoly(x: number, y: number, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
/** Do two boxes (4 corners each) overlap by more than half an inch? */
export function overlap(ca: Array<[number, number]>, cb: Array<[number, number]>): boolean {
  const axes: number[][] = [];
  [ca, cb].forEach(c => { for (let j = 0; j < 2; j++) { const ex = c[j + 1][0] - c[j][0], ey = c[j + 1][1] - c[j][1]; const L = Math.hypot(ex, ey) || 1; axes.push([-ey / L, ex / L]); } });
  for (const ax of axes) {
    const pa = ca.map(q => q[0] * ax[0] + q[1] * ax[1]), pb = cb.map(q => q[0] * ax[0] + q[1] * ax[1]);
    if (Math.max(...pa) - 0.5 <= Math.min(...pb) || Math.max(...pb) - 0.5 <= Math.min(...pa)) return false;
  }
  return true;
}
/** Where the bench goes: 'none' | 'left' | 'right' | 'cornerL' | 'cornerR' */
export function benchSide(p: Record<string, any>): string {
  if (!p.bench || p.bench === 'none') return 'none';
  if (p.bench === 'auto') return p.valve === 'right' ? 'left' : 'right';
  return p.bench;
}

/** Everything the Add menu offers for a category in a room type, presets included. */
export interface AddEntry { key: string; kind: string; name: string; sub?: string; w: number; d: number; p?: Record<string, any>; section?: string; applyTo?: 'shower' | 'sinkbase'; extra?: Partial<DItem> }
export function addList(c: Cat, mode: Mode): AddEntry[] {
  const out: AddEntry[] = [];
  if (c === 'Doors') {
    const W = mode === 'kitchen' ? 34 : 30;
    const dd = (key: string, name: string, type: string, w: number, sub: string, extra: Partial<DItem> = {}) => out.push({ key, kind: 'door', name, sub, w, d: T, p: { type }, section: 'Doors', extra: { hinge: 'left', swing: 'in', ...extra } });
    dd('d-swing', 'Swinging door', 'swing', W, 'one door on hinges');
    dd('d-double', 'Double doors', 'double', 60, 'two doors meet in the middle');
    dd('d-pocket', 'Pocket door', 'pocket', 30, 'slides into the wall');
    dd('d-barn', 'Barn door', 'barn', 36, 'slides on a track, outside the room', { swing: 'out' });
    dd('d-bifold', 'Bi-fold door', 'bifold', 48, 'folds in the middle');
    dd('d-open', 'Plain opening', 'opening', 36, 'no door at all');
    out.push({ key: 'window', kind: 'window', name: 'Window', w: 36, d: T, section: 'Windows', extra: { sill: mode === 'kitchen' ? 42 : 36 } });
    return out;
  }
  if (c === 'Plumbing' && mode === 'bath') {
    const sz = (x: number) => Number.isInteger(x) ? String(x) : x === 39.375 ? '39 3/8' : x === 63.25 ? '63 1/4' : String(x);
    out.push({ key: 'sh-tile', kind: 'shower', name: 'Shower', sub: 'tile or wall panels, set any size, add bench, glass, door', w: 60, d: 32, section: 'Showers' });
    out.push({ key: 'sh-free', kind: 'shower', name: 'Shower, draw your own floor', sub: 'a tiled floor in any shape: drag the corners, tap a + to add one', w: 60, d: 48, section: 'Showers', p: { free: true, tile: true, tileSize: '12', curb: false, drain: 'center', poly: [[0, 0], [60, 0], [60, 48], [0, 48]] } });
    const bases: Array<[number, number]> = [[36, 36], [48, 36], [60, 36], [36, 42], [48, 42], [60, 42]];
    bases.forEach(([w, d]) => out.push({ key: `kb-${w}x${d}`, kind: 'shower', name: `Kohler base ${w} × ${d}`, sub: d === 42 ? '42" deep' : 'standard depth', w, d, section: 'Kohler shower bases (tile or wet wall panels on top)', p: { unit: 'base', tile: false, left: 'wall', right: 'wall', front: 'open', door: false, curb: true, drain: 'center', valve: 'back' } }));
    const su: Array<[number, number, string]> = [[36, 34, 'center drain'], [42, 34, 'curved front'], [48, 34, 'center drain'], [60, 34, 'center drain'], [60, 30, 'end drain'], [60, 32, 'end drain'], [36, 36, ''], [42, 36, ''], [48, 36, ''], [60, 36, ''], [48, 36, 'with seat'], [60, 36, 'with seat'], [39.375, 39.375, 'accessible, roll-in'], [63.25, 39.375, 'accessible, roll-in']];
    su.forEach(([w, d, n]) => out.push({ key: `su-${w}x${d}${n}`, kind: 'shower', name: `Sterling ${sz(w)} × ${sz(d)}`, sub: n || 'shower unit', w, d, section: 'Sterling by Kohler shower units', p: { unit: 'sterling', tile: false, left: 'wall', right: 'wall', front: 'open', door: false, curb: true, drain: n.includes('end') ? 'endR' : 'center', valve: 'back', ...(n.includes('seat') ? { bench: 'left', benchW: 15 } : {}) } }));
    out.push({ key: 'tub-alcove', kind: 'tub', name: 'Tub', sub: 'alcove, set any size', w: 60, d: 30, section: 'Tubs' });
    out.push({ key: 'tub-free60', kind: 'ftub', name: 'Freestanding tub, small', sub: '60" long', w: 60, d: 30, section: 'Tubs' });
    out.push({ key: 'tub-free70', kind: 'ftub', name: 'Freestanding tub, large', sub: '70" long', w: 70, d: 32, section: 'Tubs' });
    const tu: Array<[number, number, string]> = [[60, 29, 'Performa'], [60, 30, 'Accord, Ensemble, Traverse'], [60, 32, 'Accord, Ensemble, Traverse'], [60, 36, 'Ensemble Tile'], [60, 42, 'Ensemble Tile']];
    tu.forEach(([w, d, n]) => out.push({ key: `tu-${w}x${d}`, kind: 'tub', name: `Sterling ${w} × ${d}`, sub: n, w, d, section: 'Sterling by Kohler tub units', p: { unit: 'sterling' } }));
  }
  if (c === 'Plumbing' && mode === 'kitchen') {
    const sk = (key: string, name: string, sub: string, sink: string) => out.push({ key, kind: 'sinkbase', name, sub, w: 36, d: 24, section: 'Kitchen sinks (set on the sink base)', applyTo: 'sinkbase', p: { sink } });
    sk('ks-single', 'Full-size single bowl', 'one big bowl', 'single'); sk('ks-5050', '50/50 double bowl', 'two equal bowls', '5050'); sk('ks-farm', 'Farmhouse (apron front)', 'needs a 36" sink base', 'farm');
    out.push({ key: 'ks-disp', kind: 'sinkbase', name: 'Garbage disposal', sub: 'on the sink base; add its switch under Electrical', w: 36, d: 24, section: 'Kitchen sinks (set on the sink base)', applyTo: 'sinkbase', p: { disposal: true } });
  }
  if (c === 'Accessories' && mode === 'kitchen') {
    out.push({ key: 'ch30', kind: 'chimney', name: 'Freestanding range hood 30"', sub: 'chimney style; tile behind it to the ceiling', w: 30, d: 20, section: 'Range hoods' });
    out.push({ key: 'ch36', kind: 'chimney', name: 'Freestanding range hood 36"', sub: 'chimney style; tile behind it to the ceiling', w: 36, d: 20, section: 'Range hoods' });
  }
  for (const [key, k] of Object.entries(KINDS)) {
    if (k.cat !== c || !k.modes.includes(mode) || key === 'shower' || key === 'tub' || key === 'ftub' || key === 'chimney') continue;
    out.push({ key, kind: key, name: k.name, w: k.w, d: k.d, section: c === 'Plumbing' ? 'Fixtures & fittings' : undefined });
  }
  return out;
}

// ---------- a shower floor drawn corner by corner ----------
/** The floor corners (p.poly, in the item's own box: 0,0 = back-left) as points on the drawing. */
export function polyWorld(it: DItem, pts: Pt[]): Pt[] {
  const f = frame(it, pts); const poly = (it.p?.poly || []) as Array<[number, number]>;
  return poly.map(([px, py]) => { const lx = px - it.w / 2, ly = py - it.d / 2; return { x: f.cx + f.ux * lx + f.nx * ly, y: f.cy + f.uy * lx + f.ny * ly }; });
}
/** A drawing point as a spot in the item's own box. */
export function toPolyLocal(it: DItem, pts: Pt[], P: Pt): [number, number] {
  const f = frame(it, pts); const dx = P.x - f.cx, dy = P.y - f.cy;
  return [dx * f.ux + dy * f.uy + it.w / 2, dx * f.nx + dy * f.ny + it.d / 2];
}
/** New corner list -> the changes to the item: the box shrinks or grows to fit, and the item stays put on the drawing. */
export function polyPatch(it: DItem, pts: Pt[], poly: Array<[number, number]>): Partial<DItem> {
  const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]);
  const mx = Math.min(...xs), my = Math.min(...ys), Mx = Math.max(...xs), My = Math.max(...ys);
  const w = Math.max(6, Mx - mx), d = Math.max(6, My - my);
  const f = frame(it, pts); const lx = (mx + Mx) / 2 - it.w / 2, ly = (my + My) / 2 - it.d / 2;
  return { wall: null, rot: Math.round(f.rot * 100) / 100, x: f.cx + f.ux * lx + f.nx * ly, y: f.cy + f.uy * lx + f.ny * ly, w, d, p: { ...(it.p || {}), poly: poly.map(([a, b]) => [a - mx, b - my]) } };
}
export function polyArea(poly: Array<[number, number]>): number {
  let a = 0; for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2;
}
