// What a Design looks like on paper: the drawing (SVG, also used by the Design Studio screen), a plan
// picture (PNG) and a cabinet takeoff (CSV). All are built from the saved design alone, so they work from
// the studio, from Capture's Save-to-Drive, or anywhere else with the studio closed.
import { KINDS, T, corners, fmtIn, frame, isCab, seg, type DItem, type Design } from './model';
import { fixtureShape } from './shapes';

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const INK = '#14191A';

export function itemShape(it: DItem, S: number, sel: boolean, fs: number): string {
  const k = KINDS[it.kind]; const hw = it.w / 2, hd = it.d / 2; const sw = 1.5 / S;
  const stroke = sel ? '#E8731A' : INK; const strokeW = sel ? 3 / S : sw;
  const lab0 = isCab(it.kind) && it.code ? it.code : it.label || k.name;
  const fx = fixtureShape(it, S, fs, stroke, strokeW, lab0);
  if (fx !== null) return fx;
  let body = '';
  const text = (s: string, y = 0, size = fs) => `<text x="0" y="${y + size * 0.35}" font-size="${size}" text-anchor="middle" fill="${INK}">${esc(s)}</text>`;
  if (it.kind === 'door') {
    const sgn = it.swing === 'out' ? -1 : 1; const hx = it.hinge === 'right' ? hw : -hw, ox = it.hinge === 'right' ? -hw : hw;
    const y0 = sgn * (T / 2);
    body = `<rect x="${-hw}" y="${-hd}" width="${it.w}" height="${it.d}" fill="#ffffff" stroke="none"/>` +
      `<line x1="${hx}" y1="${y0}" x2="${hx}" y2="${y0 + sgn * it.w}" stroke="${stroke}" stroke-width="${strokeW}"/>` +
      `<path d="M ${ox} ${y0} A ${it.w} ${it.w} 0 0 ${(sgn > 0) === (it.hinge === 'right') ? 1 : 0} ${hx} ${y0 + sgn * it.w}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-dasharray="${4 / S} ${3 / S}"/>` +
      `<line x1="${-hw}" y1="${-hd}" x2="${-hw}" y2="${hd}" stroke="${stroke}" stroke-width="${strokeW}"/><line x1="${hw}" y1="${-hd}" x2="${hw}" y2="${hd}" stroke="${stroke}" stroke-width="${strokeW}"/>`;
  } else if (it.kind === 'window') {
    body = `<rect x="${-hw}" y="${-hd}" width="${it.w}" height="${it.d}" fill="#ffffff" stroke="${stroke}" stroke-width="${strokeW}"/>` +
      `<line x1="${-hw}" y1="0" x2="${hw}" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`;
  } else {
    const fill = k.layer === 'ceiling' ? 'none' : k.cab ? (k.layer === 'hung' ? '#f3e7cf' : '#e9d8b8') : k.layer === 'hung' ? '#eef0ee' : '#dbe7e1';
    const dash = k.layer === 'ceiling' || k.layer === 'hung' ? ` stroke-dasharray="${5 / S} ${3 / S}"` : '';
    if (k.layer === 'ceiling' && it.kind !== 'soffit') body = `<ellipse rx="${hw}" ry="${hd}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}"${dash}/>`;
    else body = `<rect x="${-hw}" y="${-hd}" width="${it.w}" height="${it.d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}"${dash}/>`;
    // a cabinet's front (the doors) is the room side: one bold line along that edge, so a turned cabinet shows which way it faces
    if (k.cab && k.layer !== 'ceiling' && it.w > 3) body += `<line x1="${-hw + 1}" y1="${hd - 1.8 / S}" x2="${hw - 1}" y2="${hd - 1.8 / S}" stroke="${INK}" stroke-width="${3.4 / S}" stroke-linecap="round"/>`;
    const label = isCab(it.kind) && it.code ? it.code : it.label || (k.layer === 'hung' && it.w < 8 ? '' : k.name);
    // keep text readable: skip names that cannot fit
    const fits = it.w * S > (label.length * 6.2 + 4) || it.d * S > (label.length * 6.2 + 4);
    if (label && fits) body += it.w * S >= it.d * S ? text(label) : `<g transform="rotate(90)">${text(label)}</g>`;
    else if (label && k.layer !== 'hung') body += text(label.slice(0, 3));
  }
  return body;
}

