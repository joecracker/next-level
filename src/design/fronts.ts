// Cabinet fronts: where the doors and drawer fronts sit on a cabinet's room side.
// Shaker doors (a frame around a recessed flat panel) and one-piece drawer fronts; full overlay with a small gap.
import { KINDS } from './model';

/** Gap between fronts, and the reveal left at each side edge, is half of this (inches). 1/4 in: change here to move every cabinet. */
export const FRONT_GAP = 0.5;
/** Thickness of a front (inches). */
export const FRONT_T = 0.75;
/** Width of a shaker door's frame (rails and stiles), inches. */
export const SHAKER_RAIL = 2.25;

/** Kinds that get fronts. Fillers, blanks, islands, appliances and countertops do not. */
export const FRONT_KINDS = new Set(['base', 'sinkbase', 'drawer', 'upper', 'pantry', 'linen', 'utility', 'vanity']);

/** Toe kick: the recessed space at the floor under base-type cabinets. Fronts start above it. 4 1/2 in high, set back 3 in. */
export const KICK_H = 4.5;
export const KICK_SET = 3;
export const KICK_KINDS = new Set(['base', 'sinkbase', 'drawer', 'vanity']);
/** The toe kick height for a cabinet (0 when it has none or it is switched off). */
export function kickOf(it: { kind: string; p?: Record<string, unknown> | null }): number {
  return KICK_KINDS.has(it.kind) && it.p?.kick !== false ? KICK_H : 0;
}

export interface Opening { kind: 'door' | 'drawer'; x0: number; x1: number; y0: number; y1: number }

/** Doors and drawers for a cabinet. Drawer-only cabinets are all drawers; uppers and tall cabinets are all doors. */
export function frontSpec(kind: string, w: number, family?: string): { doors: number; drawers: number } {
  const oneOrTwo = w <= 18 ? 1 : 2;
  // catalog cabinets: read what the family name says (drawers, doors, false fronts) instead of guessing from the kind
  const fam = family ? family.toLowerCase() : '';
  if (fam && (kind === 'base' || kind === 'drawer' || kind === 'vanity')) {
    const vd = kind === 'vanity' ? (w >= 24 ? 2 : 1) : oneOrTwo;
    const named = (fallback: number) => (/double door/.test(fam) ? 2 : /single door/.test(fam) ? 1 : fallback);
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    if (/full height/.test(fam) && /door/.test(fam)) return { doors: named(vd), drawers: 0 };
    const dm = /\b(one|two|three|four|five)\s+drawers?\b/.exec(fam);
    if (dm) return { doors: 0, drawers: words[dm[1]] };
    if (kind === 'vanity') {
      if (/with drawer/.test(fam)) return { doors: named(vd), drawers: 1 };
      if (/drawer base/.test(fam)) return { doors: 0, drawers: 3 };
      // a sink or bowl vanity has a false drawer front over its doors: drawn like a real drawer
      if (/sink|bowl/.test(fam)) return { doors: named(vd), drawers: 1 };
      if (/hamper|wastebasket/.test(fam)) return { doors: named(vd), drawers: 0 };
    }
  }
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
/** The fronts of a cabinet, above its toe kick (kick = 0 for none). */
export function frontOpenings(kind: string, w: number, h: number, family?: string, kick = 0): Opening[] {
  return frontOpeningsAbove(kind, w, h - kick, family).map(o => ({ ...o, y0: o.y0 + kick, y1: o.y1 + kick }));
}
function frontOpeningsAbove(kind: string, w: number, h: number, family?: string): Opening[] {
  if (w < 6 || h < 6) return [];
  const { doors, drawers } = frontSpec(kind, w, family);
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
