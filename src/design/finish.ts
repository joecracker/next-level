// Room floor tile and ceiling shape: the settings, the lines drawn on the plan, and the takeoff lines.
// Everything is worked out from the saved design alone (same rule as exports.ts).
import { fmtIn, polyArea, type Design } from './model';

export const FLOOR_TILES: Array<[string, string]> = [['plain', 'Plain'], ['12', '12×12'], ['12x24', '12×24'], ['24', '24×24'], ['2', '2×2']];
const TILE_NAME: Record<string, string> = { '12': '12x12', '12x24': '12x24', '24': '24x24', '2': '2x2' };
const LINE = '#c9c3b4';
const ARROW = '#6f7f4a';

export function floorOf(d: Design): { tile: string; dir: 'v' | 'h' } {
  return { tile: d.floor?.tile || 'plain', dir: d.floor?.dir === 'h' ? 'h' : 'v' };
}
export function vaultOf(d: Design): { shape: 'flat' | 'slope' | 'peak'; toward: 'top' | 'right' | 'bottom' | 'left'; ridge: 'lr' | 'ud'; pitch: number; hide: boolean } {
  const v = d.vault || {};
  return { shape: v.shape || 'flat', toward: v.toward || 'top', ridge: v.ridge || 'lr', pitch: v.pitch || 6, hide: !!v.hide };
}
/** Tile size across (x) and down (y) the plan, inches. 12x24 "up and down" is 12 wide and 24 tall. */
function tileSize(tile: string, dir: 'v' | 'h'): [number, number] | null {
  if (tile === '12') return [12, 12];
  if (tile === '24') return [24, 24];
  if (tile === '2') return [2, 2];
  if (tile === '12x24') return dir === 'h' ? [24, 12] : [12, 24];
  return null;
}
function box(d: Design) {
  const xs = d.pts.map(p => p.x), ys = d.pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, W: maxX - minX, H: maxY - minY };
}
const n = (v: number) => Math.round(v * 100) / 100;
const polyPts = (d: Design) => d.pts.map(p => `${n(p.x)},${n(p.y)}`).join(' ');

/** Where the ceiling starts (the low walls), where it tops out, and how far it climbs. Uses the room's overall width and depth. */
export function vaultInfo(d: Design): { low: number; high: number; run: number } | null {
  const v = vaultOf(d); if (v.shape === 'flat' || d.pts.length < 3) return null;
  const b = box(d); const low = d.ceiling || 96;
  const run = v.shape === 'slope' ? (v.toward === 'top' || v.toward === 'bottom' ? b.H : b.W) : (v.ridge === 'lr' ? b.H : b.W) / 2;
  return { low, high: low + (v.pitch / 12) * run, run };
}
export function vaultText(d: Design): string {
  const i = vaultInfo(d); if (!i) return '';
  const v = vaultOf(d);
  return `Walls start at ${fmtIn(i.low)} and climb to about ${fmtIn(Math.round(i.high))} at the ${v.shape === 'peak' ? 'peak' : 'high wall'} (${v.pitch} in 12 over ${fmtIn(Math.round(i.run))}).`;
}

