// 3D view of the room, built straight from the saved drawing (the 2D drawing stays the one source of truth).
// First pass: clean boxes at believable heights. Walls rise to their heights, doors and windows are cut into
// them, soffits hang from the ceiling, and a vaulted ceiling follows its slope. Drag to turn, pinch to zoom.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { KINDS, T, frame, seg, type DItem, type Design, type Pt } from './model';
import { counterSlabs, paintOf } from './counter';
import { appHex, cabColor, colorPaint, floorHexOf, shade, wallHexOf } from './finishes';
import { floorOf, vaultOf } from './finish';
import { wallHeights } from './walls';
import { windowOf } from './windows';
import { sidesOf } from './showerwalls';

const COL = { wall: '#f3f0e8', floor: '#d8d4c9', cab: '#d3bd94', white: '#f4f4f1', steel: '#c4c8ca', dark: '#3b4144', soffit: '#e8dfc9', brass: '#a08a58', glass: '#9fd0e6' };

// ---------- the ceiling, flat or vaulted ----------
function bounds(pts: Pt[]) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, W: maxX - minX, H: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
/** Ceiling height above a spot on the plan (x, y = plan coordinates), inches. Same rules as the plan's vault tag. */
function ceilAt(d: Design, x: number, y: number): number {
  const base = d.ceiling || 96; const v = vaultOf(d); if (v.shape === 'flat' || d.pts.length < 3) return base;
  const b = bounds(d.pts); const k = v.pitch / 12;
  if (v.shape === 'slope') {
    if (v.toward === 'top') return base + k * (b.maxY - y);
    if (v.toward === 'bottom') return base + k * (y - b.minY);
    if (v.toward === 'left') return base + k * (b.maxX - x);
    return base + k * (x - b.minX);
  }
  return v.ridge === 'lr' ? base + k * (b.H / 2 - Math.abs(y - b.cy)) : base + k * (b.W / 2 - Math.abs(x - b.cx));
}
/** Where along a wall (0..len) the vaulted ceiling changes direction (the ridge), if it does. */
function ridgeStops(d: Design, s: ReturnType<typeof seg>, len: number): number[] {
  const v = vaultOf(d); if (v.shape !== 'peak') return [];
  const b = bounds(d.pts); const out: number[] = [];
  const t = v.ridge === 'lr' ? (Math.abs(s.uy) > 1e-6 ? (b.cy - s.ay) / s.uy : -1) : (Math.abs(s.ux) > 1e-6 ? (b.cx - s.ax) / s.ux : -1);
  if (t > 0.5 && t < len - 0.5) out.push(t);
  return out;
}
function clipHalf(pts: Pt[], horizontal: boolean, at: number, keepGreater: boolean): Pt[] {
  const val = (p: Pt) => (horizontal ? p.y : p.x) - at; const keep = (v: number) => (keepGreater ? v >= 0 : v <= 0);
  const out: Pt[] = [];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]; const a = val(p), b = val(q);
    if (keep(a)) out.push(p);
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) { const t = a / (a - b); out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }); }
  });
  return out;
}
const signedArea = (pts: Pt[]) => { let a = 0; pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }); return a / 2; };

/** A flat-plan polygon as a floor-like surface; `heightAt` lifts each corner (ceiling) or leaves it flat at y. */
function surface(poly: Pt[], y: number, heightAt?: (x: number, z: number) => number): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map(p => new THREE.Vector2(p.x, -p.y)));
  const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt ? heightAt(pos.getX(i), pos.getZ(i)) : y);
  g.computeVertexNormals(); return g;
}

// ---------- small helpers ----------
const mats: THREE.Material[] = [];
function mat(color: string, opacity = 1): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
  mats.push(m); return m;
}
const frameM = (ux: number, uy: number, nx: number, ny: number, cx: number, cy: number) =>
  new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uy), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, ny)).setPosition(cx, 0, cy);

interface Part { lx: number; lz: number; w: number; dd: number; y0: number; h: number; color: string; opacity?: number; round?: boolean }

