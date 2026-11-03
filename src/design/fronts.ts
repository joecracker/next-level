// Cabinet fronts: where the doors and drawer fronts sit on a cabinet's room side.
// Shaker doors (a frame around a recessed flat panel) and one-piece drawer fronts; full overlay with a small gap.
import { KINDS } from './model';

/** Gap between fronts, and the reveal left at each side edge, is half of this (inches). 1/4 in: change here to move every cabinet. */
export const FRONT_GAP = 0.25;
/** Thickness of a front (inches). */
export const FRONT_T = 0.75;
/** Width of a shaker door's frame (rails and stiles), inches. */
export const SHAKER_RAIL = 2.25;

/** Kinds that get fronts. Fillers, blanks, islands, appliances and countertops do not. */
export const FRONT_KINDS = new Set(['base', 'sinkbase', 'drawer', 'upper', 'pantry', 'linen', 'utility', 'vanity']);

export interface Opening { kind: 'door' | 'drawer'; x0: number; x1: number; y0: number; y1: number }

/** Doors and drawers for a cabinet. Drawer-only cabinets are all drawers; uppers and tall cabinets are all doors. */
export function frontSpec(kind: string, w: number): { doors: number; drawers: number } {
  const oneOrTwo = w <= 18 ? 1 : 2;
  switch (kind) {
    case 'base': return { doors: oneOrTwo, drawers: 1 };
    case 'sinkbase': return { doors: 2, drawers: 1 };
    case 'drawer': return { doors: 0, drawers: 3 };
    case 'vanity': return { doors: w >= 24 ? 2 : 1, drawers: 1 };
    case 'upper': return { doors: oneOrTwo, drawers: 0 };
    default: return { doors: oneOrTwo, drawers: 0 }; // pantry, linen, utility: tall doors
  }
}

/** Height of the cabinet box, in inches, measured from the bottom of the item (uppers hang at 54" in 3D). */
export function frontHeight(it: { kind: string; h?: number }): number {
  const k = KINDS[it.kind];
  return it.h || (k as { h?: number } | undefined)?.h || (it.kind === 'upper' ? 30 : 34.5);
}

/** Each front's place on the cabinet, centred on the item (x from -w/2 to w/2), y from the item's bottom. */
export function frontOpenings(kind: string, w: number, h: number): Opening[] {
  if (w < 6 || h < 6) return [];
  const { doors, drawers } = frontSpec(kind, w);
  const edge = FRONT_GAP / 2;
  const out: Opening[] = [];
  const top = h - edge;
  let drawerBottom = top;
  // Drawers stack across the top. With doors below, each drawer is about 6" and the doors take the rest.
  if (drawers) {
    const dh = doors ? 6 : (h - 2 * edge - (drawers - 1) * FRONT_GAP) / drawers;
    const block = drawers * dh + (drawers - 1) * FRONT_GAP;
    drawerBottom = top - block;
    for (let i = 0; i < drawers; i++) {
      const y1 = top - i * (dh + FRONT_GAP);
      out.push({ kind: 'drawer', x0: -w / 2 + edge, x1: w / 2 - edge, y0: y1 - dh, y1 });
    }
    if (!doors) return out;
    drawerBottom -= FRONT_GAP;
  }
  const bottom = edge;
  const dw = (w - 2 * edge - (doors - 1) * FRONT_GAP) / doors;
  for (let i = 0; i < doors; i++) {
    const x0 = -w / 2 + edge + i * (dw + FRONT_GAP);
    out.push({ kind: 'door', x0, x1: x0 + dw, y0: bottom, y1: drawerBottom });
  }
  return out;
}
