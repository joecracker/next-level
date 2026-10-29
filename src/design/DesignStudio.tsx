// Design Studio: draw the room, place and size things with live numbers, then save a plan picture and a
// cabinet takeoff to the job. The drawing is stored on the job (project.design) and travels with it.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPE } from 'react';
import JobPanel from './JobPanel';
import { runChecks } from './checks';
import { MAKERS, catalogFor, readyCatalogs, familiesFor, groupsFor, kindForEntry, matches, type CabEntry } from './catalog';
import { designBody, designBounds, itemShape, takeoffRows } from './exports';
import {
  CATS, KINDS, addList, type AddEntry, catLabel, T, clampT, fmtIn, frame, gaps, hasDesign, hitItem, isCab, mkItem, nearestWall, normalize, parseIn, seg, snapTo, template,
  type Cat, type DItem, type Design, type Pt,
} from './model';

type Sel = { type: 'item'; id: string } | { type: 'wall'; i: number } | { type: 'corner'; i: number } | null;
type View = { cx: number; cy: number; s: number };

const SNAP = 0.5;          // inches a dragged thing snaps to
const LAYER_ORDER = ['inwall', 'floor', 'hung', 'ceiling'];

// ---------- small look-and-feel helpers ----------
const btn: CSSProperties = { minHeight: '44px', minWidth: '44px', padding: '0 14px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '15px', border: '1px solid rgba(238,241,238,0.25)', background: 'rgba(238,241,238,0.06)', color: 'var(--cream)' };
const zbtn: CSSProperties = { ...btn, background: '#1d2425', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' };
const btnOn: CSSProperties = { ...btn, background: 'var(--ember)', color: 'var(--ink)', border: 'none' };
const lbl: CSSProperties = { fontSize: '11px', fontWeight: 800, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: '3px' };
const input: CSSProperties = { width: '100%', boxSizing: 'border-box', minHeight: '44px', padding: '0 10px', borderRadius: '8px', border: '1px solid rgba(238,241,238,0.25)', background: 'rgba(0,0,0,0.25)', color: 'var(--cream)', fontSize: '17px' };

/** A number box that takes feet, inches and fractions: 24, 24 1/2, 3/4, 7' 10 1/2 */
function Num({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [txt, setTxt] = useState(fmtIn(value)); const [edit, setEdit] = useState(false);
  useEffect(() => { if (!edit) setTxt(fmtIn(value)); }, [value, edit]);
  const done = () => { setEdit(false); const v = parseIn(txt); if (isNaN(v)) setTxt(fmtIn(value)); else if (Math.abs(v - value) > 0.001) onCommit(v); else setTxt(fmtIn(value)); };
  return (
    <label style={{ display: 'block', minWidth: 0 }}>
      <div style={lbl}>{label}</div>
      <input value={txt} onFocus={e => { setEdit(true); e.target.select(); }} onChange={e => setTxt(e.target.value)} onBlur={done}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} inputMode="text" style={input} />
    </label>
  );
}
function Text({ label, value, onCommit, placeholder }: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string }) {
  return (
    <label style={{ display: 'block', minWidth: 0 }}>
      <div style={lbl}>{label}</div>
      <input key={value} defaultValue={value} placeholder={placeholder} onBlur={e => { if (e.target.value !== value) onCommit(e.target.value); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} style={input} />
    </label>
  );
}

// ---------- editing the room ----------
function Thumb({ e, size = 56 }: { e: { kind: string; w: number; d: number; p?: Record<string, any>; extra?: Partial<DItem> }; size?: number }) {
  const it = mkItem(e.kind, { w: e.w, d: e.d, p: { ...(mkItem(e.kind).p || {}), ...(e.p || {}) }, ...(e.extra || {}) });
  const S = size / Math.max(e.w, e.d, 24) * 0.8; const m = Math.max(e.w, e.d, 24) * (e.kind === 'door' ? 1.9 : 1.35); const cy = it.kind === 'door' ? e.w * 0.4 : 0;
  return <svg width={size} height={size} viewBox={`${-m / 2} ${-m / 2 + cy} ${m} ${m}`} style={{ background: '#fff', borderRadius: '8px', flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: itemShape(it, S, false, 10 / S).replace(/<text[\s\S]*?<\/text>/g, '') }} />;
}
function Sec({ title, open, children }: { title: string; open?: boolean; children: any }) {
  const [o, setO] = useState(!!open);
  return (<div style={{ borderTop: '1px solid rgba(238,241,238,0.12)', paddingTop: '8px' }}>
    <button onClick={() => setO(!o)} style={{ ...btn, width: '100%', textAlign: 'left', minHeight: '40px', background: 'transparent', border: 'none', padding: '0 2px', display: 'flex', justifyContent: 'space-between' }}><span style={{ ...lbl, marginBottom: 0 }}>{title}</span><span>{o ? '▾' : '▸'}</span></button>
    {o && <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>{children}</div>}
  </div>);
}
function Chips({ label, value, opts, onPick }: { label: string; value: any; opts: Array<[any, string]>; onPick: (v: any) => void }) {
  return (<div><div style={lbl}>{label}</div><div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
    {opts.map(([v, t]) => <button key={String(v)} style={value === v ? btnOn : btn} onClick={() => onPick(v)}>{t}</button>)}</div></div>);
}
const clonePts = (p: Pt[]) => p.map(q => ({ x: q.x, y: q.y }));
function splitWall(d: Design, i: number): Design {
  const s = seg(d.pts, i); const mid = s.L / 2; const pts = clonePts(d.pts);
  pts.splice(i + 1, 0, { x: s.ax + s.ux * mid, y: s.ay + s.uy * mid });
  const items = d.items.map(it => {
    if (it.wall === null) return it;
    if (it.wall === i) return it.t <= mid ? it : { ...it, wall: i + 1, t: it.t - mid };
    if (it.wall > i) return { ...it, wall: it.wall + 1 };
    return it;
  });
  return normalize({ ...d, pts, items });
}
function removeCorner(d: Design, j: number): Design {
  const n = d.pts.length; if (n <= 3) return d;
  const prev = (j - 1 + n) % n; const Lprev = seg(d.pts, prev).L;
  const prevNew = prev > j ? prev - 1 : prev;
  const pts = clonePts(d.pts); pts.splice(j, 1);
  const items = d.items.map(it => {
    if (it.wall === null) return it;
    if (it.wall === prev) return { ...it, wall: prevNew };
    if (it.wall === j) return { ...it, wall: prevNew, t: it.t + Lprev };
    return it.wall > j ? { ...it, wall: it.wall - 1 } : it;
  });
  return normalize({ ...d, pts, items });
}
function setLen(d: Design, i: number, L: number): Design {
  const s = seg(d.pts, i); const j = (i + 1) % d.pts.length; const pts = clonePts(d.pts);
  pts[j] = { x: s.ax + s.ux * L, y: s.ay + s.uy * L };
  return normalize({ ...d, pts });
}
function cornerAngle(d: Design, i: number): number {
  const n = d.pts.length; const g = seg(d.pts, i), p = seg(d.pts, (i - 1 + n) % n);
  let turn = (Math.atan2(g.uy, g.ux) - Math.atan2(p.uy, p.ux)) * 180 / Math.PI;
  while (turn > 180) turn -= 360; while (turn <= -180) turn += 360;
  return 180 - turn;
}
const patchItem = (d: Design, id: string, p: Partial<DItem>): Design => ({ ...d, items: d.items.map(it => it.id === id ? { ...it, ...p } : it) });

export default function DesignStudio({ jobName, onHome, onCapture }: { jobName: string; onHome: () => void; onCapture: () => void }) {
  const NL = window.NextLevel;
  const [design, setDesignState] = useState<Design | null>(() => { const d = NL?.getDesign(); return hasDesign(d) ? (d as Design) : null; });
  const designRef = useRef(design); designRef.current = design;
  const [sel, setSel] = useState<Sel>(null);
  const [view, setView] = useState<View | null>(null);
  const viewRef = useRef(view); viewRef.current = view;
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [nudge, setNudge] = useState(0.25);
  const [addOpen, setAddOpen] = useState(false);
  const [addGroup, setAddGroup] = useState<Cat>('Walls');
  const [saveOpen, setSaveOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [armed, setArmed] = useState(false);
  const [search, setSearch] = useState('');
  const [cabMaker, setCabMaker] = useState('Homecrest');
  const [cabLine, setCabLine] = useState('Select');
  const [cabGroup, setCabGroup] = useState('Base cabinets');
  const [cabFam, setCabFam] = useState('');
  const [tab, setTab] = useState<'edit' | 'check' | 'list'>('edit');
  const [pageMenu, setPageMenu] = useState(false);
  const [pageModal, setPageModal] = useState<null | { mode: 'new' | 'rename'; name: string }>(null);
  const [delArmed, setDelArmed] = useState(false);
  const [, bump] = useState(0);
  const justAdded = useRef<string | null>(null); // a new item's first drag is part of placing it, not a separate undo step
  const hist = useRef<Design[]>([]); const fut = useRef<Design[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null); const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<any>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (m: string) => { setMsg(m); if (msgTimer.current) clearTimeout(msgTimer.current); msgTimer.current = setTimeout(() => setMsg(''), 3500); };

  // ----- saving to the job, undo / redo -----
  const persist = (d: Design) => { try { NL?.setDesign(d); } catch { /* ignore */ } };
  const commit = (next: Design) => {
    justAdded.current = null;
    const cur = designRef.current; if (cur) { hist.current.push(cur); if (hist.current.length > 80) hist.current.shift(); }
    fut.current = []; designRef.current = next; setDesignState(next); persist(next); bump(x => x + 1);
  };
  const live = (next: Design) => { designRef.current = next; setDesignState(next); };
  const undo = () => { const p = hist.current.pop(); const cur = designRef.current; if (!p || !cur) return; fut.current.push(cur); designRef.current = p; setDesignState(p); persist(p); setSel(null); bump(x => x + 1); };
  const redo = () => { const n = fut.current.pop(); const cur = designRef.current; if (!n || !cur) return; hist.current.push(cur); designRef.current = n; setDesignState(n); persist(n); setSel(null); bump(x => x + 1); };

  // ----- size and view -----
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 }));
    ro.observe(el); setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 });
    return () => ro.disconnect();
  }, []);
  const fitView = useCallback((d: Design | null = designRef.current) => {
    if (!d) return; const b = designBounds(d); const M = 40;
    const bw = b.maxX - b.minX + 2 * M, bh = b.maxY - b.minY + 2 * M;
    setView({ cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, s: Math.max(0.2, Math.min(size.w / bw, size.h / bh)) });
  }, [size.w, size.h]);
  useEffect(() => { if (design && !view && size.w > 50) fitView(design); }, [design, view, size.w, size.h, fitView]);

  const toDesign = (cx: number, cy: number): Pt => {
    const v = viewRef.current!; const r = svgRef.current!.getBoundingClientRect();
    return { x: v.cx + (cx - r.left - r.width / 2) / v.s, y: v.cy + (cy - r.top - r.height / 2) / v.s };
  };
  const zoomBy = (f: number) => setView(v => v && ({ ...v, s: Math.max(0.15, Math.min(12, v.s * f)) }));
  useEffect(() => { // wheel zoom around the pointer
    const el = svgRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); const v = viewRef.current; if (!v) return;
      const f = Math.exp(-e.deltaY * 0.0015); const s = Math.max(0.15, Math.min(12, v.s * f));
      const r = el.getBoundingClientRect(); const px = e.clientX - r.left - r.width / 2, py = e.clientY - r.top - r.height / 2;
      setView({ s, cx: v.cx + px / v.s - px / s, cy: v.cy + py / v.s - py / s });
    };
    el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel);
  });
  useEffect(() => { // keyboard: delete, undo, redo
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement; if (t && /INPUT|TEXTAREA/.test(t.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel?.type === 'item') { e.preventDefault(); delItem(sel.id); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  // ----- pointer: select, drag things, drag walls and corners, pan, pinch -----
  const hitTest = (P: Pt): Sel => {
    const d = designRef.current!; const v = viewRef.current!; const px = 1 / v.s;
    for (let i = 0; i < d.pts.length; i++) if (Math.hypot(P.x - d.pts[i].x, P.y - d.pts[i].y) < 14 * px) return { type: 'corner', i };
    const items = d.items.slice().sort((a, b) => LAYER_ORDER.indexOf(KINDS[b.kind].layer) - LAYER_ORDER.indexOf(KINDS[a.kind].layer));
    for (const it of items) if (hitItem(it, d.pts, P.x, P.y, 6 * px)) return { type: 'item', id: it.id };
    let best: { i: number; dist: number } | null = null;
    for (let i = 0; i < d.pts.length; i++) {
      const s = seg(d.pts, i); const dx = P.x - s.ax, dy = P.y - s.ay;
      const t = Math.max(0, Math.min(s.L, dx * s.ux + dy * s.uy));
      const dist = Math.hypot(P.x - (s.ax + s.ux * t), P.y - (s.ay + s.uy * t));
      // the wall band sits outside the room edge
      const outsideDist = Math.min(dist, Math.abs(dx * s.nx + dy * s.ny + T / 2) < T / 2 + 4 * px && t > 0 && t < s.L ? 0 : Infinity);
      if (Math.min(dist, outsideDist) < Math.max(12 * px, 0) && (!best || dist < best.dist)) best = { i, dist };
    }
    return best ? { type: 'wall', i: best.i } : null;
  };

  const onDown = (e: RPE<SVGSVGElement>) => {
    if (!designRef.current || !viewRef.current) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* fine */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) { // second finger: pinch / two-finger pan
      if (gesture.current?.start) live(gesture.current.start);
      const [a, b] = [...pointers.current.values()]; const v = viewRef.current;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture.current = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, v0: v, D0: toDesign(mid.x, mid.y) };
      return;
    }
    const P = toDesign(e.clientX, e.clientY); const hit = hitTest(P); const d = designRef.current;
    if (hit?.type === 'item') {
      setSel(hit); const it = d.items.find(q => q.id === hit.id)!; const f = frame(it, d.pts);
      const riders = it.wall !== null && KINDS[it.kind].layer === 'floor'
        ? d.items.filter(q => q.id !== it.id && q.wall === it.wall && KINDS[q.kind].layer === 'hung' && Math.abs(q.t - it.t) <= it.w / 2 + 0.01).map(q => ({ id: q.id, off: q.t - it.t })) : [];
      gesture.current = { kind: 'item', id: it.id, start: d, off: { x: f.cx - P.x, y: f.cy - P.y }, riders, rot0: f.rot, sx: e.clientX, sy: e.clientY, moved: false };
    } else if (hit?.type === 'corner') {
      setSel(hit); gesture.current = { kind: 'corner', i: hit.i, start: d, sx: e.clientX, sy: e.clientY, moved: false };
    } else if (hit?.type === 'wall') {
      setSel(hit); gesture.current = { kind: 'wall', i: hit.i, start: d, P0: P, sx: e.clientX, sy: e.clientY, moved: false };
    } else {
      setSel(null); gesture.current = { kind: 'pan', v0: viewRef.current, sx: e.clientX, sy: e.clientY };
    }
  };

  const onMove = (e: RPE<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return; pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current; if (!g || !viewRef.current) return;
    if (g.kind === 'pinch') {
      if (pointers.current.size < 2) return; const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; const r = svgRef.current!.getBoundingClientRect();
      const s = Math.max(0.15, Math.min(12, g.v0.s * (Math.hypot(a.x - b.x, a.y - b.y) / g.d0)));
      setView({ s, cx: g.D0.x - (mid.x - r.left - r.width / 2) / s, cy: g.D0.y - (mid.y - r.top - r.height / 2) / s }); return;
    }
    if (g.kind === 'pan') { const v = g.v0; setView({ s: v.s, cx: v.cx - (e.clientX - g.sx) / v.s, cy: v.cy - (e.clientY - g.sy) / v.s }); return; }
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 5) return; g.moved = true;
    const P = toDesign(e.clientX, e.clientY); const d0: Design = g.start;
    if (g.kind === 'item') {
      const it0 = d0.items.find(q => q.id === g.id)!; const k = KINDS[it0.kind];
      const C = { x: P.x + g.off.x, y: P.y + g.off.y }; const q = nearestWall(d0.pts, C.x, C.y);
      const attach = k.layer === 'inwall' || k.layer === 'hung' || (k.snap && q.dist < it0.d / 2 + 12);
      let patch: Partial<DItem>; let riders = g.riders as Array<{ id: string; off: number }>;
      if (attach) { const t = snapTo(clampT(it0, q.L, q.t), SNAP); patch = { wall: q.i, t, ...(it0.wall !== q.i ? { rot: 0 } : {}) }; if (it0.wall !== q.i) riders = []; }
      else patch = { wall: null, x: snapTo(C.x, SNAP), y: snapTo(C.y, SNAP), rot: it0.wall !== null ? Math.round(g.rot0) : it0.rot };
      let next = patchItem(d0, it0.id, patch);
      if (riders.length && patch.wall === it0.wall) { const nt = patch.t as number; next = { ...next, items: next.items.map(o => { const r = riders.find(z => z.id === o.id); return r ? { ...o, t: clampT(o, seg(d0.pts, it0.wall!).L, nt + r.off) } : o; }) }; }
      live(next);
    } else if (g.kind === 'wall') {
      const s = seg(d0.pts, g.i); const delta = snapTo((P.x - g.P0.x) * s.nx + (P.y - g.P0.y) * s.ny, SNAP);
      const pts = clonePts(d0.pts); const j = (g.i + 1) % pts.length;
      pts[g.i] = { x: pts[g.i].x + s.nx * delta, y: pts[g.i].y + s.ny * delta }; pts[j] = { x: pts[j].x + s.nx * delta, y: pts[j].y + s.ny * delta };
      live(normalize({ ...d0, pts }));
    } else if (g.kind === 'corner') {
      const n = d0.pts.length; const last = d0.pts[(g.i - 1 + n) % n];
      const vx = P.x - last.x, vy = P.y - last.y; const ang = Math.atan2(vy, vx); const sn = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
      const L2 = snapTo(Math.hypot(vx, vy), SNAP); const pts = clonePts(d0.pts);
      pts[g.i] = { x: last.x + Math.cos(sn) * L2, y: last.y + Math.sin(sn) * L2 };
      live(normalize({ ...d0, pts }));
    }
  };

  const onUp = (e: RPE<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId); const g = gesture.current;
    if (pointers.current.size === 0) gesture.current = null; else if (g?.kind === 'pinch') { gesture.current = null; }
    if (g && g.start && g.moved && designRef.current && designRef.current !== g.start) {
      if (g.kind === 'item' && justAdded.current === g.id) justAdded.current = null; else { hist.current.push(g.start); if (hist.current.length > 80) hist.current.shift(); }
      fut.current = []; persist(designRef.current); bump(x => x + 1);
    }
  };

  // ----- edits from the side panel -----
  const d = design;
  const selItem = d && sel?.type === 'item' ? d.items.find(q => q.id === sel.id) || null : null;
  const upd = (id: string, p: Partial<DItem>) => d && commit(patchItem(d, id, p));
  const delItem = (id: string) => { const cur = designRef.current; if (!cur) return; commit({ ...cur, items: cur.items.filter(q => q.id !== id) }); setSel(null); };
  const dupItem = (it: DItem) => { if (!d) return; const c: DItem = { ...it, id: mkItem(it.kind).id, ...(it.wall !== null ? { t: it.t + it.w } : { x: it.x + 12, y: it.y + 12 }) }; commit(normalize({ ...d, items: [...d.items, c] })); setSel({ type: 'item', id: c.id }); };
  const addCab = (e: CabEntry) => {
    if (!d) return;
    const kind = kindForEntry(e); const k = KINDS[kind]; const b = designBounds(d);
    const over: Partial<DItem> = k.layer === 'hung' ? { wall: 0, t: Math.max(e.w / 2, Math.min(seg(d.pts, 0).L - e.w / 2, seg(d.pts, 0).L / 2)) } : k.snap ? { wall: 0, t: Math.max(e.w / 2, Math.min(seg(d.pts, 0).L - e.w / 2, seg(d.pts, 0).L / 2)) } : { x: Math.round((b.minX + b.maxX) / 2), y: Math.round((b.minY + b.maxY) / 2) };
    const it = mkItem(kind, { w: e.w, d: e.d, ...(e.h ? { h: e.h } : {}), code: e.code, label: `${e.maker}${e.line ? ' ' + e.line : ''} ${e.family}`, p: { maker: e.maker, ...(e.line ? { line: e.line } : {}), family: e.family, ...(e.lr ? { lr: true, hand: 'L' } : {}) }, ...over });
    commit(normalize({ ...d, items: [...d.items, it] })); justAdded.current = it.id; setSel({ type: 'item', id: it.id }); setTab('edit'); setAddOpen(false);
  };
  const addItem = (e: AddEntry) => {
    if (!d) return;
    if (e.applyTo === 'shower') {
      const target = (selItem && selItem.kind === 'shower' ? selItem : null) || d.items.filter(q => q.kind === 'shower').slice(-1)[0];
      if (!target) { say('Add a shower first, then pick its door'); return; }
      commit(patchItem(d, target.id, { p: { ...(target.p || {}), ...(e.p || {}) } })); setSel({ type: 'item', id: target.id }); setAddOpen(false); return;
    }
    const b = designBounds(d); const kind = e.kind; const k = KINDS[kind];
    const over: Partial<DItem> = k.layer === 'inwall' || k.layer === 'hung' || (k.layer === 'floor' && k.snap) ? { wall: 0, t: Math.max(e.w / 2, Math.min(seg(d.pts, 0).L - e.w / 2, seg(d.pts, 0).L / 2)) } : { x: Math.round((b.minX + b.maxX) / 2), y: Math.round((b.minY + b.maxY) / 2) };
    const base0 = mkItem(kind);
    const it = mkItem(kind, { w: e.w, d: e.d, p: base0.p ? { ...base0.p, ...(e.p || {}) } : undefined, ...over, ...(e.extra || {}) });
    commit(normalize({ ...d, items: [...d.items, it] })); justAdded.current = it.id; setSel({ type: 'item', id: it.id }); setTab('edit'); setAddOpen(false);
  };
  const nudgeBy = (it: DItem, dir: number, axis: 'x' | 'y' | 't') => {
    if (!d) return;
    if (it.wall !== null && axis === 't') { const L = seg(d.pts, it.wall).L; const nt = clampT(it, L, it.t + dir * nudge); const dt = nt - it.t;
      const riders = KINDS[it.kind].layer === 'floor' ? d.items.filter(q => q.id !== it.id && q.wall === it.wall && KINDS[q.kind].layer === 'hung' && Math.abs(q.t - it.t) <= it.w / 2 + 0.01) : [];
      commit({ ...d, items: d.items.map(q => q.id === it.id ? { ...q, t: nt } : riders.includes(q) ? { ...q, t: clampT(q, L, q.t + dt) } : q) }); }
    else if (it.wall === null) upd(it.id, axis === 'y' ? { y: it.y + dir * nudge } : { x: it.x + dir * nudge });
  };
  const start = (mode: 'bath' | 'kitchen') => { const t = template(mode); hist.current = []; fut.current = []; designRef.current = t; setDesignState(t); persist(t); setSel(null); setView(null); };

  // ----- pages: one job, many drawings (Master bath, Kitchen, Before, After...) -----
  const pagesInfo = NL?.getPages?.() || { pages: [], cur: null };
  const curPageName = pagesInfo.pages.find(x => x.id === pagesInfo.cur)?.name || '';
  const loadPage = () => { const x = NL?.getDesign(); const nd = hasDesign(x) ? (x as Design) : null; hist.current = []; fut.current = []; designRef.current = nd; setDesignState(nd); setSel(null); setView(null); setPageMenu(false); setDelArmed(false); bump(n => n + 1); };
  const goPage = (id: string) => { if (id === pagesInfo.cur) { setPageMenu(m => !m); setDelArmed(false); return; } NL?.openPage(id); loadPage(); };
  const makePage = (how: 'bath' | 'kitchen' | 'copy') => {
    if (!pageModal || !NL) return; const cur = designRef.current;
    const dflt = how === 'copy' ? `${curPageName || 'Page'} copy` : how === 'kitchen' ? 'Kitchen' : 'Bathroom';
    const nd: Design = how === 'copy' && cur ? JSON.parse(JSON.stringify(cur)) : template(how === 'kitchen' ? 'kitchen' : 'bath');
    NL.addPage(pageModal.name.trim() || dflt, nd); setPageModal(null); loadPage();
  };
  const renameNow = () => { if (!pageModal || !pagesInfo.cur) return; NL?.renamePage(pagesInfo.cur, pageModal.name); setPageModal(null); bump(n => n + 1); };
  const deleteNow = () => { if (!pagesInfo.cur) return; if (!delArmed) { setDelArmed(true); setTimeout(() => setDelArmed(false), 3500); return; } NL?.deletePage(pagesInfo.cur); loadPage(); };

  // ----- saving out: picture, takeoff, Drive -----
  const deliver = async (file: File) => {
    const nav = navigator as any;
    if (nav.canShare && nav.canShare({ files: [file] })) { try { await nav.share({ files: [file], title: file.name }); return; } catch (err: any) { if (err?.name === 'AbortError') return; } }
    const url = URL.createObjectURL(file); const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 4000);
    say(`${file.name} downloaded`);
  };
  const slug = (t: string) => (t || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
  const base = [slug(jobName || 'Job') || 'Job', slug(curPageName)].filter(Boolean).join('-');
  const savePicture = async () => { setSaveOpen(false); const b = await NL?.designPicture(); if (!b) { say('Draw something first'); return; } await deliver(new File([b], `${base}-Design-Plan.png`, { type: 'image/png' })); };
  const saveTakeoff = async () => { setSaveOpen(false); const t = NL?.designTakeoff(); if (!t) { say('No cabinets in the drawing yet'); return; } await deliver(new File([t.csv], `${base}-Cabinet-Takeoff.csv`, { type: 'text/csv' })); };
  const saveTakeoffAll = async () => { setSaveOpen(false); const t = NL?.designTakeoff(true); if (!t) { say('No cabinets in any page yet'); return; } await deliver(new File([t.csv], `${slug(jobName || 'Job') || 'Job'}-All-Pages-Takeoff.csv`, { type: 'text/csv' })); };
  const saveDrive = async () => {
    setSaveOpen(false); const st = NL?.driveState(); if (!st?.configured) { say('Google Drive is not set up in this copy of the app'); return; }
    try { if (!st.connected) await NL?.driveConnect(); say('Saving to the job folder…'); await NL?.saveJobToDrive(); say('Saved to the job folder in Google Drive'); } catch (err: any) { say(err?.message ? `Drive: ${err.message}` : 'Could not save to Drive'); }
  };

  // ---------- drawing ----------
  const rows = d ? takeoffRows(d) : [];
  const checks = d ? runChecks(d) : [];
  const flags: Record<string, 'fix' | 'tight'> = {}; checks.forEach(c => { if (c.itemId && flags[c.itemId] !== 'fix') flags[c.itemId] = c.lvl; });
  const v = view;
  const body = d && v ? designBody(d, v.s, sel?.type === 'item' ? sel.id : null, undefined, undefined, flags) : '';
  const vbW = v ? size.w / v.s : 1, vbH = v ? size.h / v.s : 1;
  const px = v ? 1 / v.s : 1;
  const wide = typeof window !== 'undefined' && window.innerWidth >= 1000;

  // ---------- the side panel ----------
  const keepIt = (c: { id: string }) => d && commit({ ...d, accepted: { ...(d.accepted || {}), [c.id]: true } });
  const checkPanel = d && (
    <div style={{ padding: '12px 14px 90px', display: 'flex', flexDirection: 'column', gap: '10px', color: 'var(--cream)' }}>
      {checks.length === 0 ? <div style={{ fontWeight: 700 }}>All clear. Nothing the robot would flag.</div> : checks.map(c => (
        <div key={c.id} style={{ border: `1px solid ${c.lvl === 'fix' ? '#d9482b' : '#d9a441'}`, borderRadius: '10px', padding: '10px' }}>
          <div style={{ fontWeight: 800, color: c.lvl === 'fix' ? '#fca5a5' : '#f5d58a' }}>{c.lvl === 'fix' ? 'Fix: ' : 'Tight: '}{c.title}</div>
          <div style={{ fontSize: '14px', margin: '4px 0 8px' }}>{c.detail}</div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {c.itemId && <button style={btn} onClick={() => { setSel({ type: 'item', id: c.itemId! }); setTab('edit'); }}>Show me</button>}
            <button style={btn} onClick={() => keepIt(c)}>Keep it anyway</button>
          </div>
        </div>))}
      {d.accepted && Object.keys(d.accepted).length > 0 && <button style={btn} onClick={() => commit({ ...d, accepted: {} })}>Bring back the ones I kept</button>}
    </div>
  );
  const listPanel = d && (
    <div style={{ padding: '12px 14px 90px', display: 'flex', flexDirection: 'column', gap: '6px', color: 'var(--cream)' }}>
      <div style={lbl}>Everything in the drawing</div>
      {d.items.length === 0 ? <div style={{ color: 'var(--muted)' }}>Nothing yet.</div> : d.items.map(it => (
        <button key={it.id} style={{ ...btn, textAlign: 'left', minHeight: '40px' }} onClick={() => { setSel({ type: 'item', id: it.id }); setTab('edit'); }}>{it.label || KINDS[it.kind].name} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>{fmtIn(it.w)} × {fmtIn(it.d)}</span></button>))}
      <div style={{ ...lbl, marginTop: '10px' }}>Cabinet takeoff</div>
      {rows.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: '14px' }}>No cabinets yet.</div> : rows.map((r, i) => (
        <div key={i} style={{ fontSize: '14px' }}><b>{r.qty} ×</b> {r.code ? `${r.code} · ` : ''}{r.desc} <span style={{ color: 'var(--muted)' }}>{fmtIn(r.w)} × {fmtIn(r.dp)}</span></div>))}
    </div>
  );
  const editPanel = d && (
    <div style={{ padding: '12px 14px 90px', display: 'flex', flexDirection: 'column', gap: '12px', color: 'var(--cream)' }}>
      {selItem ? (() => {
        const it = selItem; const k = KINDS[it.kind]; const g = gaps(it, d);
        return (<>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Thumb e={{ kind: it.kind, w: it.w, d: it.d, p: it.p, extra: { hinge: it.hinge, swing: it.swing } }} size={48} />
            <div style={{ flex: 1, fontWeight: 800, fontSize: '18px' }}>{k.name}{it.kind === 'door' ? ` · ${({ swing: 'swinging', double: 'double', pocket: 'pocket', barn: 'barn', bifold: 'bi-fold', opening: 'opening' } as Record<string, string>)[it.p?.type || 'swing']}` : ''}</div>
            <button style={btn} onClick={() => dupItem(it)}>Copy</button>
            <button style={{ ...btn, color: '#fca5a5' }} onClick={() => delItem(it.id)}>Delete</button>
          </div>
          <Sec title="Size & position" open>
          {it.p?.maker && <div style={{ fontSize: '14px' }}><b>{it.code}</b> · {it.p.maker}{it.p.line ? ' ' + it.p.line : ''} · {it.p.family}</div>}
          {it.p?.lr && <Chips label="Hinge hand (order as)" value={it.p.hand || 'L'} opts={[['L', 'Left'], ['R', 'Right']]} onPick={v => upd(it.id, { p: { ...(it.p || {}), hand: v } })} />}
          <Text label={isCab(it.kind) ? 'Name on the order' : 'Label on the drawing'} value={it.label || ''} placeholder={k.name} onCommit={v => upd(it.id, { label: v })} />
          {isCab(it.kind) && <Text label="Catalog code" value={it.code || ''} placeholder="e.g. B24" onCommit={v => upd(it.id, { code: v.trim() })} />}
          <div style={{ display: 'grid', gridTemplateColumns: isCab(it.kind) ? '1fr 1fr 1fr' : '1fr 1fr', gap: '8px' }}>
            <Num label="Width" value={it.w} onCommit={w => upd(it.id, { w: Math.max(1, w), ...(it.wall !== null ? { t: it.t + (Math.max(1, w) - it.w) / 2 } : {}) })} />
            <Num label="Depth" value={it.d} onCommit={dp => upd(it.id, { d: Math.max(1, dp) })} />
            {isCab(it.kind) && <Num label="Height" value={it.h || 0} onCommit={h => upd(it.id, { h })} />}
          </div>
          {it.wall !== null ? (<>
            <Num label="Left edge from the left corner" value={it.t - it.w / 2} onCommit={x => upd(it.id, { t: x + it.w / 2 })} />
            <div style={{ fontSize: '14px', color: 'var(--muted)' }}>
              Gap on the left <b style={{ color: 'var(--cream)' }}>{isFinite(g.a) ? fmtIn(g.a) : '–'}</b> · on the right <b style={{ color: 'var(--cream)' }}>{isFinite(g.b) ? fmtIn(g.b) : '–'}</b>
              {isFinite(g.a) && isFinite(g.b) && <button style={{ ...btn, minHeight: '36px', marginLeft: '8px' }} onClick={() => upd(it.id, { t: it.t + (g.b - g.a) / 2 })}>Center</button>}
            </div>
          </>) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <Num label="Center across" value={it.x} onCommit={x => upd(it.id, { x })} />
              <Num label="Center down" value={it.y} onCommit={y => upd(it.id, { y })} />
            </div>
          )}
          <div>
            <div style={lbl}>Nudge</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              {[[0.0625, '1/16'], [0.25, '1/4'], [1, '1'], [6, '6']].map(([n, t]) => <button key={t as string} style={nudge === n ? btnOn : btn} onClick={() => setNudge(n as number)}>{t}"</button>)}
              {it.wall !== null ? (<><button style={btn} onClick={() => nudgeBy(it, -1, 't')}>◀</button><button style={btn} onClick={() => nudgeBy(it, 1, 't')}>▶</button></>) : (<>
                <button style={btn} onClick={() => nudgeBy(it, -1, 'x')}>◀</button><button style={btn} onClick={() => nudgeBy(it, 1, 'x')}>▶</button>
                <button style={btn} onClick={() => nudgeBy(it, -1, 'y')}>▲</button><button style={btn} onClick={() => nudgeBy(it, 1, 'y')}>▼</button></>)}
            </div>
          </div>
          {it.wall === null && (<div>
            <div style={lbl}>Angle (any direction)</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button style={btn} onClick={() => upd(it.id, { rot: ((it.rot || 0) - 15 + 360) % 360 })}>−15°</button>
              <div style={{ ...btn, display: 'flex', alignItems: 'center', minWidth: '64px', justifyContent: 'center' }}>{Math.round(it.rot || 0)}°</div>
              <button style={btn} onClick={() => upd(it.id, { rot: ((it.rot || 0) + 15) % 360 })}>+15°</button>
              <button style={btn} onClick={() => upd(it.id, { rot: ((it.rot || 0) + 90) % 360 })}>+90°</button>
              <button style={btn} onClick={() => upd(it.id, { rot: ((it.rot || 0) + 180) % 360 })}>Turn around 180°</button>
              <button style={btn} onClick={() => upd(it.id, { rot: 0 })}>Straight</button>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>You can also drag it on the drawing; the numbers here follow along.</div>
          </div>)}
          </Sec>
          {it.kind === 'door' && (<Sec title="Door" open>
            <Chips label="Kind of door" value={it.p?.type || 'swing'} opts={[['swing', 'Swinging'], ['double', 'Double'], ['pocket', 'Pocket'], ['barn', 'Barn'], ['bifold', 'Bi-fold'], ['opening', 'Opening']]} onPick={v => upd(it.id, { p: { ...(it.p || {}), type: v } })} />
            {(it.p?.type || 'swing') !== 'opening' && <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {['swing', 'pocket', 'barn', undefined].includes(it.p?.type) && <button style={btn} onClick={() => upd(it.id, { hinge: it.hinge === 'right' ? 'left' : 'right' })}>{['pocket', 'barn'].includes(it.p?.type) ? 'Slides to the ' : 'Hinge: '}{it.hinge === 'right' ? 'right' : 'left'}</button>}
              {it.p?.type !== 'pocket' && <button style={btn} onClick={() => upd(it.id, { swing: it.swing === 'out' ? 'in' : 'out' })}>{it.p?.type === 'barn' ? (it.swing === 'out' ? 'Hangs outside the room' : 'Hangs inside the room') : (it.p?.type === 'bifold' ? 'Folds ' : 'Swings ') + (it.swing === 'out' ? 'out' : 'in')}</button>}
            </div>}
          </Sec>)}
          {it.kind === 'window' && <Sec title="Window" open><Num label="Sill height" value={it.sill ?? 36} onCommit={s => upd(it.id, { sill: s })} /></Sec>}
          {(() => {
            const P = it.p || {}; const setP = (q: Record<string, any>) => upd(it.id, { p: { ...P, ...q } });
            const side: Array<[any, string]> = [['wall', 'Wall'], ['knee', 'Knee wall + glass'], ['glass', 'Glass'], ['open', 'Open']];
            if (it.kind === 'shower') return (<>
              {P.unit !== 'sterling' && <>
                <Chips label="Floor / base" value={P.unit === 'base' ? 'base' : 'tile'} opts={[['tile', 'Tiled floor'], ['base', 'Kohler base']]} onPick={v => v === 'base' ? setP({ unit: 'base', tile: false, curb: true, ...(P.drain === 'endL' || P.drain === 'endR' ? { drain: 'center' } : {}) }) : setP({ unit: undefined, tile: P.walls !== 'wetwall', walls: 'tile' })} />
                {P.unit === 'base' && <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <Chips label="Base width" value={it.w} opts={[[36, '36"'], [48, '48"'], [60, '60"']]} onPick={v => upd(it.id, { w: v, ...(it.wall !== null ? { t: it.t + (v - it.w) / 2 } : {}) })} />
                  <Chips label="Base depth" value={it.d} opts={[[36, 'Standard 36"'], [42, '42"']]} onPick={v => upd(it.id, { d: v })} />
                </div>}
                <Chips label="Wall finish" value={P.walls || 'tile'} opts={[['tile', 'Tile'], ['wetwall', 'Wet wall panels (Wilson Art)']]} onPick={v => v === 'wetwall' ? setP({ walls: 'wetwall', unit: 'base', tile: false, curb: true }) : setP({ walls: 'tile' })} />
                {P.walls === 'wetwall' && <div style={{ fontSize: '13px', color: 'var(--muted)' }}>Wet wall panels sit on a Kohler base, so this shower now uses one.</div>}
              </>}
              {!P.unit && <Sec title="Walls & way in" open>
              <Chips label="Left side" value={P.left} opts={side} onPick={v => setP({ left: v })} />
              <Chips label="Right side" value={P.right} opts={side} onPick={v => setP({ right: v })} />
              <Chips label="Front" value={P.front} opts={side} onPick={v => setP({ front: v })} />
              <Chips label="Way in" value={P.entry} opts={[['front', 'Front'], ['left', 'Left end'], ['right', 'Right end'], ['cornerL', 'Corner L'], ['cornerR', 'Corner R']]} onPick={v => setP({ entry: v })} />
              </Sec>}
              <Sec title="Shower door" open>
              <Chips label="Door" value={P.door ? P.doorType : 'none'} opts={[['swing', 'Swing'], ['slider', 'Slider'], ['none', 'No door']]} onPick={v => v === 'none' ? setP({ door: false, ...(P.unit ? { front: 'open' } : {}) }) : setP({ door: true, doorType: v, ...(P.unit ? { front: 'glass' } : {}) })} />
              {P.door && P.entry === 'front' && <Chips label="Door position" value={P.doorPos} opts={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} onPick={v => setP({ doorPos: v })} />}
              <Num label="Door / opening width" value={P.doorW || 30} onCommit={v => setP({ doorW: Math.max(18, v) })} />
              <Chips label="Threshold" value={P.curb ? 'curb' : 'flat'} opts={[['curb', 'Curb'], ['flat', 'Curbless']]} onPick={v => setP({ curb: v === 'curb' })} />
              </Sec>
              <Sec title="Drain & valve">
              <Chips label="Drain" value={P.drain} opts={[['endL', 'Left end'], ['endR', 'Right end'], ['center', 'Center'], ['linear', 'Linear back'], ['trL', 'Trench left'], ['trR', 'Trench right']]} onPick={v => setP({ drain: v })} />
              <Chips label="Valve wall" value={P.valve} opts={[['left', 'Left'], ['back', 'Back'], ['right', 'Right']]} onPick={v => setP({ valve: v })} />
              <Chips label="Valve" value={P.valveType} opts={[['standard', 'Standard'], ['slide', 'With slide bar']]} onPick={v => setP({ valveType: v })} />
              </Sec>
              {!P.unit && <Sec title="Bench, niche & shelves">
              <Chips label="Bench" value={P.bench || 'none'} opts={[['none', 'None'], ['auto', 'Far from valve'], ['left', 'Left'], ['right', 'Right'], ['cornerL', 'Corner L'], ['cornerR', 'Corner R']]} onPick={v => setP({ bench: v })} />
              {P.bench && P.bench !== 'none' && <Num label="Bench depth" value={P.benchW || 15} onCommit={v => setP({ benchW: Math.max(10, v) })} />}
              <Chips label="Niche" value={P.niche || 'none'} opts={[['none', 'None'], ['back', 'Back'], ['left', 'Left'], ['right', 'Right']]} onPick={v => setP({ niche: v })} />
              <Chips label="Corner shelves" value={P.shelves || 'none'} opts={[['none', 'None'], ['bl', 'Back-left'], ['br', 'Back-right'], ['both', 'Both']]} onPick={v => setP({ shelves: v })} />
              </Sec>}
              {!P.unit && P.walls !== 'wetwall' && <Sec title="Tile">
              <Chips label="Tile lines" value={P.tile ? P.tileSize : 'off'} opts={[['off', 'Off'], ['2', '2"'], ['12', '12×12'], ['12x24', '12×24'], ['24', '24×24']]} onPick={v => v === 'off' ? setP({ tile: false }) : setP({ tile: true, tileSize: v })} />
              </Sec>}
            </>);
            if (it.kind === 'tub') return (<>
              <Chips label="Drain end" value={P.drain} opts={[['left', 'Left'], ['right', 'Right']]} onPick={v => setP({ drain: v })} />
              <Chips label="Glass door" value={P.door ? 'slider' : 'none'} opts={[['none', 'None'], ['slider', 'Sliding glass']]} onPick={v => setP({ door: v === 'slider' })} />
              {P.door && <Chips label="Door height" value={P.doorH || 58} opts={[[55, '55"'], [58, '58"'], [62, '62"'], [67, '67"']]} onPick={v => setP({ doorH: v })} />}
              <Chips label="Niche" value={P.niche || 'none'} opts={[['none', 'None'], ['back', 'Back'], ['left', 'Left'], ['right', 'Right']]} onPick={v => setP({ niche: v })} />
              <Chips label="Corner shelves" value={P.shelves || 'none'} opts={[['none', 'None'], ['bl', 'Back-left'], ['br', 'Back-right'], ['both', 'Both']]} onPick={v => setP({ shelves: v })} />
              <div style={{ fontSize: '13px', color: 'var(--muted)' }}>Grab bars, a tub filler and a rain head are under Add, Plumbing and Accessories.</div>
            </>);
            if (it.kind === 'kneewall') return (<>
              <Chips label="Height" value={[36, 42].includes(P.height ?? 36) ? (P.height ?? 36) : 0} opts={[[36, '36"'], [42, '42"'], [0, 'Other']]} onPick={v => v && setP({ height: v })} />
              <Num label="Height (type it)" value={P.height ?? 36} onCommit={v => setP({ height: Math.max(6, v) })} />
            </>);
            if (it.kind === 'partition') return <div style={{ fontSize: '14px', color: 'var(--muted)' }}>Inside walls always run to the ceiling.</div>;
            if (it.kind === 'toilet') return <Chips label="Bowl" value={P.bowl} opts={[['elong', 'Elongated'], ['round', 'Round']]} onPick={v => setP({ bowl: v })} />;
            if (it.kind === 'vanity') return <Chips label="Sinks" value={P.sinks} opts={[[1, 'One'], [2, 'Two']]} onPick={v => setP({ sinks: v })} />;
            if (it.kind === 'soffit') return <Num label="Drop below ceiling" value={P.drop ?? 12} onCommit={v => setP({ drop: Math.max(1, v) })} />;
            if (it.kind === 'switch') return <Chips label="Gangs" value={P.gang || 1} opts={[[1, '1'], [2, '2'], [3, '3']]} onPick={v => setP({ gang: v })} />;
            return null;
          })()}
          <Sec title="Notes"><Text label="Notes" value={it.notes || ''} onCommit={v => upd(it.id, { notes: v })} /></Sec>
        </>);
      })() : sel?.type === 'wall' ? (() => {
        const s = seg(d.pts, sel.i);
        return (<>
          <div style={{ fontWeight: 800, fontSize: '18px' }}>Wall {sel.i + 1}</div>
          <Num label="Length" value={s.L} onCommit={L => commit(setLen(d, sel.i, Math.max(6, L)))} />
          <div style={{ fontSize: '14px', color: 'var(--muted)' }}>Drag the wall to push it in or out. Its neighbors stretch with it.</div>
          <button style={btn} onClick={() => { commit(splitWall(d, sel.i)); setSel(null); }}>Add a corner in the middle</button>
        </>);
      })() : sel?.type === 'corner' ? (<>
        <div style={{ fontWeight: 800, fontSize: '18px' }}>Corner {sel.i + 1}</div>
        <div style={{ fontSize: '15px' }}>Angle inside: <b>{cornerAngle(d, sel.i).toFixed(1)}°</b></div>
        <div style={{ fontSize: '14px', color: 'var(--muted)' }}>Drag the corner to move it. It snaps to 45° steps.</div>
        <button style={btn} disabled={d.pts.length <= 3} onClick={() => { commit(removeCorner(d, sel.i)); setSel(null); }}>Remove this corner</button>
      </>) : (<>
        <div style={{ fontWeight: 800, fontSize: '18px' }}>{d.mode === 'bath' ? 'Bathroom' : 'Kitchen'}</div>
        <Num label="Ceiling height" value={d.ceiling || 96} onCommit={c => commit({ ...d, ceiling: Math.max(48, c) })} />
        <div style={{ fontSize: '14px', color: 'var(--muted)', lineHeight: 1.5 }}>Tap anything to change it. Drag a wall to stretch the room, or drag a corner for odd shapes. Use Add to place things.</div>
        <div style={lbl}>Cabinets so far</div>
        {rows.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: '14px' }}>None yet.</div> : rows.map((r, i) => (
          <div key={i} style={{ fontSize: '14px' }}><b>{r.qty} ×</b> {r.code ? `${r.code} · ` : ''}{r.desc} <span style={{ color: 'var(--muted)' }}>{fmtIn(r.w)} × {fmtIn(r.dp)}</span></div>))}
        <button style={{ ...btn, marginTop: '8px', ...(armed ? { background: '#b91c1c', border: 'none' } : {}) }} onClick={() => { if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3500); } else { setArmed(false); const t = template(d.mode); commit(t); setView(null); } }}>{armed ? 'Tap again to start over' : 'Start this room over'}</button>
      </>)}
    </div>
  );
  const inspector = d && (<>
    <div style={{ display: 'flex', gap: '6px', padding: '8px 14px 0' }}>
      <button style={tab === 'edit' ? btnOn : btn} onClick={() => setTab('edit')}>Edit</button>
      <button style={tab === 'check' ? btnOn : btn} onClick={() => setTab('check')}>Check{checks.length ? ` (${checks.length})` : ''}</button>
      <button style={tab === 'list' ? btnOn : btn} onClick={() => setTab('list')}>List</button>
    </div>
    {tab === 'edit' ? editPanel : tab === 'check' ? checkPanel : listPanel}
  </>);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'var(--ink)', display: 'flex', flexDirection: 'column', color: 'var(--cream)' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderBottom: '1px solid rgba(238,241,238,0.12)', flexWrap: 'wrap' }}>
        <button onClick={onHome} style={btn}>Home</button>
        <div style={{ flex: 1, minWidth: '90px', fontWeight: 800, fontSize: '17px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{jobName || 'Design Studio'}</div>
        {d && <>
          <button style={{ ...btn, opacity: hist.current.length ? 1 : 0.4 }} onClick={undo} disabled={!hist.current.length}>Undo</button>
          <button style={{ ...btn, opacity: fut.current.length ? 1 : 0.4 }} onClick={redo} disabled={!fut.current.length}>Redo</button>
          <button style={btnOn} onClick={() => { setSearch(''); setAddOpen(true); }}>+ Add</button>
          <div style={{ position: 'relative' }}>
            <button style={btn} onClick={() => setSaveOpen(o => !o)}>Save ▾</button>
            {saveOpen && (
              <div style={{ position: 'absolute', right: 0, top: '50px', zIndex: 50, background: '#1d2425', border: '1px solid rgba(238,241,238,0.25)', borderRadius: '12px', padding: '6px', minWidth: '230px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <button style={{ ...btn, textAlign: 'left' }} onClick={savePicture}>Plan picture (PNG)</button>
                <button style={{ ...btn, textAlign: 'left', opacity: rows.length ? 1 : 0.5 }} onClick={saveTakeoff}>Cabinet takeoff (CSV)</button>
                {pagesInfo.pages.length > 1 && <button style={{ ...btn, textAlign: 'left' }} onClick={saveTakeoffAll}>Cabinet takeoff, all pages (CSV)</button>}
                <button style={{ ...btn, textAlign: 'left' }} onClick={saveDrive}>Save to the job folder in Drive</button>
              </div>)}
          </div>
        </>}
        <button onClick={onCapture} style={btn}>Capture</button>
      </div>

      {/* page tabs */}
      {(d || pagesInfo.pages.length > 0) && (
        <div style={{ position: 'relative', borderBottom: '1px solid rgba(238,241,238,0.12)' }}>
          <div style={{ display: 'flex', gap: '6px', padding: '6px 10px', overflowX: 'auto' }}>
            {pagesInfo.pages.map(pg => <button key={pg.id} style={{ ...(pg.id === pagesInfo.cur ? btnOn : btn), minHeight: '38px', whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => goPage(pg.id)}>{pg.name}{pg.id === pagesInfo.cur ? ' ▾' : ''}</button>)}
            <button style={{ ...btn, minHeight: '38px', whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => { setPageMenu(false); setPageModal({ mode: 'new', name: '' }); }}>+ Page</button>
          </div>
          {pageMenu && (
            <div style={{ position: 'absolute', left: 10, top: '48px', zIndex: 60, background: '#1d2425', border: '1px solid rgba(238,241,238,0.25)', borderRadius: '12px', padding: '6px', minWidth: '210px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <button style={{ ...btn, textAlign: 'left' }} onClick={() => { setPageMenu(false); setPageModal({ mode: 'rename', name: curPageName }); }}>Rename this page</button>
              <button style={{ ...btn, textAlign: 'left' }} onClick={() => { setPageMenu(false); setPageModal({ mode: 'new', name: `${curPageName} copy` }); }}>Make a copy (before / after)</button>
              <button style={{ ...btn, textAlign: 'left', ...(delArmed ? { background: '#b91c1c', border: 'none' } : {}) }} onClick={deleteNow}>{delArmed ? 'Tap again to delete this page' : 'Delete this page'}</button>
            </div>)}
        </div>)}
      {pageModal && (
        <div onClick={() => setPageModal(null)} style={{ position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: '420px', background: '#1d2425', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '18px', fontWeight: 800 }}>{pageModal.mode === 'rename' ? 'Rename this page' : 'New page'}</div>
            <div><div style={lbl}>Page name</div><input autoFocus value={pageModal.name} onChange={e => setPageModal({ ...pageModal, name: e.target.value })} placeholder="Master bath, Kitchen, Before, After…" style={input} onKeyDown={e => { if (e.key === 'Enter' && pageModal.mode === 'rename') renameNow(); }} /></div>
            {pageModal.mode === 'rename' ? (
              <div style={{ display: 'flex', gap: '8px' }}><button style={btnOn} onClick={renameNow}>Save name</button><button style={btn} onClick={() => setPageModal(null)}>Cancel</button></div>
            ) : (<>
              <div style={{ color: 'var(--muted)', fontSize: '13px' }}>Start the page as:</div>
              <button style={{ ...btnOn, minHeight: '52px' }} onClick={() => makePage('bath')}>Bathroom · 5' × 8'</button>
              <button style={{ ...btn, minHeight: '52px' }} onClick={() => makePage('kitchen')}>Kitchen · 12' × 12'</button>
              {d && <button style={{ ...btn, minHeight: '52px' }} onClick={() => makePage('copy')}>A copy of “{curPageName || 'this page'}”</button>}
              <button style={btn} onClick={() => setPageModal(null)}>Cancel</button>
            </>)}
          </div>
        </div>)}

      <JobPanel>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: wide ? 'row' : 'column' }}>
          <div ref={wrapRef} style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0, background: '#0f1415' }}>
            {d && v && (
              <svg ref={svgRef} width={size.w} height={size.h} viewBox={`${v.cx - vbW / 2} ${v.cy - vbH / 2} ${vbW} ${vbH}`} style={{ display: 'block', touchAction: 'none', background: '#ffffff', userSelect: 'none' }}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} fontFamily="Arial, Helvetica, sans-serif">
                <g dangerouslySetInnerHTML={{ __html: body }} />
                {sel?.type === 'wall' && (() => { const s = seg(d.pts, sel.i); return <line x1={s.ax} y1={s.ay} x2={s.bx} y2={s.by} stroke="#E8731A" strokeWidth={4 * px} strokeLinecap="round" />; })()}
                {d.pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={(sel?.type === 'corner' && sel.i === i ? 10 : 7) * px} fill={sel?.type === 'corner' && sel.i === i ? '#E8731A' : '#ffffff'} stroke="#14191A" strokeWidth={2 * px} />)}
              </svg>
            )}
            {!d && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '24px', textAlign: 'center' }}>
                <div style={{ fontSize: '22px', fontWeight: 800 }}>What are we drawing?</div>
                <div style={{ color: 'var(--muted)', maxWidth: '420px' }}>It starts as an empty box with one door. Stretch the walls to match the room, then add things.</div>
                <button style={{ ...btnOn, minHeight: '64px', width: '100%', maxWidth: '360px', fontSize: '19px' }} onClick={() => start('bath')}>Bathroom · 5' × 8'</button>
                <button style={{ ...btn, minHeight: '64px', width: '100%', maxWidth: '360px', fontSize: '19px' }} onClick={() => start('kitchen')}>Kitchen · 12' × 12'</button>
              </div>)}
            {d && <div style={{ position: 'absolute', left: 10, bottom: 10, display: 'flex', gap: '6px' }}>
              <button style={zbtn} onClick={() => zoomBy(1 / 1.3)}>−</button><button style={zbtn} onClick={() => zoomBy(1.3)}>+</button><button style={zbtn} onClick={() => fitView()}>Fit</button>
            </div>}
            {msg && <div style={{ position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)', background: '#000c', color: '#fff', padding: '10px 16px', borderRadius: '10px', fontSize: '15px', maxWidth: '90%', textAlign: 'center' }}>{msg}</div>}
          </div>
          {d && <div style={{ ...(wide ? { width: '320px', borderLeft: '1px solid rgba(238,241,238,0.12)' } : { maxHeight: sel ? '46%' : '30%', borderTop: '1px solid rgba(238,241,238,0.12)' }), overflowY: 'auto', flexShrink: 0, background: 'var(--ink)' }}>{inspector}</div>}
        </div>
      </JobPanel>

      {addOpen && d && (() => {
        const all = CATS.flatMap(c => addList(c, d.mode));
        const q = search.trim().toLowerCase();
        const list = q ? all.filter(e => (e.name + ' ' + (e.sub || '')).toLowerCase().includes(q)) : addList(addGroup, d.mode);
        const secs: Array<[string, AddEntry[]]> = []; list.forEach(e => { const n = q ? 'Results' : e.section || ''; const f = secs.find(x => x[0] === n); if (f) f[1].push(e); else secs.push([n, [e]]); });
        const selStyle: CSSProperties = { ...input, minHeight: '48px', width: '100%' };
        const catMatches: CabEntry[] = q ? readyCatalogs().filter(e => matches(e, q)).slice(0, 80) : [];
        const cabCard = (e: CabEntry) => (
          <button key={e.maker + e.line + e.code + e.family} style={{ ...btn, minHeight: '64px', textAlign: 'left', padding: '8px 10px' }} onClick={() => addCab(e)}>
            <b>{e.code}</b>{e.lr ? ' L or R' : ''}<div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--muted)' }}>{fmtIn(e.w)} wide × {fmtIn(e.d)} deep{e.h ? ` × ${fmtIn(e.h)} high` : ''}{q ? ` · ${e.maker}${e.line ? ' ' + e.line : ''} ${e.family}` : ''}</div></button>);
        const customCabs = addList('Cabinets', d.mode);
        const mk = MAKERS.find(m => m.id === cabMaker); const lineNow = mk?.lines ? (mk.lines.find(l => l.id === cabLine) || mk.lines[0]) : undefined; const lineId = lineNow?.id || '';
        const lineReady = lineNow ? lineNow.ready : !!mk?.ready;
        const fams = cabMaker === 'Custom' ? [] : familiesFor(cabMaker, cabGroup, lineId);
        const famNow = fams.includes(cabFam) ? cabFam : fams[0] || '';
        const famRows = cabMaker === 'Custom' ? [] : catalogFor(cabMaker, lineId).filter(e => e.group === cabGroup && e.family === famNow).sort((a, b) => (a.h ?? 0) - (b.h ?? 0) || a.w - b.w);
        const catalogPane = (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div><div style={lbl}>Maker</div><div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {MAKERS.map(m => <button key={m.id} style={cabMaker === m.id ? btnOn : { ...btn, opacity: m.ready ? 1 : 0.55 }} onClick={() => { setCabMaker(m.id); setCabFam(''); const ln = m.lines ? m.lines.find(l => l.ready)?.id || m.lines[0].id : ''; setCabLine(ln || 'Select'); const g = groupsFor(m.id, ln); if (g.length && !g.includes(cabGroup)) setCabGroup(g[0]); }}>{m.id}</button>)}
              <button style={cabMaker === 'Custom' ? btnOn : btn} onClick={() => setCabMaker('Custom')}>Custom size</button>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>{cabMaker === 'Custom' ? 'Plain cabinets you size yourself.' : mk?.note}</div></div>
            {mk?.lines && (<div><div style={lbl}>Line</div><div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {mk.lines.map(l => <button key={l.id} style={lineId === l.id ? btnOn : { ...btn, opacity: l.ready ? 1 : 0.55 }} onClick={() => { setCabLine(l.id); setCabFam(''); const g = groupsFor(mk.id, l.id); if (g.length && !g.includes(cabGroup)) setCabGroup(g[0]); }}>{l.id}</button>)}
            </div><div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>{lineNow?.note}</div></div>)}
            {cabMaker === 'Custom' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '8px' }}>
                {customCabs.map(e => (<button key={e.key} style={{ ...btn, minHeight: '56px', textAlign: 'left' }} onClick={() => addItem(e)}>{e.name}<div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--muted)' }}>{fmtIn(e.w)} × {fmtIn(e.d)}</div></button>))}
              </div>
            ) : !lineReady ? (
              <div style={{ color: 'var(--muted)' }}>{lineNow ? `${cabMaker} ${lineNow.id} isn't loaded yet.` : `${cabMaker} isn't loaded yet.`}</div>
            ) : (<>
              <div style={{ display: 'grid', gridTemplateColumns: wide ? '1fr 1fr' : '1fr', gap: '8px' }}>
                <div><div style={lbl}>Kind of cabinet</div>
                  <select style={selStyle} value={cabGroup} onChange={e => { setCabGroup(e.target.value); setCabFam(''); }}>{groupsFor(cabMaker, lineId).map(g => <option key={g} value={g}>{g}</option>)}</select></div>
                <div><div style={lbl}>Style</div>
                  <select style={selStyle} value={famNow} onChange={e => setCabFam(e.target.value)}>{fams.map(f => <option key={f} value={f}>{f}</option>)}</select></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '8px' }}>{famRows.map(cabCard)}</div>
            </>)}
          </div>);
        return (
        <div onClick={() => setAddOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: '860px', height: 'min(82vh, 640px)', background: '#1d2425', borderRadius: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: '8px', padding: '12px', borderBottom: '1px solid rgba(238,241,238,0.12)' }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search: pocket door, GFCI, vanity…" style={{ ...input, flex: 1 }} />
              <button style={btn} onClick={() => setAddOpen(false)}>Close</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: wide ? 'row' : 'column' }}>
              <div style={{ display: 'flex', flexDirection: wide ? 'column' : 'row', gap: '6px', padding: '10px', overflow: 'auto', flexShrink: 0, ...(wide ? { width: '170px', borderRight: '1px solid rgba(238,241,238,0.12)' } : { borderBottom: '1px solid rgba(238,241,238,0.12)' }) }}>
                {CATS.filter(c => addList(c, d.mode).length).map(c => <button key={c} style={{ ...(addGroup === c && !q ? btnOn : btn), textAlign: 'left', whiteSpace: 'nowrap' }} onClick={() => { setSearch(''); setAddGroup(c); }}>{catLabel(c, d.mode)}</button>)}
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                {addGroup === 'Cabinets' && !q ? catalogPane : (<>
                {secs.length === 0 && catMatches.length === 0 && <div style={{ color: 'var(--muted)' }}>Nothing matches that.</div>}
                {catMatches.length > 0 && <div style={{ marginBottom: '14px' }}><div style={lbl}>Cabinet models</div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '8px' }}>{catMatches.map(cabCard)}</div></div>}
                {secs.map(([name, es]) => (<div key={name} style={{ marginBottom: '14px' }}>
                  {name && <div style={lbl}>{name}</div>}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '8px' }}>
                    {es.map(e => (<button key={name + e.key} style={{ ...btn, minHeight: '72px', textAlign: 'left', display: 'flex', gap: '10px', alignItems: 'center', padding: '8px' }} onClick={() => addItem(e)}>
                      <Thumb e={e} /><span>{e.name}<div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--muted)' }}>{e.sub || `${fmtIn(e.w)} × ${fmtIn(e.d)}`}</div></span></button>))}
                  </div></div>))}
                </>)}
              </div>
            </div>
          </div>
        </div>);
      })()}
    </div>
  );
}