/** Clean boxes for an item, in its own frame: x along the wall, z out into the room, centered on the item. */
function parts(it: DItem, d: Design): Part[] {
  const k = KINDS[it.kind]; const p = it.p || {}; const w = it.w, dp = it.d; const ceil = d.ceiling || 96;
  const cab = cabColor(d, it); const app = appHex(d); const tcol = colorPaint(it.p?.tcolor || d.counter?.color)?.fill || '#b7b4ac';
  const P = (o: Partial<Part> & { h: number }): Part => ({ lx: 0, lz: 0, w, dd: dp, y0: 0, color: cab, ...o });
  const top = (h: number, color = tcol): Part => P({ y0: h, h: 1.5, dd: dp + 1.5, lz: 0.75, w: w + 0.5, color });
  switch (it.kind) {
    case 'toilet': { // a tank, a rounded bowl with a seat, and a base joining them; the bowl is rounder or longer by the setting
      const round = p.bowl === 'round'; const tank = 7.5; const bw = w * 0.78; const bl = round ? 16.5 : 19;
      const zBowl = dp / 2 - bl / 2; const gap = dp - bl - tank; const W = COL.white;
      const o: Part[] = [
        P({ lz: -dp / 2 + tank / 2, w: w * 0.95, dd: tank, h: 28, color: W }),
        P({ lz: zBowl, w: bw, dd: bl, h: 15, round: true, color: W }),
        P({ lz: zBowl, w: bw + 1.5, dd: bl + 1.5, y0: 15, h: 1.2, round: true, color: '#fafaf8' }),
      ];
      if (gap > 0.5) o.push(P({ lz: -dp / 2 + tank + gap / 2, w: bw * 0.62, dd: gap + 1, h: 14, color: W }));
      return o;
    }
    case 'pedestal': return [P({ w: w * 0.35, dd: dp * 0.4, lz: -dp * 0.2, h: 30, color: COL.white }), P({ y0: 30, h: 5, color: COL.white })];
    case 'tub': case 'ftub': {
      const o = [P({ h: 20, color: COL.white }), P({ y0: 20, h: 0.4, w: w - 5, dd: dp - 5, color: '#dfe9ee' })];
      if (p.door) o.push(P({ y0: 20, h: (p.doorH || 58) - 20, dd: 0.6, lz: dp / 2, color: COL.glass, opacity: 0.25 }));
      return o;
    }
    case 'fridge': return [P({ h: 70, color: app })];
    case 'range': return [P({ h: 35, color: app }), P({ y0: 35, h: 1, color: COL.dark }), P({ y0: 36, h: 6, dd: 3, lz: -dp / 2 + 1.5, color: app })];
    case 'dw': return [P({ h: 34, color: app })];
    case 'vanity': case 'desk': { const h = it.h || k.h || 34.5; return [P({ h }), top(h)]; }
    case 'base': case 'sinkbase': case 'drawer': case 'island': case 'pantry': case 'linen': case 'utility': case 'endpanel':
      return [P({ h: it.h || k.h || 34.5 })];
    case 'upper': return [P({ y0: 54, h: it.h || 30 })];
    case 'hood': return [P({ y0: 66, h: 14, color: app })];
    case 'chimney': return [P({ y0: 66, h: 12, color: app }), P({ y0: 78, h: Math.max(4, ceil - 78), w: 12, dd: 10, lz: -dp / 2 + 5, color: app })];
    case 'mirror': return [P({ y0: 42, h: 30, dd: 1.5, lz: -dp / 2 + 0.75, color: '#cfe3ea' })];
    case 'medcab': return [P({ y0: 42, h: 26, color: COL.white })];
    case 'vlight': return [P({ y0: 72, h: 3, color: COL.dark })];
    case 'grab': return [P({ y0: 33, h: 1.5, color: COL.steel })];
    case 'kneewall': return [P({ h: p.height || 36, color: COL.wall })];
    case 'partition': return [P({ h: ceil, color: COL.wall })];
    default: return [];
  }
}

