// Design Studio data - what gets stored on a job as project.design.
// All sizes are inches. An item's x,y is its CENTER on the room plan; rot is degrees.
export interface Pt { x: number; y: number }
export interface DItem {
  id: string;
  kind: string;        // base, sinkbase, vanity, toilet, shower, door, window, ...
  label?: string;      // what to print on the drawing
  code?: string;       // maker's catalog code, e.g. B24 (cabinets)
  cab?: boolean;       // true = counts in the cabinet takeoff
  w: number; d: number; h?: number;
  x: number; y: number; rot: number;
  wall?: number | null; t?: number; // riding on wall index at position t (inches along the wall)
  notes?: string;
}
export interface Design {
  v: 1;
  mode: 'bath' | 'kitchen';
  pts: Pt[];           // room corners, in order
  items: DItem[];
  ceiling?: number;    // ceiling height, inches
}

export const hasDesign = (d?: Design | null): d is Design => !!d && (d.pts?.length >= 3 || (d.items?.length ?? 0) > 0);

/** 94.5 -> 7'-10 1/2"  (nearest 1/16) */
export function fmtIn(inches: number): string {
  const neg = inches < 0; let v = Math.round(Math.abs(inches) * 16);
  const ft = Math.floor(v / 192); v -= ft * 192;
  const whole = Math.floor(v / 16); let fr = v % 16;
  let frac = '';
  if (fr) { let n = fr, dn = 16; while (n % 2 === 0) { n /= 2; dn /= 2; } frac = ` ${n}/${dn}`; }
  const inch = `${whole}${frac}"`;
  return (neg ? '-' : '') + (ft ? `${ft}'-${inch}` : inch);
}
