// Custom pieces: anything built from a short list of simple parts (boxes, wedges, triangles, tops, shelves).
// A piece is an ordinary drawing item (kind 'custom') whose p.parts holds the parts, so it is saved with the
// design and nothing else has to be kept in step. Parts sit in the piece's own box: x runs along the width,
// y along the depth (like the plan), z is the height off the floor. Resizing the piece scales every part.
//
// A part's footprint is a shape in 0..1 units that is stretched to the part's width and depth, so a part can
// be resized without redoing its points: the 'box' is the unit square; 'tri' is a right triangle with the
// right angle at 0,0; 'wedge' is the corner-unit shape (a triangle with small flat ends).
import { fmtIn, polyArea, type DItem, type Design } from './model';

export type PartShape = 'box' | 'tri' | 'wedge';
export type PartMat = 'paint' | 'tile' | 'wood' | 'stone';
export interface Part {
  id: string; name: string; shape: PartShape;
  x: number; y: number; z: number; w: number; d: number; h: number;   // inches; z = underside of the part off the floor
  mat: PartMat; color: string;                                        // color: a hex such as #e6e2d6
}
type P2 = [number, number];

export const SHAPES: Array<[PartShape, string]> = [['box', 'Box or panel'], ['tri', 'Triangle'], ['wedge', 'Corner wedge']];
export const MATS: Array<[PartMat, string, string]> = [   // id, name, starting color
  ['paint', 'Painted', '#e8e6df'], ['tile', 'Tile', '#e6e2d6'], ['wood', 'Wood', '#a0764e'], ['stone', 'Granite or stone', '#b7b4ac'],
];
export const matName = (m: PartMat): string => MATS.find(x => x[0] === m)?.[1] || m;
export const matColor = (m: PartMat): string => MATS.find(x => x[0] === m)?.[2] || '#cccccc';
const uid = () => Math.random().toString(36).slice(2, 8);

/** The footprint of a shape in 0..1 units. */
export function unitPoly(s: PartShape): P2[] {
  if (s === 'tri') return [[0, 0], [1, 0], [0, 1]];
  if (s === 'wedge') return [[0, 0], [1, 0], [1, 0.08], [0.08, 1], [0, 1]];
  return [[0, 0], [1, 0], [1, 1], [0, 1]];
}
/** A new part with sensible sizes for what it is. */
export function newPart(shape: PartShape, mat: PartMat, name: string, over: Partial<Part> = {}): Part {
  return { id: uid(), name, shape, x: 0, y: 0, z: 0, w: 24, d: 24, h: 1.5, mat, color: matColor(mat), ...over };
}
/** The first parts of a fresh custom piece: a simple open cabinet carcass with one shelf. */
export function starterParts(): Part[] {
  return [
    newPart('box', 'paint', 'Bottom', { w: 24, d: 14, h: 0.75, z: 3 }),
    newPart('box', 'paint', 'Left side', { w: 0.75, d: 14, h: 36, x: 0 }),
    newPart('box', 'paint', 'Right side', { w: 0.75, d: 14, h: 36, x: 23.25 }),
    newPart('box', 'paint', 'Shelf', { w: 22.5, d: 14, h: 0.75, x: 0.75, z: 18 }),
    newPart('box', 'paint', 'Top', { w: 24, d: 14, h: 0.75, z: 36 }),
  ];
}

/** Size of the box that holds every part. */
export function partsBounds(parts: Part[]): { w: number; d: number; h: number } {
  let w = 0, d = 0, h = 0;
  for (const p of parts) { w = Math.max(w, p.x + p.w); d = Math.max(d, p.y + p.d); h = Math.max(h, p.z + p.h); }
  return { w: Math.max(w, 1), d: Math.max(d, 1), h: Math.max(h, 1) };
}