// ---------- the scene ----------
function tileTexture(tile: string, dir: 'v' | 'h', base: string, lineColor: string): { tex: THREE.CanvasTexture; cw: number; ch: number } | null {
  if (tile === 'plain') return null;
  const cell = tile === '24' || tile === '12x24' ? 24 : 12; const N = 256; const sc = N / cell;
  const c = document.createElement('canvas'); c.width = N; c.height = N; const g = c.getContext('2d'); if (!g) return null;
  g.fillStyle = base; g.fillRect(0, 0, N, N); g.strokeStyle = lineColor; g.lineWidth = 3;
  const L = (x1: number, y1: number, x2: number, y2: number) => { g.beginPath(); g.moveTo(x1 * sc, y1 * sc); g.lineTo(x2 * sc, y2 * sc); g.stroke(); };
  if (tile === '12') { L(0, 0, 12, 0); L(0, 0, 0, 12); }
  else if (tile === '24') { L(0, 0, 24, 0); L(0, 0, 0, 24); }
  else if (tile === '2') for (let i = 0; i < 12; i += 2) { L(i, 0, i, 12); L(0, i, 12, i); }
  else if (dir === 'v') { L(0, 0, 0, 24); L(12, 0, 12, 24); L(0, 0, 12, 0); L(12, 12, 24, 12); }
  else { L(0, 0, 24, 0); L(0, 12, 24, 12); L(0, 0, 0, 12); L(12, 12, 12, 24); }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  tex.repeat.set(1 / cell, 1 / cell); return { tex, cw: cell, ch: cell };
}

