// Windows: what kind, what glass, how tall, and the checks that go with them (soffit, tempered glass near a
// tub or shower, kitchen sill over the counter, bath ventilation). Worked out from the saved design alone.
import { GLASS, KINDS, WTYPES, corners, fmtIn, frame, type DItem, type Design } from './model';

type Chk = { id: string; itemId?: string; lvl: 'tight' | 'fix'; title: string; detail: string };

export function windowOf(d: Design, it: DItem): { type: string; glass: string; h: number; sill: number; open: number } {
  const type = it.p?.wtype || 'dh';
  const t = WTYPES.find(x => x.id === type);
  return { type, glass: it.p?.glass || 'clear', h: it.h || (d.mode === 'kitchen' ? 36 : 24), sill: it.sill ?? (d.mode === 'kitchen' ? 42 : 36), open: t ? t.open : 0.5 };
}
const typeName = (id: string) => WTYPES.find(x => x.id === id)?.name || 'Window';
const glassName = (id: string) => GLASS.find(x => x[0] === id)?.[1] || id;

/** Do two things on the same wall overlap along it? (t is the center, w the length along the wall.) */
function overlaps(a: DItem, b: DItem): boolean {
  return a.wall !== null && a.wall === b.wall && Math.abs(a.t - b.t) < (a.w + b.w) / 2 - 0.01;
}
const flatCeiling = (d: Design) => !d.vault || !d.vault.shape || d.vault.shape === 'flat';

/** The soffit (if any) over this window, and how high its underside is. */
function soffitOver(d: Design, w: DItem): { under: number } | null {
  if (!flatCeiling(d)) return null; // soffits in vaulted rooms are not worked out yet
  const ceil = d.ceiling || 96;
  for (const s of d.items) if (s.kind === 'soffit' && overlaps(w, s)) return { under: ceil - (s.p?.drop ?? 12) };
  return null;
}

function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay; const L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function distPoly(px: number, py: number, c: Array<[number, number]>): number {
  let m = 1e9;
  for (let i = 0; i < c.length; i++) { const q = c[(i + 1) % c.length]; m = Math.min(m, distSeg(px, py, c[i][0], c[i][1], q[0], q[1])); }
  return m;
}

/** Bath window glazing: total glass and the part that opens, square feet. */
function bathGlass(d: Design): { glass: number; open: number } {
  let glass = 0, open = 0;
  for (const w of d.items) {
    if (w.kind !== 'window') continue;
    const o = windowOf(d, w); if (o.type === 'block') continue;
    const a = (w.w * o.h) / 144; glass += a; open += a * o.open;
  }
  return { glass, open };
}
/** True when the bath windows alone meet the code ventilation rule (3 sq ft of glass, half of it openable). */
export function windowVents(d: Design): boolean {
  const g = bathGlass(d); return g.glass >= 3 && g.open >= 1.5;
}

export function windowChecks(d: Design): Chk[] {
  const out: Chk[] = [];
  for (const w of d.items) {
    if (w.kind !== 'window') continue;
    const o = windowOf(d, w); const top = o.sill + o.h; const nm = w.label || 'Window';
    const so = soffitOver(d, w);
    if (so && top > so.under + 0.01) out.push({ id: 'winsoffit:' + w.id, itemId: w.id, lvl: 'fix', title: nm + ' runs up into the soffit', detail: `Top of the window is ${fmtIn(top)} and the soffit comes down to ${fmtIn(so.under)}. Shorten the window by ${fmtIn(top - so.under)}, lower the sill, or change the soffit.` });
    if (d.mode === 'kitchen') {
      const cab = d.items.find(c => c.wall !== null && KINDS[c.kind]?.layer === 'floor' && KINDS[c.kind].cab && (c.h || 34.5) <= 40 && overlaps(w, c));
      if (cab && o.sill < 40) out.push({ id: 'winsill:' + w.id, itemId: w.id, lvl: o.sill < 36 ? 'fix' : 'tight', title: nm + ' sill is low over the counter', detail: `Sill is ${fmtIn(o.sill)}. A 36" counter with a 4" splash wants about 40" (42" is common).` });
    }
    if (d.mode === 'bath' && o.glass !== 'tempered' && o.type !== 'block' && o.sill < 60) {
      const f = frame(w, d.pts); const pts: Array<[number, number]> = [[f.cx, f.cy], [f.cx + f.ux * w.w / 2, f.cy + f.uy * w.w / 2], [f.cx - f.ux * w.w / 2, f.cy - f.uy * w.w / 2]];
      let best = 1e9, what = '';
      for (const c of d.items) {
        if (c.kind !== 'shower' && c.kind !== 'tub' && c.kind !== 'ftub') continue;
        const cs = corners(c, frame(c, d.pts));
        for (const p of pts) { const dd = distPoly(p[0], p[1], cs); if (dd < best) { best = dd; what = c.kind === 'shower' ? 'shower' : 'tub'; } }
      }
      if (best <= 60) out.push({ id: 'wintemp:' + w.id, itemId: w.id, lvl: 'fix', title: nm + ' is close to the ' + what + ' - use tempered glass', detail: `The bottom of the glass is ${fmtIn(o.sill)} off the floor and about ${fmtIn(Math.round(best))} from the ${what}. Code usually wants safety (tempered) glass within 60"; check the edition your town uses.` });
    }
  }
  return out;
}

/** Plain-English lines shown in the window's panel. */
export function windowNotes(d: Design, w: DItem): string[] {
  const o = windowOf(d, w); const out: string[] = [];
  out.push(`Top of the window: ${fmtIn(o.sill + o.h)}.`);
  const so = soffitOver(d, w);
  if (so) out.push(`There is a soffit over this window; it comes down to ${fmtIn(so.under)}.${o.sill + o.h > so.under + 0.01 ? ' The window is too tall for it.' : ''}`);
  if (d.mode === 'bath') {
    const g = bathGlass(d);
    out.push(`Bath windows together: ${(Math.round(g.glass * 10) / 10)} sq ft of glass, ${(Math.round(g.open * 10) / 10)} sq ft opens. Code wants 3 and 1.5 if there is no fan.`);
  }
  return out;
}

/** Takeoff lines: one per kind, size and glass. */
export function windowLines(d: Design): Array<{ desc: string; qty: number; note: string }> {
  const map = new Map<string, { desc: string; qty: number; note: string }>();
  for (const w of d.items) {
    if (w.kind !== 'window') continue;
    const o = windowOf(d, w);
    const desc = `Window - ${typeName(o.type)}, ${fmtIn(w.w)} wide x ${fmtIn(o.h)} high, ${glassName(o.glass).toLowerCase()} glass`;
    const note = `sill ${fmtIn(o.sill)}`;
    const k = desc + '|' + note; const r = map.get(k);
    if (r) r.qty++; else map.set(k, { desc, qty: 1, note });
  }
  return [...map.values()];
}