/** Tile lines on the room floor, under everything else. */
export function floorTileSvg(d: Design, S: number): string {
  const f = floorOf(d); const ts = tileSize(f.tile, f.dir);
  if (!ts || d.pts.length < 3 || ts[0] * S < 5 || ts[1] * S < 5) return '';
  const b = box(d); const g: string[] = []; const sw = `stroke="${LINE}" stroke-width="${n(0.8 / S)}"`;
  const seg = (x1: number, y1: number, x2: number, y2: number) => g.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${sw}/>`);
  if (f.tile !== '12x24') { // square tile: plain grid
    for (let x = b.minX + ts[0], c = 0; x < b.maxX - 0.01 && c < 400; x += ts[0], c++) seg(x, b.minY, x, b.maxY);
    for (let y = b.minY + ts[1], c = 0; y < b.maxY - 0.01 && c < 400; y += ts[1], c++) seg(b.minX, y, b.maxX, y);
  } else if (f.dir === 'v') { // 12 wide, 24 tall: every other column is shifted up half a tile
    for (let x = b.minX + ts[0], c = 0; x < b.maxX - 0.01 && c < 400; x += ts[0], c++) seg(x, b.minY, x, b.maxY);
    for (let x = b.minX, col = 0; x < b.maxX - 0.01 && col < 400; x += ts[0], col++)
      for (let y = b.minY + (col % 2 ? ts[1] / 2 : ts[1]), r = 0; y < b.maxY - 0.01 && r < 400; y += ts[1], r++) seg(x, y, Math.min(x + ts[0], b.maxX), y);
  } else { // 24 wide, 12 tall: every other row is shifted sideways half a tile
    for (let y = b.minY + ts[1], c = 0; y < b.maxY - 0.01 && c < 400; y += ts[1], c++) seg(b.minX, y, b.maxX, y);
    for (let y = b.minY, row = 0; y < b.maxY - 0.01 && row < 400; y += ts[1], row++)
      for (let x = b.minX + (row % 2 ? ts[0] / 2 : ts[0]), r = 0; x < b.maxX - 0.01 && r < 400; x += ts[0], r++) seg(x, y, x, Math.min(y + ts[1], b.maxY));
  }
  return `<clipPath id="roomfloorclip"><polygon points="${polyPts(d)}"/></clipPath><g clip-path="url(#roomfloorclip)">${g.join('')}</g>`;
}

/** Floor area to tile, square inches: the room, less the shower, tub and freestanding tub footprints. */
export function floorArea(d: Design): number {
  if (d.pts.length < 3) return 0;
  let a = polyArea(d.pts.map(p => [p.x, p.y] as [number, number]));
  for (const it of d.items) {
    if (it.kind !== 'shower' && it.kind !== 'tub' && it.kind !== 'ftub') continue;
    const poly = it.p?.poly as Array<[number, number]> | undefined;
    a -= poly && poly.length >= 3 ? polyArea(poly) : it.w * it.d;
  }
  return Math.max(0, a);
}

/** Dashed ridge line, uphill arrows and a short tag for a vaulted ceiling. */
export function ceilingSvg(d: Design, S: number): string {
  const v = vaultOf(d); const info = vaultInfo(d); if (!info || v.hide) return '';
  const b = box(d); const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2; const fs = 12 / S; const a = 9 / S;
  const o: string[] = [];
  const arrow = (x: number, y: number, ux: number, uy: number) => {
    const px = -uy, py = ux;
    o.push(`<polyline points="${n(x - ux * a + px * a * 0.55)},${n(y - uy * a + py * a * 0.55)} ${n(x)},${n(y)} ${n(x - ux * a - px * a * 0.55)},${n(y - uy * a - py * a * 0.55)}" fill="none" stroke="${ARROW}" stroke-width="${n(1.6 / S)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  };
  const along = (fr: number, horizontal: boolean) => horizontal ? b.minX + b.W * fr : b.minY + b.H * fr;
  if (v.shape === 'slope') {
    const vert = v.toward === 'top' || v.toward === 'bottom';
    const ux = v.toward === 'left' ? -1 : v.toward === 'right' ? 1 : 0, uy = v.toward === 'top' ? -1 : v.toward === 'bottom' ? 1 : 0;
    for (const fr of [0.25, 0.5, 0.75]) arrow(vert ? along(fr, true) : cx, vert ? cy : along(fr, false), ux, uy);
  } else if (v.ridge === 'lr') {
    o.push(`<line x1="${n(b.minX)}" y1="${n(cy)}" x2="${n(b.maxX)}" y2="${n(cy)}" stroke="${ARROW}" stroke-width="${n(1.6 / S)}" stroke-dasharray="${n(7 / S)} ${n(4 / S)}"/>`);
    for (const fr of [0.25, 0.5, 0.75]) { arrow(along(fr, true), cy - b.H / 4, 0, 1); arrow(along(fr, true), cy + b.H / 4, 0, -1); }
  } else {
    o.push(`<line x1="${n(cx)}" y1="${n(b.minY)}" x2="${n(cx)}" y2="${n(b.maxY)}" stroke="${ARROW}" stroke-width="${n(1.6 / S)}" stroke-dasharray="${n(7 / S)} ${n(4 / S)}"/>`);
    for (const fr of [0.25, 0.5, 0.75]) { arrow(cx - b.W / 4, along(fr, false), 1, 0); arrow(cx + b.W / 4, along(fr, false), -1, 0); }
  }
  const tag = (s: string, y: number) => `<text x="${n(cx)}" y="${n(y)}" font-size="${n(fs * 0.9)}" text-anchor="middle" fill="${ARROW}" stroke="#ffffff" stroke-width="${n(3 / S)}" paint-order="stroke" font-weight="700">${s}</text>`;
  const clip = `<clipPath id="roomceilclip"><polygon points="${polyPts(d)}"/></clipPath>`;
  return `${clip}<g clip-path="url(#roomceilclip)">${o.join('')}</g>` +
    tag(`${v.shape === 'peak' ? 'Vaulted peak' : 'Vaulted'} ${fmtIn(info.low)} to ${fmtIn(Math.round(info.high))}`, cy + fs * 0.35) +
    tag(`${v.pitch} in 12`, cy + fs * 1.45);
}

/** Takeoff lines for the room floor tile and the ceiling shape. */
export function finishLines(d: Design): Array<{ desc: string; qty: number; note: string }> {
  const out: Array<{ desc: string; qty: number; note: string }> = [];
  const f = floorOf(d);
  if (f.tile !== 'plain') {
    const sq = Math.round(floorArea(d) / 14.4) / 10;
    out.push({ desc: `Floor tile - ${TILE_NAME[f.tile] || f.tile}${f.tile === '12x24' ? (f.dir === 'h' ? ', laid side to side' : ', laid up and down') : ''}`, qty: 1, note: `about ${sq} sq ft of room floor (shower and tub footprints taken out; add extra for cuts)` });
  }
  const i = vaultInfo(d);
  if (i) {
    const v = vaultOf(d);
    out.push({ desc: v.shape === 'peak' ? 'Vaulted ceiling - center peak' : 'Vaulted ceiling - one slope', qty: 1, note: vaultText(d) });
  }
  return out;
}