function buildRoom(d: Design, showCeiling: boolean): THREE.Group {
  const g = new THREE.Group(); const pts = d.pts; const base = d.ceiling || 96;
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, M?: THREE.Matrix4) => { const mesh = new THREE.Mesh(geo, m); if (M) { mesh.matrixAutoUpdate = false; mesh.matrix.copy(M); } g.add(mesh); return mesh; };
  const boxAt = (M: THREE.Matrix4, p: Part) => {
    const T0 = new THREE.Matrix4().makeTranslation(p.lx, p.y0 + p.h / 2, p.lz);
    if (p.round) { add(new THREE.CylinderGeometry(0.5, 0.5, 1, 28), mat(p.color, p.opacity ?? 1), M.clone().multiply(T0).multiply(new THREE.Matrix4().makeScale(p.w, p.h, p.dd))); return; }
    add(new THREE.BoxGeometry(p.w, p.h, p.dd), mat(p.color, p.opacity ?? 1), M.clone().multiply(T0));
  };

  // floor
  const fl = floorOf(d); const fhex = floorHexOf(d); const tt = tileTexture(fl.tile, fl.dir, fhex || '#e7e3d9', shade(fhex || '#e7e3d9', 0.78));
  const fm = new THREE.MeshStandardMaterial({ color: tt ? '#ffffff' : fhex || COL.floor, map: tt ? tt.tex : null, roughness: 0.9, side: THREE.DoubleSide }); mats.push(fm);
  add(surface(pts, 0), fm);

  // walls, with door and window openings cut in
  const n = pts.length; const hs = wallHeights(d); const area = signedArea(pts);
  const walls: Array<{ m: THREE.MeshStandardMaterial; mesh: THREE.Mesh; x: THREE.Mesh[]; mx: number; mz: number; ox: number; oz: number }> = [];
  for (let i = 0; i < n; i++) {
    const s = seg(pts, i); if (s.L < 1) continue; const nx = seg(pts, (i + 1) % n);
    const convex = (s.ux * nx.uy - s.uy * nx.ux) * area > 0; const Lx = s.L + (convex ? T : 0);
    const topAt = (t: number) => { const c = ceilAt(d, s.ax + s.ux * t, s.ay + s.uy * t); return hs[i] > 0 ? Math.min(hs[i], c) : c; };
    const kinks = ridgeStops(d, s, Lx);
    const minTop = (a: number, b: number) => Math.min(topAt(a), topAt(b), ...kinks.filter(t => t > a && t < b).map(topAt));
    const doors = d.items.filter(q => q.kind === 'door' && q.wall === i).map(q => [Math.max(0.5, q.t - q.w / 2), Math.min(s.L - 0.5, q.t + q.w / 2)]).filter(r => r[1] - r[0] > 4).sort((a, b) => a[0] - b[0]);
    const sh = new THREE.Shape(); sh.moveTo(0, 0); let at = 0;
    for (const [a, b] of doors) {
      if (a < at) continue; const dh = Math.min(80, minTop(a, b) - 1);
      sh.lineTo(a, 0); sh.lineTo(a, dh); sh.lineTo(b, dh); sh.lineTo(b, 0); at = b;
    }
    sh.lineTo(Lx, 0);
    const stops = [Lx, ...kinks.slice().sort((a, b) => b - a), 0];
    for (const t of stops) sh.lineTo(t, topAt(t));
    for (const q of d.items) if (q.kind === 'window' && q.wall === i) {
      const o = windowOf(d, q); const a = q.t - q.w / 2, b = q.t + q.w / 2; if (a < 1 || b > s.L - 1) continue;
      const y0 = Math.max(0.5, o.sill), y1 = Math.min(o.sill + o.h, minTop(a, b) - 0.5); if (y1 - y0 < 2) continue;
      const hole = new THREE.Path(); hole.moveTo(a, y0); hole.lineTo(b, y0); hole.lineTo(b, y1); hole.lineTo(a, y1); hole.closePath(); sh.holes.push(hole);
    }
    const M = frameM(s.ux, s.uy, -s.nx, -s.ny, s.ax, s.ay); // x along the wall, z out through the wall
    const wm = mat(wallHexOf(d) || COL.wall); wm.transparent = true; const wmesh = add(new THREE.ExtrudeGeometry(sh, { depth: T, bevelEnabled: false }), wm, M);
    const entry = { m: wm, mesh: wmesh, x: [] as THREE.Mesh[], mx: s.ax + s.ux * s.L / 2 - s.nx * T / 2, mz: s.ay + s.uy * s.L / 2 - s.ny * T / 2, ox: -s.nx, oz: -s.ny };
    walls.push(entry);
    for (const q of d.items) if (q.kind === 'window' && q.wall === i) { // glass in each window
      const o = windowOf(d, q); const y0 = Math.max(0.5, o.sill), y1 = Math.min(o.sill + o.h, minTop(q.t - q.w / 2, q.t + q.w / 2) - 0.5); if (y1 - y0 < 2) continue;
      const frosted = o.glass === 'obscure' || o.type === 'block';
      entry.x.push(add(new THREE.PlaneGeometry(q.w, y1 - y0), mat(frosted ? '#f2f6f8' : COL.glass, frosted ? 0.75 : 0.28), M.clone().multiply(new THREE.Matrix4().makeTranslation(q.t, (y0 + y1) / 2, T / 2))));
    }
  }

  g.userData.walls = walls;
  // things on the floor and on the walls
  for (const it of d.items) {
    const k = KINDS[it.kind]; if (!k || k.layer === 'inwall' || it.kind === 'soffit') continue;
    const f = frame(it, pts); const M = frameM(f.ux, f.uy, f.nx, f.ny, f.cx, f.cy);
    if (k.layer === 'ceiling') { ceilingItem(g, it, f.cx, f.cy, d); continue; }
    if (it.kind === 'shower') { shower(g, it, M, d); continue; }
    for (const p of parts(it, d)) boxAt(M, p);
  }

  // countertops
  for (const sl of counterSlabs(d)) {
    const shape = new THREE.Shape(sl.poly.map(p => new THREE.Vector2(p.x, -p.y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.5, bevelEnabled: false }); geo.rotateX(-Math.PI / 2); geo.translate(0, 34.5, 0);
    add(geo, mat(paintOf(sl.mat, sl.color).fill));
  }

  // soffits: a flat underside at (ceiling - drop); in a vaulted room it reaches up into the slope
  for (const it of d.items) if (it.kind === 'soffit') {
    const f = frame(it, pts); const drop = it.p?.drop ?? 12; const bottom = base - drop;
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ceilAt(d, f.cx + f.ux * a * it.w / 2 + f.nx * b * it.d / 2, f.cy + f.uy * a * it.w / 2 + f.ny * b * it.d / 2));
    const h = Math.max(drop, Math.max(...cs) - bottom + 0.2);
    boxAt(frameM(f.ux, f.uy, f.nx, f.ny, f.cx, f.cy), { lx: 0, lz: 0, w: it.w, dd: it.d, y0: bottom, h, color: COL.soffit });
  }

  // ceiling (hidden by default so you can look in from above)
  if (showCeiling && n >= 3) {
    const v = vaultOf(d); const cm = mat('#fbfaf6'); const b = bounds(pts);
    const h = (x: number, z: number) => ceilAt(d, x, z);
    if (v.shape === 'peak') {
      const horiz = v.ridge === 'lr'; const at = horiz ? b.cy : b.cx;
      for (const gt of [true, false]) { const half = clipHalf(pts, horiz, at, gt); if (half.length >= 3) add(surface(half, 0, h), cm); }
    } else add(surface(pts, base, v.shape === 'flat' ? undefined : h), cm);
  }
  return g;
}