export interface CustomView { name: string; parts: Part[]; sx: number; sy: number; sz: number }
/** The piece's parts, scaled to the item's current width, depth and height. */
export function customOf(it: DItem): CustomView {
  const p = it.p || {}; const raw: Part[] = Array.isArray(p.parts) ? p.parts : [];
  const b = partsBounds(raw);
  const sx = it.w / (p.bw || b.w), sy = it.d / (p.bd || b.d), sz = (it.h || p.bh || b.h) / (p.bh || b.h);
  return { name: String(p.name || 'Custom piece'), parts: raw, sx: isFinite(sx) && sx > 0 ? sx : 1, sy: isFinite(sy) && sy > 0 ? sy : 1, sz: isFinite(sz) && sz > 0 ? sz : 1 };
}
/** Footprint of one part, in the item's box (inches), after scaling. */
export function partPoly(pt: Part, v: { sx: number; sy: number }): P2[] {
  return unitPoly(pt.shape).map(([u, w]) => [(pt.x + u * pt.w) * v.sx, (pt.y + w * pt.d) * v.sy] as P2);
}
/** Where a part's underside and top are (inches off the floor), after scaling. */
export const partZ = (pt: Part, v: { sz: number }): [number, number] => [pt.z * v.sz, (pt.z + pt.h) * v.sz];

/** Item fields that make the item exactly as big as its parts (used after the parts are edited). */
export function fitToParts(parts: Part[], p: Record<string, any>): { w: number; d: number; h: number; p: Record<string, any> } {
  const b = partsBounds(parts);
  return { w: b.w, d: b.d, h: b.h, p: { ...p, parts, bw: b.w, bd: b.d, bh: b.h } };
}
/** A ready item recipe for the Add menu from a list of parts. */
export function pieceEntry(name: string, parts: Part[]): { w: number; d: number; extra: Partial<DItem>; p: Record<string, any> } {
  const f = fitToParts(parts, { name });
  return { w: f.w, d: f.d, extra: { h: f.h }, p: f.p };
}

/** Takeoff lines: the piece, then each part with its size and material. */
export function customLines(d: Design): Array<{ desc: string; qty: number; note: string }> {
  const out: Array<{ desc: string; qty: number; note: string }> = [];
  for (const it of d.items) {
    if (it.kind !== 'custom') continue;
    const v = customOf(it); const b = partsBounds(v.parts);
    out.push({ desc: 'Custom piece - ' + v.name, qty: 1, note: fmtIn(it.w) + ' wide x ' + fmtIn(it.d) + ' deep x ' + fmtIn(Math.round((it.h || b.h * v.sz) * 8) / 8) + ' high, ' + v.parts.length + ' part' + (v.parts.length === 1 ? '' : 's') });
    for (const pt of v.parts) {
      const w = pt.w * v.sx, dd = pt.d * v.sy, h = pt.h * v.sz;
      const flat = h <= 2.01 && (pt.mat === 'stone' || pt.mat === 'tile');
      const area = pt.shape === 'box' ? w * dd : polyArea(partPoly(pt, v)) ;
      out.push({ desc: '  ' + v.name + ': ' + pt.name + ' - ' + matName(pt.mat).toLowerCase(), qty: 1, note: fmtIn(Math.round(w * 8) / 8) + ' x ' + fmtIn(Math.round(dd * 8) / 8) + ' x ' + fmtIn(Math.round(h * 8) / 8) + (flat ? ', about ' + Math.round(area / 14.4) / 10 + ' sq ft' : '') });
    }
  }
  return out;
}

/** Take parts from anywhere (the AI helper, an old file) and make them safe: known shapes and materials, a real color, numbers inside sane limits. */
export function cleanParts(raw: unknown): Part[] {
  if (!Array.isArray(raw)) return [];
  const n = (v: unknown, lo: number, hi: number, dflt: number): number => { const x = Number(v); return isFinite(x) ? Math.round(Math.min(hi, Math.max(lo, x)) * 8) / 8 : dflt; };
  return raw.slice(0, 60).map((r: any, i: number): Part => {
    const shape: PartShape = r?.shape === 'tri' || r?.shape === 'wedge' ? r.shape : 'box';
    const mat: PartMat = r?.mat === 'tile' || r?.mat === 'wood' || r?.mat === 'stone' ? r.mat : 'paint';
    const color = /^#[0-9a-f]{6}$/i.test(String(r?.color)) ? String(r.color) : matColor(mat);
    return { id: uid(), name: String(r?.name || 'Part ' + (i + 1)).slice(0, 40), shape, mat, color, x: n(r?.x, 0, 240, 0), y: n(r?.y, 0, 240, 0), z: n(r?.z, 0, 120, 0), w: n(r?.w, 0.125, 240, 1), d: n(r?.d, 0.125, 240, 1), h: n(r?.h, 0.125, 120, 1) };
  });
}

