// Cabinet catalogs by maker. Each entry is one orderable model with its real size from the maker's own sheet.
import { HC_FAMILIES, HC_ROWS } from './homecrestData';
import { WB_SELECT_FAMILIES, WB_SELECT_ROWS } from './wellbornSelectData';

export interface CabEntry { maker: string; line: string; group: string; family: string; code: string; w: number; d: number; h: number | null; lr: boolean }

export interface Line { id: string; ready: boolean; note: string }
export const MAKERS: Array<{ id: string; note: string; ready: boolean; lines?: Line[] }> = [
  { id: 'Homecrest', note: 'from Homecrest\'s Specifications Guide (2019 sheet)', ready: true },
  { id: 'Wellborn', note: 'from Wellborn\'s own specification catalogs', ready: true, lines: [
    { id: 'Select', ready: true, note: 'Select Specification Catalog 2024-2025. Sizes come from the model codes and the catalog headings.' },
    { id: 'Aspire', ready: false, note: 'Aspire is not loaded yet.' },
    { id: 'Premier', ready: false, note: 'Premier is not loaded yet.' },
  ] },
];

const cache: Record<string, CabEntry[]> = {};
export function catalogFor(maker: string, line = ''): CabEntry[] {
  const key = maker + '|' + line;
  if (cache[key]) return cache[key];
  let out: CabEntry[] = [];
  if (maker === 'Homecrest') out = HC_ROWS.map(([f, code, w, d, h, lr]) => ({ maker, line: '', group: HC_FAMILIES[f][0], family: HC_FAMILIES[f][1], code, w, d: d ?? 24, h, lr: lr === 'LR' }));
  if (maker === 'Wellborn' && line === 'Select') out = WB_SELECT_ROWS.map(([f, code, w, d, h, lr]) => ({ maker, line, group: WB_SELECT_FAMILIES[f][0], family: WB_SELECT_FAMILIES[f][1], code, w, d: d ?? 24, h, lr: lr === 'LR' }));
  return (cache[key] = out);
}
export function readyCatalogs(): CabEntry[] {
  return MAKERS.filter(m => m.ready).flatMap(m => m.lines ? m.lines.filter(l => l.ready).flatMap(l => catalogFor(m.id, l.id)) : catalogFor(m.id));
}
export const GROUP_ORDER = ['Base cabinets', 'Wall cabinets', 'Tall cabinets', 'Vanities & bath', 'Laundry, desk & other'];
export function groupsFor(maker: string, line = ''): string[] {
  const have = new Set(catalogFor(maker, line).map(e => e.group));
  return GROUP_ORDER.filter(g => have.has(g));
}
export function familiesFor(maker: string, group: string, line = ''): string[] {
  const seen: string[] = []; for (const e of catalogFor(maker, line)) if (e.group === group && !seen.includes(e.family)) seen.push(e.family); return seen;
}
/** Which kind of thing it is on the drawing: hung on the wall, a tall floor cabinet, a vanity, or a plain base. */
export function kindForEntry(e: CabEntry): string {
  const f = e.family.toLowerCase();
  if (e.group === 'Wall cabinets') return 'upper';
  if (e.group === 'Tall cabinets') return 'pantry';
  if (e.group === 'Vanities & bath') {
    if (/medicine|mirror|vanity wall|boutique/.test(f)) return 'upper';
    if (/linen/.test(f)) return 'linen';
    return 'vanity';
  }
  if (/pantry|utility|oven|laundry utility/.test(f) && (e.h ?? 0) > 60) return 'pantry';
  return 'base';
}
export function matches(e: CabEntry, q: string): boolean {
  const s = q.toLowerCase(); return e.code.toLowerCase().includes(s) || e.family.toLowerCase().includes(s) || e.group.toLowerCase().includes(s);
}