function ceilingItem(g: THREE.Group, it: DItem, cx: number, cy: number, d: Design) {
  const c = ceilAt(d, cx, cy); const p = it.p || {};
  const put = (geo: THREE.BufferGeometry, color: string, y: number, ox = 0, oz = 0) => { const m = new THREE.Mesh(geo, mat(color)); m.position.set(cx + ox, y, cy + oz); g.add(m); };
  if (it.kind === 'can' || it.kind === 'wet') put(new THREE.CylinderGeometry(it.w / 2, it.w / 2, 0.8, 18), '#fff6c8', c - 0.4);
  else if (it.kind === 'fan') put(new THREE.BoxGeometry(it.w, 2, it.d), COL.white, c - 1);
  else if (it.kind === 'pendant') { put(new THREE.CylinderGeometry(0.3, 0.3, 34, 6), COL.dark, c - 17); put(new THREE.CylinderGeometry(3, 6, 8, 18), COL.brass, c - 38); }
  else if (it.kind === 'cfan') { put(new THREE.CylinderGeometry(4, 4, 5, 14), COL.dark, c - 8); put(new THREE.BoxGeometry(it.w, 0.6, 6), COL.cab, c - 10); put(new THREE.BoxGeometry(6, 0.6, it.w), COL.cab, c - 10); }
  else if (it.kind === 'rainhead') { const r = (p.size || 8) / 2; put(new THREE.CylinderGeometry(r, r, 0.8, 18), COL.steel, 82); }
}