// ---------- the library of saved pieces ("My pieces") ----------
// Kept on this device AND, when Google Drive is connected, in a file in the "Next Level Library" Drive folder
// (my-pieces.json), so clearing the browser or changing computers loses nothing. The two copies are merged:
// the newest copy of each piece wins, and a removed piece stays removed (its id is remembered).
export interface Saved { id: string; name: string; parts: Part[]; at: number }
const KEY = 'nl-my-pieces', GONE = 'nl-my-pieces-gone', FILE = 'my-pieces.json';
const NLW = (): any => (typeof window !== 'undefined' ? (window as any).NextLevel : undefined);
export const driveReady = (): boolean => { try { return !!NLW()?.driveState?.().connected; } catch { return false; } };
export function loadPieces(): Saved[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter(x => x && Array.isArray(x.parts)).map(x => ({ ...x, at: Number(x.at) || 0 })) : []; } catch { return []; }
}
function goneIds(): string[] { try { const v = JSON.parse(localStorage.getItem(GONE) || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } }
function store(list: Saved[], gone?: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); if (gone) localStorage.setItem(GONE, JSON.stringify(gone.slice(-300))); } catch { /* storage can be off; the piece still lives in the drawing */ }
}
/** Send the whole library to Drive (quietly does nothing when Drive is not connected). */
export async function pushPieces(): Promise<boolean> {
  const nl = NLW(); if (!driveReady() || !nl?.saveLibrary) return false;
  try { await nl.saveLibrary(FILE, { v: 1, pieces: loadPieces(), gone: goneIds() }); return true; } catch { return false; }
}
/** Merge the Drive copy with this device's copy, keep both up to date, and return the result. */
export async function syncPieces(): Promise<Saved[]> {
  const nl = NLW(); if (!driveReady() || !nl?.loadLibrary) return loadPieces();
  try {
    const remote: any = await nl.loadLibrary(FILE);
    const gone = new Set<string>([...goneIds(), ...(Array.isArray(remote?.gone) ? remote.gone.map(String) : [])]);
    const byId = new Map<string, Saved>();
    for (const s of [...(Array.isArray(remote?.pieces) ? remote.pieces : []), ...loadPieces()]) {
      if (!s || !Array.isArray(s.parts) || gone.has(s.id)) continue;
      const old = byId.get(s.id); if (!old || (Number(s.at) || 0) >= old.at) byId.set(s.id, { id: String(s.id), name: String(s.name || 'Piece'), parts: cleanParts(s.parts), at: Number(s.at) || 0 });
    }
    const byName = new Map<string, Saved>(); // two copies with the same name: keep the newest
    for (const s of byId.values()) { const k = s.name.toLowerCase(); const o = byName.get(k); if (!o || s.at > o.at) byName.set(k, s); }
    const list = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    store(list, [...gone]); await pushPieces(); return list;
  } catch { return loadPieces(); }
}
/** Save a piece under a name (the same name replaces the old one) and send it to Drive in the background. */
export function savePiece(name: string, parts: Part[]): Saved[] {
  const gone = goneIds(); const keep: Saved[] = [];
  for (const x of loadPieces()) { if (x.name.toLowerCase() === name.toLowerCase()) gone.push(x.id); else keep.push(x); }
  keep.push({ id: uid(), name, parts: JSON.parse(JSON.stringify(parts)), at: Date.now() }); keep.sort((a, b) => a.name.localeCompare(b.name));
  store(keep, gone); void pushPieces(); return keep;
}
export function deletePiece(id: string): Saved[] {
  const list = loadPieces().filter(x => x.id !== id); store(list, [...goneIds(), id]); void pushPieces(); return list;
}
