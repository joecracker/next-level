// Finishes: cabinet colors, countertop colors and appliance finishes. Plain flat colors (no textures), so they
// cost the computer nothing. The room has defaults (d.finish, d.counter.color); one item or one countertop run
// can override with its own color (p.ccolor on a cabinet, p.tcolor on a top).
import type { DItem, Design } from './model';

export interface Swatch { id: string; name: string; hex: string }

export const CAB_DEFAULT = '#d3bd94';
export const CAB_COLORS: Swatch[] = [
  { id: 'white', name: 'White', hex: '#f2f1ec' },
  { id: 'ltgray', name: 'Light gray', hex: '#c9cccd' },
  { id: 'dkgray', name: 'Dark gray', hex: '#5d6266' },
  { id: 'navy', name: 'Navy blue', hex: '#1f3350' },
  { id: 'blue', name: 'Harbor blue', hex: '#4a6b8a' },
  { id: 'sage', name: 'Sage green', hex: '#8fa08a' },
  { id: 'greige', name: 'Greige', hex: '#b9b1a3' },
  { id: 'black', name: 'Black', hex: '#2b2d2f' },
  { id: 'maple', name: 'Natural maple', hex: '#d9b985' },
  { id: 'oak', name: 'Golden oak', hex: '#b98b4e' },
  { id: 'chestnut', name: 'Chestnut', hex: '#8a5a3a' },
  { id: 'walnut', name: 'Walnut', hex: '#6b4a32' },
  { id: 'espresso', name: 'Espresso', hex: '#3e2b20' },
];

export const TOP_COLORS: Array<Swatch & { fill: string; edge: string }> = [
  { id: 'gray', name: 'Gray', hex: '#b9bbbd', fill: '#b9bbbd', edge: '#7c7f82' },
  { id: 'offwhite', name: 'Off-white', hex: '#ece8dc', fill: '#ece8dc', edge: '#a8a393' },
  { id: 'tan', name: 'Tan', hex: '#cdb48a', fill: '#cdb48a', edge: '#8f7a52' },
  { id: 'dkgray', name: 'Dark gray', hex: '#6b6f73', fill: '#6b6f73', edge: '#3d4043' },
  { id: 'black', name: 'Black', hex: '#35383b', fill: '#35383b', edge: '#1a1c1e' },
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