function shower(g: THREE.Group, it: DItem, M: THREE.Matrix4, d: Design) {
  const p = it.p || {}; const w = it.w, dp = it.d; const ceil = d.ceiling || 96;
  const poly: Array<[number, number]> = p.poly || [[0, 0], [w, 0], [w, dp], [0, dp]];
  const front = p.door ? 'door' : p.front === 'glass' || p.front === 'knee' || p.front === 'wall' ? p.front : 'open';
  const sides = p.poly ? sidesOf(p, poly.length) : ['open', p.right || 'wall', front, p.left || 'wall'].map((t: string) => (t === 'wall' || t === 'knee' || t === 'glass' || t === 'door' ? t : 'open'));
  const loc = poly.map(([x, y]) => [x - w / 2, y - dp / 2] as [number, number]);
  const floorH = p.unit === 'base' || p.unit === 'sterling' ? 4 : 0.6;
  const fs = new THREE.Shape(loc.map(q => new THREE.Vector2(q[0], -q[1])));
  const fg = new THREE.ExtrudeGeometry(fs, { depth: floorH, bevelEnabled: false }); fg.rotateX(-Math.PI / 2);
  const fm = new THREE.Mesh(fg, mat(p.unit === 'sterling' ? COL.white : '#e2e4dd')); fm.matrixAutoUpdate = false; fm.matrix.copy(M); g.add(fm);
  const cx = loc.reduce((a, q) => a + q[0], 0) / loc.length, cz = loc.reduce((a, q) => a + q[1], 0) / loc.length;
  loc.forEach((a, i) => {
    const b = loc[(i + 1) % loc.length]; const t = sides[i]; if (t === 'open') return;
    const ex = b[0] - a[0], ez = b[1] - a[1]; const L = Math.hypot(ex, ez); if (L < 1) return; const ux = ex / L, uz = ez / L;
    let nx = uz, nz = -ux; if (nx * ((a[0] + b[0]) / 2 - cx) + nz * ((a[1] + b[1]) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
    const put = (s0: number, s1: number, y0: number, y1: number, thick: number, off: number, color: string, opacity = 1) => {
      const geo = new THREE.BoxGeometry(s1 - s0, y1 - y0, thick); const mid = (s0 + s1) / 2;
      const mesh = new THREE.Mesh(geo, mat(color, opacity)); mesh.matrixAutoUpdate = false;
      const place = M.clone().multiply(new THREE.Matrix4().makeTranslation(a[0] + ux * mid + nx * off, (y0 + y1) / 2, a[1] + uz * mid + nz * off).multiply(new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-uz, 0, ux))));
      mesh.matrix.copy(place); g.add(mesh);
    };
    if (t === 'wall') put(0, L, 0, ceil, T, T / 2, COL.wall);
    else if (t === 'knee') { put(0, L, 0, 36, T, 0, '#c9c9c0'); put(0, L, 36, 72, 0.6, 0, COL.glass, 0.28); }
    else if (t === 'glass') put(0, L, floorH, 72, 0.6, 0, COL.glass, 0.28);
    else if (t === 'door') { const dw = Math.min(p.doorW || 30, Math.max(6, L - 4)); const s0 = (L - dw) / 2; put(0, s0, floorH, 72, 0.6, 0, COL.glass, 0.28); put(s0 + dw, L, floorH, 72, 0.6, 0, COL.glass, 0.28); }
  });
}

