// The installer sheet: a plain top view with only the cabinets (no countertops, floor tile, fixtures or colors), each one
// named, followed by the cabinet list that matches the takeoff. Printed and hung on the wall so the installer knows which
// cabinet goes where. Base and tall cabinets are drawn solid; wall cabinets get their own view, dashed.
import { KINDS, T, corners, fmtIn, frame, isCab, seg, type DItem, type Design } from './model';
import { designBounds, itemShape, takeoffRows } from './exports';
import { cornerPoly, cuOf } from './cornerunit';

const INK = '#14191a';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 2) + '..' : s);

/** What is written on a cabinet: its catalog code (with L or R), or its name when it has no code. */
function nameOf(it: DItem): string {
  if (it.kind === 'cornerunit') return 'CORNER UNIT';
  const code = (it.code || '') + (it.p?.lr && it.p?.hand ? ' ' + it.p.hand : '');
  return code || it.label || KINDS[it.kind]?.name || 'Cabinet';
}

/** One plan view: the room outline, doors, windows and inside walls for orientation, and only the cabinets of one level. */
function planBody(d: Design, S: number, set: 'floor' | 'hung'): string {
  const pts = d.pts || []; const fs = 12 / S; const out: string[] = [];
  if (pts.length >= 3) {
    const poly = pts.map(p => `${p.x},${p.y}`).join(' ');
    out.push(`<polygon points="${poly}" fill="none" stroke="#9a9d99" stroke-width="${T * 2}" stroke-linejoin="miter"/>`);
    out.push(`<polygon points="${poly}" fill="#ffffff" stroke="${INK}" stroke-width="${2 / S}" stroke-linejoin="miter"/>`);
  }
  for (const it of d.items || []) {
    if (!['door', 'window', 'partition', 'kneewall'].includes(it.kind)) continue;
    const f = frame(it, pts);
    out.push(`<g transform="translate(${f.cx} ${f.cy}) rotate(${f.rot})">${itemShape(it, S, false, fs)}</g>`);
  }
  for (const it of d.items || []) {
    const corner = it.kind === 'cornerunit';
    if (!isCab(it.kind) && !corner) continue;
    const hung = KINDS[it.kind]?.layer === 'hung';
    if (set === 'hung' ? !hung : hung) continue;
    const f = frame(it, pts); const c = corners(it, f);
    if (corner) {
      const poly = cornerPoly(cuOf(it)).map(q => q[0] + ',' + q[1]).join(' ');
      out.push(`<g transform="translate(${f.cx} ${f.cy}) rotate(${f.rot}) translate(${-it.w / 2} ${-it.d / 2})"><polygon points="${poly}" fill="#f4f4f0" stroke="${INK}" stroke-width="${2 / S}"/></g>`);
    } else {
      const dash = hung ? ` stroke-dasharray="${5 / S} ${3 / S}"` : '';
      out.push(`<polygon points="${c.map(q => q[0] + ',' + q[1]).join(' ')}" fill="${hung ? 'none' : '#f4f4f0'}" stroke="${INK}" stroke-width="${2 / S}"${dash}/>`);
    }
    // the name, centred on the cabinet and set along its longer side so it stays readable
    const xs = c.map(q => q[0]), ys = c.map(q => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const bw = x1 - x0, bh = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const label = nameOf(it); const horiz = bw >= bh; const long = horiz ? bw : bh;
    const size = Math.max(8 / S, Math.min(14 / S, (long - 1.5) / (label.length * 0.6)));
    const attrs = `font-size="${size}" font-weight="700" text-anchor="middle" fill="${INK}" stroke="#ffffff" stroke-width="${size * 0.22}" paint-order="stroke"`;
    out.push(horiz
      ? `<text x="${cx}" y="${cy + size * 0.35}" ${attrs}>${esc(label)}</text>`
      : `<text transform="translate(${cx} ${cy}) rotate(-90)" x="0" y="${size * 0.35}" ${attrs}>${esc(label)}</text>`);
  }
  if (pts.length >= 3) { // wall lengths, outside the wall
    pts.forEach((_p, i) => {
      const s = seg(pts, i); if (s.L < 1) return;
      const mx = (s.ax + s.bx) / 2 - s.nx * (T + fs * 1.3), my = (s.ay + s.by) / 2 - s.ny * (T + fs * 1.3);
      out.push(`<text x="${mx}" y="${my + fs * 0.35}" font-size="${fs}" text-anchor="middle" fill="#3b4440">${fmtIn(s.L)}</text>`);
    });
  }
  return out.join('');
}

/** The installer sheet as a stand-alone SVG string, or null when there are no cabinets yet. */
export function installerSvg(d: Design, opt: { title?: string; width?: number } = {}): { svg: string; w: number; h: number } | null {
  const cabs = (d.items || []).filter(it => isCab(it.kind) || it.kind === 'cornerunit');
  if (!cabs.length) return null;
  const b = designBounds(d); const M = 44;
  const vw = b.maxX - b.minX + 2 * M, vh = b.maxY - b.minY + 2 * M;
  const W = opt.width || 1400; const S = W / vw; const planH = Math.round(vh * S);
  const sections: Array<{ label: string; set: 'floor' | 'hung' }> = [{ label: 'Base and tall cabinets (top view)', set: 'floor' }];
  if (cabs.some(it => KINDS[it.kind]?.layer === 'hung')) sections.push({ label: 'Wall cabinets (top view, dashed)', set: 'hung' });
  const parts: string[] = [];
  parts.push(`<text x="20" y="34" font-size="26" font-weight="700" fill="${INK}">${esc(opt.title || 'Cabinet layout')} - installer sheet</text>`);
  let y = 50;
  for (const s of sections) {
    parts.push(`<text x="20" y="${y + 22}" font-size="18" font-weight="700" fill="${INK}">${esc(s.label)}</text>`);
    y += 30;
    parts.push(`<svg x="0" y="${y}" width="${W}" height="${planH}" viewBox="${b.minX - M} ${b.minY - M} ${vw} ${vh}">${planBody(d, S, s.set)}</svg>`);
    y += planH + 14;
  }
  // the cabinet list, the same rows as the takeoff
  const rows = takeoffRows(d);
  parts.push(`<text x="20" y="${y + 22}" font-size="18" font-weight="700" fill="${INK}">Cabinet list</text>`);
  y += 40;
  const col = { qty: 20, code: 80, desc: 330, size: 920, notes: 1130 };
  const head = (x: number, t: string) => `<text x="${x}" y="${y}" font-size="15" font-weight="700" fill="${INK}">${t}</text>`;
  parts.push(head(col.qty, 'Qty'), head(col.code, 'Code'), head(col.desc, 'Description'), head(col.size, 'Size (W x D x H)'), head(col.notes, 'Notes'));
  parts.push(`<line x1="20" y1="${y + 6}" x2="${W - 20}" y2="${y + 6}" stroke="${INK}" stroke-width="1.5"/>`);
  y += 28;
  for (const r of rows) {
    const size = `${fmtIn(r.w)} x ${fmtIn(r.dp)}` + (r.h !== '' ? ` x ${fmtIn(Number(r.h))}` : '');
    const cell = (x: number, t: string) => `<text x="${x}" y="${y}" font-size="15" fill="${INK}">${esc(t)}</text>`;
    parts.push(cell(col.qty, String(r.qty)), cell(col.code, cut(r.code, 30)), cell(col.desc, cut(r.desc, 70)), cell(col.size, cut(size, 26)), cell(col.notes, cut(r.notes, 30)));
    y += 26;
  }
  const H = y + 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif"><rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>${parts.join('')}</svg>`;
  return { svg, w: W, h: H };
}

/** The installer sheet as a PNG picture. */
export async function installerPng(d: Design, title?: string): Promise<Blob | null> {
  const r = installerSvg(d, { title, width: 1400 }); if (!r) return null;
  const url = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('picture failed')); img.src = url; });
    const c = document.createElement('canvas'); c.width = r.w; c.height = r.h;
    c.getContext('2d')!.drawImage(img, 0, 0, r.w, r.h);
    return await new Promise<Blob | null>(res => c.toBlob(b => res(b), 'image/png'));
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}
