// 3D view of the room, built straight from the saved drawing (the 2D drawing stays the one source of truth).
// First pass: clean boxes at believable heights. Walls rise to their heights, doors and windows are cut into
// them, soffits hang from the ceiling, and a vaulted ceiling follows its slope. Drag to turn, pinch to zoom.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { KINDS, T, benchSide, frame, seg, type DItem, type Design, type Pt } from './model';
import { FRONT_KINDS, FRONT_T, KICK_SET, SHAKER_RAIL, frontHeight, frontOpenings, kickOf } from './fronts';
import { counterSlabs, hasTop, paintOf } from './counter';
import { appHex, cabColor, colorPaint, floorHexOf, shade, wallHexOf } from './finishes';
import { floorOf, vaultOf } from './finish';
import { wallHeights } from './walls';
import { windowOf } from './windows';
import { sidesOf } from './showerwalls';
import { cornerPoly, cuOf, dedupe, insetPoly, midShelves, topPoly } from './cornerunit';
import { customOf, partPoly, partZ } from './custom';

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
function bodyParts(it: DItem, d: Design): Part[] {
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
    case 'vanity': case 'desk': {
      const h = it.h || k.h || 34.5; const o: Part[] = [P({ h })]; if (it.kind !== 'vanity') o.push(top(h)); // a vanity's top is its countertop (counter.ts)
      if (it.kind === 'vanity' && hasTop(it)) { // undermount bowls, sized like common ones: oval 19x13.3, round 15, rectangular 19x14
        const sh = p.bowlShape === 'round' ? 'round' : p.bowlShape === 'rect' ? 'rect' : 'oval'; const n = p.sinks === 0 ? 0 : p.sinks === 2 ? 2 : 1;
        const bw = sh === 'round' ? 15 : 19, bd = sh === 'round' ? 15 : sh === 'oval' ? 13.3 : 14;
        for (let i = 0; i < n; i++) o.push(P({ lx: n === 2 ? (i ? 1 : -1) * w / 4 : 0, lz: 0.5, w: Math.min(bw, w / n - 4), dd: bd, y0: h + 1.5, h: 0.15, round: sh !== 'rect', color: '#eef2f3' }));
      }
      return o;
    }
    case 'sinkbase': { // the cabinet and the sink bowls cut into its top
      const o: Part[] = [P({ h: it.h || k.h || 34.5 })]; const sk = (p.sink as string) || '5050';
      if (sk !== 'none' && p.top !== false) {
        const bd = Math.min(Math.max(10, dp - 6), 16); const iw = Math.max(12, w - 3); const steel = sk === 'farm' && p.sinkMat === 'porcelain' ? '#f4f4f1' : '#b6bcc0';
        if (sk === '5050') { const bw = (iw - 1.5) / 2; o.push(P({ lx: -(bw + 1.5) / 2, lz: -dp / 2 + 3.5 + bd / 2, w: bw, dd: bd, y0: 36, h: 0.15, color: steel }), P({ lx: (bw + 1.5) / 2, lz: -dp / 2 + 3.5 + bd / 2, w: bw, dd: bd, y0: 36, h: 0.15, color: steel })); }
        else o.push(P({ lz: -dp / 2 + 3.5 + bd / 2, w: Math.min(iw, sk === 'farm' ? 33 : 30), dd: sk === 'farm' ? Math.max(12, dp - 4.5) : bd, y0: 36, h: 0.15, color: steel }));
        if (sk === 'farm') o.push(P({ lz: dp / 2 + 0.6, w: Math.min(iw, 33) + 0.5, dd: 1.5, y0: 25, h: 11, color: steel })); // the apron front
      }
      return o;
    }
    case 'base': case 'drawer': case 'island': case 'pantry': case 'linen': case 'utility': case 'endpanel':
      return [P({ h: it.h || k.h || 34.5 })];
    case 'upper': return [P({ y0: 54, h: it.h || 30 })];
    case 'filler': { const bt = p.bottom ?? 4.5; const o: Part[] = [P({ y0: bt, h: it.h || 30 })]; if (bt > 0 && bt < 10) o.push(P({ y0: 0, h: bt, dd: 0.75, lz: dp / 2 - 3.4, color: COL.dark })); return o; } // the toe kick board runs in front of the gap under it
    case 'hood': return [P({ y0: 66, h: 14, color: app })];
    case 'chimney': return [P({ y0: 66, h: 12, color: app }), P({ y0: 78, h: Math.max(4, ceil - 78), w: 12, dd: 10, lz: -dp / 2 + 5, color: app })];
    case 'mirror': return [P({ y0: 42, h: 30, dd: 1.5, lz: -dp / 2 + 0.75, color: '#cfe3ea' })];
    case 'medcab': return [P({ y0: 42, h: 26, color: COL.white })];
    case 'vlight': return [P({ y0: 72, h: 3, color: COL.dark })];
    case 'grab': return [P({ y0: 33, h: 1.5, color: COL.steel })];
    case 'kneewall': return [P({ h: p.height || 36, color: COL.wall })];
    case 'partition': { // an inside wall to the ceiling, with the doors and windows that sit on it cut through
      const ops: Array<{ a: number; b: number; y0: number; y1: number; win?: boolean }> = [];
      for (const q of d.items) {
        if ((q.kind !== 'door' && q.kind !== 'window') || q.p?.host !== it.id) continue;
        const c = Number(q.p?.hs) || 0; const a = Math.max(-w / 2 + 0.25, c - q.w / 2), b = Math.min(w / 2 - 0.25, c + q.w / 2); if (b - a < 4) continue;
        if (q.kind === 'door') ops.push({ a, b, y0: 0, y1: Math.min(80, ceil - 1) });
        else { const o = windowOf(d, q); const y0 = Math.max(0.5, o.sill), y1 = Math.min(o.sill + o.h, ceil - 0.5); if (y1 - y0 >= 2) ops.push({ a, b, y0, y1, win: true }); }
      }
      if (!ops.length) return [P({ h: ceil, color: COL.wall })];
      ops.sort((x, y) => x.a - y.a); const out: Part[] = []; let at = -w / 2;
      const piece = (a: number, b: number, y0: number, h: number) => { if (b - a > 0.05 && h > 0.05) out.push(P({ lx: (a + b) / 2, w: b - a, y0, h, color: COL.wall })); };
      for (const o of ops) {
        if (o.a < at) continue;
        piece(at, o.a, 0, ceil); piece(o.a, o.b, o.y1, ceil - o.y1); if (o.win) { piece(o.a, o.b, 0, o.y0); out.push(P({ lx: (o.a + o.b) / 2, w: o.b - o.a, dd: 0.6, y0: o.y0, h: o.y1 - o.y0, color: COL.glass, opacity: 0.28 })); }
        at = o.b;
      }
      piece(at, w / 2, 0, ceil); return out;
    }    default: return [];
  }
}