// ---------- the screen ----------
const bar: CSSProperties = { minHeight: '44px', minWidth: '44px', padding: '0 14px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '15px', border: '1px solid rgba(238,241,238,0.25)', background: 'rgba(20,25,26,0.82)', color: '#eef1ee' };

export default function View3D({ design, onClose }: { design: Design; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; room: THREE.Group | null; render: () => void } | null>(null);
  const [ceiling, setCeiling] = useState(false);
  const [wallMode, setWallMode] = useState<'fade' | 'hide' | 'solid'>('fade'); // the walls between you and the room: faded, gone, or solid
  const modeRef = useRef<'fade' | 'hide' | 'solid'>('fade');
  const [err, setErr] = useState('');

  const savePhoto = () => { // a PNG of exactly what is on screen (without the buttons)
    const t = three.current; if (!t) return; t.render();
    t.renderer.domElement.toBlob(b => { if (!b) return; const url = URL.createObjectURL(b); const a = document.createElement('a'); a.href = url; a.download = 'Room 3D.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }, 'image/png');
  };

  const look = (preset: 'corner' | 'top' | 'inside') => {
    const t = three.current; if (!t) return; const b = bounds(design.pts); const size = Math.max(b.W, b.H, 60); const base = design.ceiling || 96;
    if (preset === 'top') { t.camera.position.set(b.cx, size * 1.5 + 80, b.cy + size * 0.2); t.controls.target.set(b.cx, 0, b.cy); }
    else if (preset === 'inside') { t.camera.position.set(b.cx, 60, b.maxY - Math.min(b.H * 0.12, 24)); t.controls.target.set(b.cx, base * 0.55, b.minY); }
    else { t.camera.position.set(b.cx + size * 0.6, size * 1.0 + 90, b.cy + size * 0.8); t.controls.target.set(b.cx, 30, b.cy); }
    t.controls.update(); t.render();
  };

  useEffect(() => { // one renderer for as long as the screen is open
    const el = host.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { setErr('This device could not start the 3D view.'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); el.appendChild(renderer.domElement); renderer.domElement.style.display = 'block';
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#e6e9e4');
    scene.add(new THREE.HemisphereLight('#ffffff', '#b8b4a8', 1.7)); const sun = new THREE.DirectionalLight('#ffffff', 1.5); sun.position.set(200, 400, 150); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(50, 1, 2, 6000);
    const controls = new OrbitControls(camera, renderer.domElement); controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 12; controls.maxDistance = 2500;
    const render = () => {
      const ws = three.current?.room?.userData.walls as Array<{ m: THREE.MeshStandardMaterial; mesh: THREE.Mesh; x: THREE.Mesh[]; mx: number; mz: number; ox: number; oz: number }> | undefined;
      if (ws) for (const w of ws) {
        const near = (camera.position.x - w.mx) * w.ox + (camera.position.z - w.mz) * w.oz > 0; const fade = near && modeRef.current === 'fade', hide = near && modeRef.current === 'hide';
        w.m.opacity = fade ? 0.1 : 1; w.m.depthWrite = !fade; w.mesh.visible = !hide; w.x.forEach(q => { q.visible = !hide; });
      }
      renderer.render(scene, camera);
    };
    controls.addEventListener('change', render);
    const resize = () => { const w = el.clientWidth || 800, h = el.clientHeight || 600; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); render(); };
    const ro = new ResizeObserver(resize); ro.observe(el);
    three.current = { renderer, scene, camera, controls, room: null, render };
    resize();
    return () => {
      ro.disconnect(); controls.dispose(); renderer.dispose(); three.current = null;
      scene.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
      mats.splice(0).forEach(m => { const mm = m as THREE.MeshStandardMaterial; if (mm.map) mm.map.dispose(); m.dispose(); });
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, []);

  const first = useRef(true);
  useEffect(() => { // rebuild the room when the drawing or the ceiling switch changes
    const t = three.current; if (!t) return;
    if (t.room) { t.scene.remove(t.room); t.room.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); }); mats.splice(0).forEach(m => { const mm = m as THREE.MeshStandardMaterial; if (mm.map) mm.map.dispose(); m.dispose(); }); }
    try { t.room = buildRoom(design, ceiling); t.scene.add(t.room); } catch (e) { setErr('Could not build the 3D room: ' + (e instanceof Error ? e.message : String(e))); return; }
    if (first.current) { first.current = false; look('corner'); } else t.render();
  }, [design, ceiling]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: '#e6e9e4' }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', left: 10, top: 10, right: 10, display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={bar} onClick={onClose}>‹ Back to the plan</button>
        <button style={bar} onClick={() => look('corner')}>Corner</button>
        <button style={bar} onClick={() => look('top')}>Top</button>
        <button style={bar} onClick={() => look('inside')}>Inside</button>
        <button style={{ ...bar, background: wallMode !== 'solid' ? 'rgba(160,138,88,0.95)' : bar.background }} onClick={() => { const nx = wallMode === 'fade' ? 'hide' : wallMode === 'hide' ? 'solid' : 'fade'; modeRef.current = nx; setWallMode(nx); three.current?.render(); }}>Front walls: {wallMode === 'fade' ? 'faded' : wallMode === 'hide' ? 'gone' : 'solid'}</button>
        <button style={bar} onClick={savePhoto}>Save picture</button>
        <button style={{ ...bar, background: ceiling ? 'rgba(160,138,88,0.95)' : bar.background }} onClick={() => setCeiling(c => !c)}>Ceiling {ceiling ? 'on' : 'off'}</button>
      </div>
      <div style={{ position: 'absolute', left: 10, bottom: 10, color: '#3b4440', fontSize: '13px', background: 'rgba(255,255,255,0.7)', borderRadius: '8px', padding: '4px 8px' }}>Drag to turn · pinch or scroll to zoom · two fingers to slide. Clean boxes for now.</div>
      {err && <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', background: '#fff', color: '#b91c1c', padding: '14px 18px', borderRadius: '10px', maxWidth: '80%' }}>{err}</div>}
    </div>
  );
}