/** The inner drawing: floor, walls, wall lengths, items. `S` = pixels per inch (keeps text a steady size). */
export function designBody(d: Design, S: number, selId?: string | null, title?: string, tl?: { x: number; y: number }, flags?: Record<string, 'fix' | 'tight'>): string {
  const pts = d.pts || []; const fs = 12 / S; const out: string[] = [];
  if (title && tl) out.push(`<text x="${tl.x}" y="${tl.y}" font-size="${fs * 1.5}" font-weight="700" fill="${INK}">${esc(title)}</text>`);
  if (pts.length >= 3) {
    const poly = pts.map(p => `${p.x},${p.y}`).join(' ');
    out.push(`<polygon points="${poly}" fill="none" stroke="#6b6f6c" stroke-width="${T * 2}" stroke-linejoin="miter"/>`);
    out.push(`<polygon points="${poly}" fill="#f4f1ea" stroke="${INK}" stroke-width="${2 / S}" stroke-linejoin="miter"/>`);
  }
  const order: string[] = ['inwall', 'floor', 'hung', 'ceiling'];
  const items = (d.items || []).slice().sort((a, b) => order.indexOf(KINDS[a.kind].layer) - order.indexOf(KINDS[b.kind].layer));
  for (const it of items) {
    const f = frame(it, pts);
    const fl = flags?.[it.id];
    const ring = fl ? `<rect x="${-it.w / 2 - 1.5}" y="${-it.d / 2 - 1.5}" width="${it.w + 3}" height="${it.d + 3}" fill="none" stroke="${fl === 'fix' ? '#d9482b' : '#d9a441'}" stroke-width="${3 / S}" stroke-dasharray="${6 / S} ${4 / S}"/>` : '';
    out.push(`<g transform="translate(${f.cx} ${f.cy}) rotate(${f.rot})">${itemShape(it, S, it.id === selId, fs)}${ring}</g>`);
  }
  if (pts.length >= 3) { // wall lengths, outside the wall
    pts.forEach((p, i) => {
      const s = seg(pts, i); if (s.L < 1) return;
      const mx = (s.ax + s.bx) / 2 - s.nx * (T + fs * 1.3), my = (s.ay + s.by) / 2 - s.ny * (T + fs * 1.3);
      out.push(`<text x="${mx}" y="${my + fs * 0.35}" font-size="${fs}" text-anchor="middle" fill="#3b4440">${fmtIn(s.L)}</text>`);
      void p;
    });
  }
  return out.join('');
}

/** Bounding box of the room and everything in it, inches. */
export function designBounds(d: Design): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs: number[] = [], ys: number[] = [];
  d.pts.forEach(p => { xs.push(p.x); ys.push(p.y); });
  d.items.forEach(it => { corners(it, frame(it, d.pts)).forEach(c => { xs.push(c[0]); ys.push(c[1]); }); });
  if (!xs.length) return { minX: 0, minY: 0, maxX: 96, maxY: 96 };
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** The whole plan as a stand-alone SVG string. */
export function designSvg(d: Design, opt: { title?: string; width?: number } = {}): { svg: string; w: number; h: number } {
  const b = designBounds(d); const M = 44; // inches of white space (room for the wall lengths)
  const top = b.minY - M - (opt.title ? 22 : 0);
  const vw = b.maxX - b.minX + 2 * M, vh = b.maxY - top + M;
  const W = opt.width || 1400, S = W / vw, H = Math.round(vh * S);
  const body = designBody(d, S, null, opt.title, { x: b.minX - M + 8, y: top + 18 });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${b.minX - M} ${top} ${vw} ${vh}" font-family="Arial, Helvetica, sans-serif"><rect x="${b.minX - M}" y="${top}" width="${vw}" height="${vh}" fill="#ffffff"/>${body}</svg>`;
  return { svg, w: W, h: H };
}

/** The plan as a PNG picture. */
export async function designPng(d: Design, title?: string): Promise<Blob | null> {
  const { svg, w, h } = designSvg(d, { title, width: 1400 });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('picture failed')); img.src = url; });
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob | null>(res => c.toBlob(b => res(b), 'image/png'));
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

/** Cabinet takeoff rows: identical cabinets are counted together. */
export function takeoffRows(d: Design): Array<{ qty: number; code: string; desc: string; w: number; dp: number; h: number | ''; notes: string }> {
  const map = new Map<string, { qty: number; code: string; desc: string; w: number; dp: number; h: number | ''; notes: string[] }>();
  for (const it of d.items || []) {
    if (!isCab(it.kind)) continue;
    const desc = it.label || KINDS[it.kind].name;
    const code = (it.code || '') + (it.p?.lr && it.p?.hand ? ' ' + it.p.hand : '');
    const key = [code, desc, it.w, it.d, it.h ?? ''].join('|');
    const row = map.get(key) || { qty: 0, code, desc, w: it.w, dp: it.d, h: (it.h ?? '') as number | '', notes: [] };
    row.qty++; if (it.notes) row.notes.push(it.notes); map.set(key, row);
  }
  return [...map.values()].map(r => ({ ...r, notes: r.notes.join('; ') }));
}

/** Cabinet takeoff as CSV text (opens in Excel, LibreOffice, or anything else). Sizes in inches. */
export function takeoffCsv(d: Design, job?: { name?: string; customer?: string }): string | null {
  const rows = takeoffRows(d); if (!rows.length) return null;
  const q = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [['Qty', 'Code', 'Description', 'Width (in)', 'Depth (in)', 'Height (in)', 'Notes'].join(',')];
  rows.forEach(r => lines.push([r.qty, r.code, r.desc, r.w, r.dp, r.h, r.notes].map(q).join(',')));
  lines.push('', [`Job: ${[job?.customer, job?.name].filter(Boolean).join(' - ')}`].map(q).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** One takeoff for every page of the job, with a Page column. */
export function takeoffCsvAll(pages: Array<{ name: string; design: Design }>, job?: { name?: string; customer?: string }): string | null {
  const q = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [['Page', 'Qty', 'Code', 'Description', 'Width (in)', 'Depth (in)', 'Height (in)', 'Notes'].join(',')]; let n = 0;
  for (const pg of pages) for (const r of takeoffRows(pg.design)) { n++; lines.push([pg.name, r.qty, r.code, r.desc, r.w, r.dp, r.h, r.notes].map(q).join(',')); }
  if (!n) return null;
  lines.push('', [`Job: ${[job?.customer, job?.name].filter(Boolean).join(' - ')}`].map(q).join(','));
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}