/** A cabinet's body, then its fronts. */
/** Under a base-type cabinet the carcass is cut back at the floor: the toe kick is a recessed band, KICK_SET further back than the front, only a little darker than the cabinet. */
function kickParts(body: Part[], kick: number): Part[] {
  const out: Part[] = [];
  for (const p of body) {
    if (p.y0 > 0.01 || p.dd <= KICK_SET + 1 || p.h <= 0) { out.push(p); continue; }
    out.push({ ...p, h: kick, dd: p.dd - KICK_SET, lz: p.lz - KICK_SET / 2, color: shade(p.color, 0.88) });
    if (p.h > kick) out.push({ ...p, y0: kick, h: p.h - kick });
  }
  return out;
}

function parts(it: DItem, d: Design): Part[] {
  const kick = kickOf(it);
  const body = kick ? kickParts(bodyParts(it, d), kick) : bodyParts(it, d);
  if (!FRONT_KINDS.has(it.kind)) return body;
  // the carcass sits a little darker than the fronts, so the thin gaps between doors and drawers read as lines
  const cc = cabColor(d, it); const dim = body.map(p => (p.color === cc ? { ...p, color: shade(cc, 0.8) } : p));
  return [...dim, ...frontParts(it, d)];
}

function lighten(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return hex;
  const n = parseInt(m[1], 16);
  return '#' + [16, 8, 0].map(s => Math.round(((n >> s) & 255) * (1 - amt) + 255 * amt).toString(16).padStart(2, '0')).join('');
}

