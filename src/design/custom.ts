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

// ---------- the library of saved pieces ("My pieces") ----------
export interface Saved { id: string; name: string; parts: Part[] }
const KEY = 'nl-my-pieces';
export function loadPieces(): Saved[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter(x => x && Array.isArray(x.parts)) : []; } catch { return []; }
}
function storePieces(list: Saved[]) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage can be off; the piece still lives in the drawing */ } }
/** Save a piece under a name (the same name replaces the old one). */
export function savePiece(name: string, parts: Part[]): Saved[] {
  const list = loadPieces().filter(x => x.name.toLowerCase() !== name.toLowerCase());
  list.push({ id: uid(), name, parts: JSON.parse(JSON.stringify(parts)) }); list.sort((a, b) => a.name.localeCompare(b.name)); storePieces(list); return list;
}
export function deletePiece(id: string): Saved[] { const list = loadPieces().filter(x => x.id !== id); storePieces(list); return list; }
