// Windows: what kind, what glass, how tall, and the checks that go with them (soffit, kitchen sill over the
// counter). Worked out from the saved design alone.
import { GLASS, KINDS, WTYPES, fmtIn, type DItem, type Design } from './model';

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
  }
  return out;
}

/** Plain-English lines shown in the window's panel. */
export function windowNotes(d: Design, w: DItem): string[] {
  const o = windowOf(d, w); const out: string[] = [];
  out.push(`Top of the window: ${fmtIn(o.sill + o.h)}.`);
  const so = soffitOver(d, w);
  if (so) out.push(`There is a soffit over this window; it comes down to ${fmtIn(so.under)}.${o.sill + o.h > so.under + 0.01 ? ' The window is too tall for it.' : ''}`);
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