/** Shaker doors (a frame of rails and stiles around a recessed flat panel) and one-piece drawer fronts, on the room side. */
function frontParts(it: DItem, d: Design): Part[] {
  const cab = cabColor(d, it); const panel = lighten(cab, 0.14);
  const y0 = it.kind === 'upper' ? 54 : 0; const dp = it.d; const z0 = dp / 2 + FRONT_T / 2; // front face sits on the carcass
  const out: Part[] = [];
  for (const o of frontOpenings(it.kind, it.w, frontHeight(it), it.p?.family, kickOf(it))) {
    const ow = o.x1 - o.x0, oh = o.y1 - o.y0, cx = (o.x0 + o.x1) / 2, base = y0 + o.y0;
    const bar = (lx: number, w: number, yy: number, h: number): Part => ({ lx, lz: z0, w, dd: FRONT_T, y0: yy, h, color: cab });
    if (o.kind === 'drawer') { out.push(bar(cx, ow, base, oh)); continue; }
    const R = SHAKER_RAIL;
    out.push(bar(cx, ow, base + oh - R, R), bar(cx, ow, base, R), bar(o.x0 + R / 2, R, base + R, oh - 2 * R), bar(o.x1 - R / 2, R, base + R, oh - 2 * R));
    // the recessed panel: set back behind the frame, its face flush with the carcass front
    out.push({ lx: cx, lz: dp / 2 + 0.225, w: ow - 2 * R, dd: 0.45, y0: base + R, h: oh - 2 * R, color: panel });
  }
  return out;
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

/** A counter surface with a believable grain: speckled granite, fine quartz, wood for butcher block. A seeded random keeps it the same every time. */
const stoneCache = new Map<string, THREE.MeshStandardMaterial>();
function stoneMat(id: string, fill: string): THREE.MeshStandardMaterial {
  const key = id + fill; const hit = stoneCache.get(key); if (hit && mats.includes(hit)) return hit;
  const N = 512; const SPAN = 36; // the picture covers 36 inches
  const c = document.createElement('canvas'); c.width = N; c.height = N; const g = c.getContext('2d');
  let rough = 0.5;
  const m = new THREE.MeshStandardMaterial({ color: fill, roughness: rough, metalness: 0.04, side: THREE.DoubleSide });
  if (g) {
    let s = 1234567; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, N, N);
    const dot = (x: number, y: number, r: number, col: string) => { g.fillStyle = col; for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { if (x + ox < -r || x + ox > N + r || y + oy < -r || y + oy > N + r) continue; g.beginPath(); g.arc(x + ox, y + oy, r, 0, 6.2832); g.fill(); } };
    if (id === 'granite') {
      rough = 0.32; for (let i = 0; i < 5200; i++) dot(rnd() * N, rnd() * N, 0.6 + rnd() * 1.8, rnd() < 0.55 ? 'rgba(40,36,32,' + (0.10 + rnd() * 0.22) + ')' : 'rgba(255,255,255,' + (0.25 + rnd() * 0.4) + ')');
    } else if (id === 'quartz') {
      rough = 0.26; for (let i = 0; i < 2600; i++) dot(rnd() * N, rnd() * N, 0.5 + rnd() * 1.1, rnd() < 0.5 ? 'rgba(90,86,78,' + (0.06 + rnd() * 0.10) + ')' : 'rgba(255,255,255,' + (0.3 + rnd() * 0.4) + ')');
      g.lineWidth = 1.2; for (let i = 0; i < 5; i++) { g.strokeStyle = 'rgba(110,106,98,' + (0.07 + rnd() * 0.07) + ')'; g.beginPath(); let x = rnd() * N, y = rnd() * N; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - 0.3) * 90; y += (rnd() - 0.5) * 70; g.lineTo(x, y); } g.stroke(); }
    } else if (id === 'butcher') {
      rough = 0.6; for (let i = 0; i < 260; i++) { const y = rnd() * N; g.strokeStyle = 'rgba(' + (rnd() < 0.5 ? '90,56,20' : '255,235,200') + ',' + (0.07 + rnd() * 0.13) + ')'; g.lineWidth = 0.6 + rnd() * 2.2; g.beginPath(); g.moveTo(0, y); g.lineTo(N, y + (rnd() - 0.5) * 8); g.stroke(); }
      g.strokeStyle = 'rgba(70,44,16,0.28)'; g.lineWidth = 1.5; for (let x = 0; x < N; x += N / 3) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, N); g.stroke(); }
    } else if (id === 'laminate') {
      rough = 0.5; for (let i = 0; i < 1400; i++) dot(rnd() * N, rnd() * N, 0.6 + rnd() * 1.2, rnd() < 0.5 ? 'rgba(70,60,40,' + (0.05 + rnd() * 0.08) + ')' : 'rgba(255,255,255,' + (0.12 + rnd() * 0.2) + ')');
    } else { rough = 0.35; }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.repeat.set(1 / SPAN, 1 / SPAN);
    m.map = tex; m.roughness = rough;
  }
  mats.push(m); stoneCache.set(key, m); return m;
}

