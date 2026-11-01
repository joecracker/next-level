// Finishes: cabinet, countertop, wall and floor colors, plus appliance finishes. Plain flat colors (no textures),
// so they cost the computer nothing. The room has defaults (d.finish, d.counter.color, d.floor.color); one item or
// one countertop run can override with its own color (p.ccolor on a cabinet, p.tcolor on a top).
import type { DItem, Design } from './model';

export interface Swatch { id: string; name: string; hex: string }

/** A darker version of a color (f below 1), for edges and tile lines. */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return '#' + [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)].map(v => v.toString(16).padStart(2, '0')).join('');
}

export const CAB_DEFAULT = '#d3bd94';
export const CAB_COLORS: Swatch[] = [
  { id: 'white', name: 'White', hex: '#f2f1ec' },
  { id: 'cream', name: 'Cream', hex: '#efe6d2' },
  { id: 'ltgray', name: 'Light gray', hex: '#c9cccd' },
  { id: 'greige', name: 'Greige', hex: '#b9b1a3' },
  { id: 'taupe', name: 'Taupe', hex: '#a69a8b' },
  { id: 'sand', name: 'Sand', hex: '#d8c7a8' },
  { id: 'dkgray', name: 'Dark gray', hex: '#5d6266' },
  { id: 'charcoal', name: 'Charcoal', hex: '#383d42' },
  { id: 'black', name: 'Black', hex: '#2b2d2f' },
  { id: 'navy', name: 'Navy blue', hex: '#1f3350' },
  { id: 'blue', name: 'Harbor blue', hex: '#4a6b8a' },
  { id: 'sage', name: 'Sage green', hex: '#8fa08a' },
  { id: 'forest', name: 'Forest green', hex: '#3d5a47' },
  { id: 'maple', name: 'Natural maple', hex: '#d9b985' },
  { id: 'honey', name: 'Honey', hex: '#c99a5b' },
  { id: 'oak', name: 'Golden oak', hex: '#b98b4e' },
  { id: 'cherry', name: 'Cherry', hex: '#7a3f2b' },
  { id: 'chestnut', name: 'Chestnut', hex: '#8a5a3a' },
  { id: 'walnut', name: 'Walnut', hex: '#6b4a32' },
  { id: 'espresso', name: 'Espresso', hex: '#3e2b20' },
];

const top = (id: string, name: string, hex: string) => ({ id, name, hex, fill: hex, edge: shade(hex, 0.62) });
export const TOP_COLORS: Array<Swatch & { fill: string; edge: string }> = [
  top('white', 'White', '#f1f0ec'),
  top('offwhite', 'Off-white', '#ece8dc'),
  top('cream', 'Cream', '#e6d9ba'),
  top('beige', 'Beige', '#d3c1a1'),
  top('tan', 'Tan', '#cdb48a'),
  top('brown', 'Brown', '#7b5b3d'),
  top('gray', 'Gray', '#b9bbbd'),
  top('slate', 'Blue-gray', '#9aa5ad'),
  top('dkgray', 'Dark gray', '#6b6f73'),
  top('black', 'Black', '#35383b'),
];

export const WALL_COLORS: Swatch[] = [
  { id: 'white', name: 'White', hex: '#f6f4ee' },
  { id: 'warm', name: 'Warm white', hex: '#f1ebdd' },
  { id: 'greige', name: 'Greige', hex: '#d6cfc2' },
  { id: 'ltgray', name: 'Light gray', hex: '#d7d9d9' },
  { id: 'gray', name: 'Gray', hex: '#b4b7b8' },
  { id: 'sage', name: 'Sage', hex: '#b9c4b0' },
  { id: 'bluegray', name: 'Blue-gray', hex: '#b3bfc7' },
  { id: 'tan', name: 'Tan', hex: '#d1bf9f' },
  { id: 'navy', name: 'Navy accent', hex: '#3e4f68' },
];

export const FLOOR_COLORS: Swatch[] = [
  { id: 'white', name: 'White', hex: '#eeeeea' },
  { id: 'ltgray', name: 'Light gray', hex: '#d4d6d3' },
  { id: 'gray', name: 'Gray', hex: '#a9adaf' },
  { id: 'dkgray', name: 'Dark gray', hex: '#6a6e71' },
  { id: 'black', name: 'Black', hex: '#3a3d40' },
  { id: 'beige', name: 'Beige', hex: '#d9ccb3' },
  { id: 'tan', name: 'Tan', hex: '#bfa780' },
  { id: 'brown', name: 'Brown', hex: '#7d5f45' },
];

export const APP_FINISHES: Swatch[] = [
  { id: 'steel', name: 'Stainless look', hex: '#c4c8ca' },
  { id: 'white', name: 'White', hex: '#f4f4f1' },
  { id: 'black', name: 'Black', hex: '#2f3235' },
  { id: 'bslate', name: 'Black stainless', hex: '#6c7074' },
];

/** The paint for a countertop color id, or null for "standard" (the material's own color). */
export function colorPaint(id: string | undefined): { fill: string; edge: string; name: string } | null {
  const c = TOP_COLORS.find(x => x.id === id);
  return c ? { fill: c.fill, edge: c.edge, name: c.name } : null;
}

/** Cabinet color for one item: its own choice, else the room's (uppers can have their own). */
export function cabColor(d: Design, it: DItem): string {
  const upper = it.kind === 'upper' || it.kind === 'valance';
  const id = it.p?.ccolor || (upper ? d.finish?.upper || d.finish?.cab : d.finish?.cab);
  return CAB_COLORS.find(x => x.id === id)?.hex || CAB_DEFAULT;
}
export function appHex(d: Design): string {
  return APP_FINISHES.find(x => x.id === d.finish?.app)?.hex || APP_FINISHES[0].hex;
}
/** Wall paint and floor tile colors, or undefined for "standard". */
export const wallHexOf = (d: Design): string | undefined => WALL_COLORS.find(x => x.id === d.finish?.wall)?.hex;
export const floorHexOf = (d: Design): string | undefined => FLOOR_COLORS.find(x => x.id === d.floor?.color)?.hex;
