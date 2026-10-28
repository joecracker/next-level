// What a Design leaves the app as: a plan picture (PNG) and a cabinet takeoff (CSV).
// Both are built from the saved design alone, so they work from the Design Studio, from Capture's
// Save-to-Drive, or anywhere else, with the studio closed.
import { fmtIn, type Design, type DItem } from './model';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The plan as an SVG string. Also what the Design Studio screen draws. */
export function designSvg(d: Design, opt: { title?: string; width?: number } = {}): { svg: string; w: number; h: number } {
  const pts = d.pts || [];
  const all: { x: number; y: number }[] = [...pts];
  for (const it of d.items || []) { const r = Math.max(it.w, it.d) / 2; all.push({ x: it.x - r, y: it.y - r }, { x: it.x + r, y: it.y + r }); }
  if (!all.length) all.push({ x: 0, y: 0 }, { x: 96, y: 96 });
  const M = 40; // margin, inches
  const minX = Math.min(...all.map(p => p.x)) - M, maxX = Math.max(...all.map(p => p.x)) + M;
  const minY = Math.min(...all.map(p => p.y)) - M - (opt.title ? 18 : 0), maxY = Math.max(...all.map(p => p.y)) + M;
  const vw = maxX - minX, vh = maxY - minY;
  const W = opt.width || 1400, S = W / vw, H = Math.round(vh * S);
  const fs = Math.max(5, 11 / S); // ~11px text regardless of room size
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${minX} ${minY} ${vw} ${vh}" font-family="Arial, Helvetica, sans-serif">`);
  out.push(`<rect x="${minX}" y="${minY}" width="${vw}" height="${vh}" fill="#ffffff"/>`);
  if (opt.title) out.push(`<text x="${minX + 8}" y="${minY + fs * 1.6}" font-size="${fs * 1.5}" font-weight="700" fill="#14191A">${esc(opt.title)}</text>`);
  if (pts.length >= 3) {
    out.push(`<polygon points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" fill="#f4f1ea" stroke="#14191A" stroke-width="${3 / S}" stroke-linejoin="round"/>`);
    // wall lengths, placed outside the wall
    let cx = 0, cy = 0; pts.forEach(p => { cx += p.x; cy += p.y; }); cx /= pts.length; cy /= pts.length;
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length]; const len = Math.hypot(q.x - p.x, q.y - p.y); if (len < 1) return;
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2; let nx = -(q.y - p.y) / len, ny = (q.x - p.x) / len;
      if (nx * (mx - cx) + ny * (my - cy) < 0) { nx = -nx; ny = -ny; }
      out.push(`<text x="${mx + nx * fs * 1.6}" y="${my + ny * fs * 1.6 + fs * 0.35}" font-size="${fs}" text-anchor="middle" fill="#445">${fmtIn(len)}</text>`);
    });
  }
  for (const it of d.items || []) {
    const isCab = !!it.cab; const fill = isCab ? '#e9d8b8' : it.kind === 'door' || it.kind === 'window' ? '#ffffff' : '#dbe7e1';
    out.push(`<g transform="translate(${it.x} ${it.y}) rotate(${it.rot || 0})">` +
      `<rect x="${-it.w / 2}" y="${-it.d / 2}" width="${it.w}" height="${it.d}" fill="${fill}" stroke="#14191A" stroke-width="${1.5 / S}"/>` +
      `<text x="0" y="${fs * 0.35}" font-size="${fs}" text-anchor="middle" fill="#14191A">${esc(it.code || it.label || it.kind)}</text></g>`);
  }
  out.push('</svg>');
  return { svg: out.join(''), w: W, h: H };
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
  for (const it of (d.items || []) as DItem[]) {
    if (!it.cab) continue;
    const key = [it.code || '', it.label || it.kind, it.w, it.d, it.h ?? ''].join('|');
    const row = map.get(key) || { qty: 0, code: it.code || '', desc: it.label || it.kind, w: it.w, dp: it.d, h: (it.h ?? '') as number | '', notes: [] };
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
  lines.push('', [`Job: ${[job?.customer, job?.name].filter(Boolean).join(' - ')}`, ''].map(q).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