function buildRoom(d: Design, showCeiling: boolean): THREE.Group {
  const g = new THREE.Group(); const pts = d.pts; const base = d.ceiling || 96;
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, M?: THREE.Matrix4) => { const mesh = new THREE.Mesh(geo, m); if (M) { mesh.matrixAutoUpdate = false; mesh.matrix.copy(M); } if (!m.transparent && !m.userData.noShadow) { mesh.castShadow = true; mesh.receiveShadow = true; } g.add(mesh); return mesh; };
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
    if (it.kind === 'cornerunit') { cornerUnit3d(g, it, M, d); continue; }
    if (it.kind === 'custom') { customPiece3d(g, it, M); continue; }
    for (const p of parts(it, d)) boxAt(M, p);
  }

  // countertops
  for (const sl of counterSlabs(d)) {
    const shape = new THREE.Shape(sl.poly.map(p => new THREE.Vector2(p.x, -p.y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.5, bevelEnabled: false }); geo.rotateX(-Math.PI / 2); geo.translate(0, (() => { const q = d.items.find(i => i.id === sl.id); return (q?.p?.bottom || 0) + (q?.h || 34.5); })(), 0);
    add(geo, stoneMat(sl.mat, paintOf(sl.mat, sl.color).fill));
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
    const v = vaultOf(d); const cm = mat('#fbfaf6'); cm.userData.noShadow = true; const b = bounds(pts);
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
  // bench: a solid block 18 in high, or a thin slab floating 15 in off the floor
  const float = p.benchStyle === 'float'; const bcol = p.benchTop === 'granite' ? '#d9d3c7' : '#e2e4dd'; const bh = float ? 3 : 18 - floorH; const by0 = float ? 15 : floorH;
  const bm = (M2: THREE.Matrix4, bw: number, bd: number) => { const m2 = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat(bcol)); m2.matrixAutoUpdate = false; m2.matrix.copy(M2); g.add(m2); };
  const bn = p.bench as { edge: number; depth: number } | null | undefined;
  if (p.poly && bn && typeof bn === 'object' && bn.edge >= 0 && bn.edge < loc.length) {
    const a = loc[bn.edge], b = loc[(bn.edge + 1) % loc.length]; const ex = b[0] - a[0], ez = b[1] - a[1]; const L = Math.hypot(ex, ez);
    if (L > 1) {
      const ux = ex / L, uz = ez / L; let nx = uz, nz = -ux; if (nx * ((a[0] + b[0]) / 2 - cx) + nz * ((a[1] + b[1]) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
      const dep = Math.max(6, bn.depth || 15); const mx = (a[0] + b[0]) / 2 - nx * dep / 2, mz = (a[1] + b[1]) / 2 - nz * dep / 2;
      bm(M.clone().multiply(new THREE.Matrix4().makeTranslation(mx, by0 + bh / 2, mz)).multiply(new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-uz, 0, ux))), L, dep);
    }
  } else if (!p.poly) {
    const bs = benchSide(p); const bw = Math.min(p.benchW || 15, w - 6); const RB = 18; const T2 = (lx: number, lz: number) => M.clone().multiply(new THREE.Matrix4().makeTranslation(lx, by0 + bh / 2, lz));
    if (bs === 'left') bm(T2(bw / 2 - w / 2, -0.5), bw, dp - 1);
    else if (bs === 'right') bm(T2(w / 2 - bw / 2, -0.5), bw, dp - 1);
    else if (bs === 'cornerL') bm(T2(RB / 2 - w / 2, RB / 2 - dp / 2), RB, RB);
    else if (bs === 'cornerR') bm(T2(w / 2 - RB / 2, RB / 2 - dp / 2), RB, RB);
  }
}

/** A custom piece: each part is its footprint pushed straight up from its underside to its top. */
function customPiece3d(g: THREE.Group, it: DItem, M: THREE.Matrix4) {
  const v = customOf(it); const w = it.w, dp = it.d;
  for (const pt of v.parts) {
    const [z0, z1] = partZ(pt, v); if (z1 - z0 < 0.05) continue;
    const sh = new THREE.Shape(partPoly(pt, v).map(q => new THREE.Vector2(q[0] - w / 2, -(q[1] - dp / 2))));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: z1 - z0, bevelEnabled: false }); geo.rotateX(-Math.PI / 2); geo.translate(0, z0, 0);
    const m = new THREE.Mesh(geo, mat(pt.color)); m.matrixAutoUpdate = false; m.matrix.copy(M); g.add(m);
  }
}

/** The tiled corner storage unit: a toe recess, a raised bottom shelf, middle shelves, a top panel, end returns, and a granite top. */
function cornerUnit3d(g: THREE.Group, it: DItem, M: THREE.Matrix4, d: Design) {
  const c = cuOf(it); const w = it.w, dp = it.d; const tile = it.p?.tileColor || '#e6e2d6'; const granite = colorPaint(it.p?.tcolor || d.counter?.color)?.fill || '#b7b4ac'; const TH = 1;
  const slab = (poly: Array<[number, number]>, y0: number, t: number, color: string) => {
    const sh = new THREE.Shape(dedupe(poly).map(q => new THREE.Vector2(q[0] - w / 2, -(q[1] - dp / 2))));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false }); geo.rotateX(-Math.PI / 2); geo.translate(0, y0, 0);
    const m = new THREE.Mesh(geo, mat(color)); m.matrixAutoUpdate = false; m.matrix.copy(M); g.add(m);
  };
  const poly = cornerPoly(c);
  slab(insetPoly(c), 0, c.lift, tile);                    // toe recess under the bottom shelf
  slab(poly, c.lift, TH, tile);                           // bottom shelf, raised off the floor
  midShelves(c, TH).forEach(y => slab(poly, y, TH, tile)); // middle shelves
  slab(poly, c.h - TH, TH, tile);                         // underside of the top
  slab(topPoly(c), c.h, c.topT, granite);                 // granite top, slightly past the face
  const cx = poly.reduce((s, q) => s + q[0], 0) / poly.length, cy = poly.reduce((s, q) => s + q[1], 0) / poly.length;
  const wing = (a: [number, number], b: [number, number]) => { // an end panel across the pocket ends
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1) return; const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    let nx = uz, nz = -ux; if (nx * ((a[0] + b[0]) / 2 - cx) + nz * ((a[1] + b[1]) / 2 - cy) > 0) { nx = -nx; nz = -nz; } // push it inward
    const mx = (a[0] + b[0]) / 2 + nx * 0.75 - w / 2, mz = (a[1] + b[1]) / 2 + nz * 0.75 - dp / 2; const hh = c.h - c.lift;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(L, hh, 1.5), mat(tile)); mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(M.clone().multiply(new THREE.Matrix4().makeTranslation(mx, c.lift + hh / 2, mz)).multiply(new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-uz, 0, ux)))); g.add(mesh);
  };
  if (c.r > 1) { wing([c.a, 0], [c.a, c.r]); wing([c.r, c.a], [0, c.a]); }
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; el.appendChild(renderer.domElement); renderer.domElement.style.display = 'block';
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#e6e9e4');
    scene.add(new THREE.HemisphereLight('#ffffff', '#b8b4a8', 1.35)); const sun = new THREE.DirectionalLight('#ffffff', 1.9); sun.position.set(200, 400, 150); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -450; sc.right = 450; sc.top = 450; sc.bottom = -450; sc.near = 50; sc.far = 1500; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5; sun.shadow.radius = 3; scene.add(sun); scene.add(sun.target);
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
    try { t.room = buildRoom(design, ceiling); t.scene.add(t.room); const sn = t.scene.children.find(o => (o as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight | undefined; if (sn && design.pts.length) { const cx = design.pts.reduce((a, p) => a + p.x, 0) / design.pts.length, cz = design.pts.reduce((a, p) => a + p.y, 0) / design.pts.length; sn.position.set(cx + 200, 400, cz + 150); sn.target.position.set(cx, 0, cz); sn.target.updateMatrixWorld(); } } catch (e) { setErr('Could not build the 3D room: ' + (e instanceof Error ? e.message : String(e))); return; }
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
