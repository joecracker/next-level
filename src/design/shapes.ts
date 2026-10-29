// Drawings for the fixtures that have more to them than a labelled box: showers, tubs, toilets, vanities,
// in-wall outlets and switches, ceiling items. Each is drawn in the item's own box: (0,0) is its back-left
// corner against the wall, x runs along the wall, y runs out into the room. S = pixels per inch.
import { T, benchSide, polyArea, type DItem } from './model';

const INK = '#14191A', GL = '#3f8fa8', CURB = '#9ea49a', BRASS = '#9a7a2c', TILE = '#b9c0b6';
const f = (n: number) => Math.round(n * 100) / 100;
const rect = (x: number, y: number, w: number, h: number, a: string) => `<rect x="${f(x)}" y="${f(y)}" width="${f(Math.max(0, w))}" height="${f(Math.max(0, h))}" ${a}/>`;
const line = (x1: number, y1: number, x2: number, y2: number, a: string) => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" ${a}/>`;
const circ = (cx: number, cy: number, r: number, a: string) => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" ${a}/>`;
const ell = (cx: number, cy: number, rx: number, ry: number, a: string) => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" ${a}/>`;
const txt = (s: string, x: number, y: number, size: number, fill = INK, anchor = 'middle') => `<text x="${f(x)}" y="${f(y + size * 0.35)}" font-size="${f(size)}" text-anchor="${anchor}" fill="${fill}">${s}</text>`;

function polyShower(it: DItem, S: number, fs: number): string {
  const p = it.p || {}; const poly = p.poly as Array<[number, number]>; const line1 = 1.5 / S;
  const pts = poly.map(q => `${f(q[0])},${f(q[1])}`).join(' '); const id = 'pf' + String(it.id).replace(/[^a-zA-Z0-9]/g, '');
  const o: string[] = [`<polygon points="${pts}" fill="#eceee8"/>`];
  if (p.tile) {
    const TS = ({ '2': [2, 2], '12': [12, 12], '12x24': [12, 24], '24': [24, 24] } as Record<string, number[]>)[p.tileSize || '12'] || [12, 12];
    if (TS[0] * S >= 5 && TS[1] * S >= 5) {
      const g: string[] = [];
      for (let x = TS[0]; x < it.w - 0.01; x += TS[0]) g.push(line(x, 0, x, it.d, `stroke="${TILE}" stroke-width="${0.8 / S}"`));
      for (let y = TS[1]; y < it.d - 0.01; y += TS[1]) g.push(line(0, y, it.w, y, `stroke="${TILE}" stroke-width="${0.8 / S}"`));
      o.push(`<clipPath id="${id}"><polygon points="${pts}"/></clipPath><g clip-path="url(#${id})">${g.join('')}</g>`);
    }
  }
  o.push(`<polygon points="${pts}" fill="none" stroke="${p.curb ? CURB : '#9aa09a'}" stroke-width="${(p.curb ? 4 : 1.5) / S}" stroke-linejoin="round"/>`);
  o.push(`<polygon points="${pts}" fill="none" stroke="${INK}" stroke-width="${line1}" stroke-linejoin="round"/>`);
  const cx = poly.reduce((a, q) => a + q[0], 0) / poly.length, cy = poly.reduce((a, q) => a + q[1], 0) / poly.length;
  o.push(circ(cx, cy - 6, 2.5, `fill="#fff" stroke="${INK}" stroke-width="${line1}"`) + circ(cx, cy - 6, 0.9, `fill="${INK}"`));
  o.push(txt('SHOWER FLOOR', cx, cy + 2, fs * 0.9, '#333') + txt(`${Math.round(polyArea(poly) / 14.4) / 10} sq ft`, cx, cy + 2 + fs * 1.1, fs * 0.8, '#555'));
  return o.join('');
}

function shower(it: DItem, S: number, fs: number, stroke: string, sw: number): string {
  if (it.p?.poly) return polyShower(it, S, fs);
  const p = it.p || {}; const w = it.w, d = it.d, curb = !!p.curb; const E = 24;
  const dw = Math.min(p.doorW || 30, w, d);
  const o: string[] = [];
  o.push(rect(0, 0, w, d, `fill="#eceee8"`));
  if (p.tile) { // tile lines
    const TS = ({ '2': [2, 2], '12': [12, 12], '12x24': p.tileDir === 'h' ? [24, 12] : [12, 24], '24': [24, 24] } as Record<string, number[]>)[p.tileSize || '12'] || [12, 12];
    if (TS[0] * S >= 5 && TS[1] * S >= 5) {
      for (let x = TS[0]; x < w - 0.01; x += TS[0]) o.push(line(x, 0, x, d, `stroke="${TILE}" stroke-width="${0.8 / S}"`));
      for (let y = TS[1]; y < d - 0.01; y += TS[1]) o.push(line(0, y, w, y, `stroke="${TILE}" stroke-width="${0.8 / S}"`));
    }
  }
  const line1 = 1.5 / S;
  const bs = benchSide(p), bw = Math.min(p.benchW || 15, w - 6), RB = 18;
  const BTOP = p.benchTop === 'granite' ? '#d9d3c7' : '#cfd3cb';
  if (bs === 'left') { o.push(rect(0, 0, bw, d - 1, `fill="${BTOP}" stroke="${INK}" stroke-width="${line1}"`) + txt('BENCH', bw / 2, d / 2, fs * 0.8, '#555')); }
  else if (bs === 'right') { o.push(rect(w - bw, 0, bw, d - 1, `fill="${BTOP}" stroke="${INK}" stroke-width="${line1}"`) + txt('BENCH', w - bw / 2, d / 2, fs * 0.8, '#555')); }
  else if (bs === 'cornerL') o.push(`<path d="M0 0 H${RB} A${RB} ${RB} 0 0 1 0 ${RB} Z" fill="${BTOP}" stroke="${INK}" stroke-width="${line1}"/>`);
  else if (bs === 'cornerR') o.push(`<path d="M${w} 0 H${w - RB} A${RB} ${RB} 0 0 0 ${w} ${RB} Z" fill="${BTOP}" stroke="${INK}" stroke-width="${line1}"/>`);
  const SHF = 8;
  if ((p.shelves === 'bl' || p.shelves === 'both') && bs !== 'cornerL' && bs !== 'left') o.push(`<path d="M0 0 H${SHF} A${SHF} ${SHF} 0 0 1 0 ${SHF} Z" fill="#fff" stroke="${INK}" stroke-width="${line1}"/>`);
  if ((p.shelves === 'br' || p.shelves === 'both') && bs !== 'cornerR' && bs !== 'right') o.push(`<path d="M${w} 0 H${w - SHF} A${SHF} ${SHF} 0 0 0 ${w} ${SHF} Z" fill="#fff" stroke="${INK}" stroke-width="${line1}"/>`);
  const nw = Math.min(12, p.niche === 'back' ? w - 4 : d - 4), NT = 4, nStyle = `fill="#f6efe0" stroke="${BRASS}" stroke-width="${line1}"`;
  if (p.niche === 'back') o.push(rect((w - nw) / 2, 0, nw, NT, nStyle) + txt(`NICHE ${p.nicheH || 24}`, w / 2, NT + fs * 0.7, fs * 0.65, '#5c4614'));
  else if (p.niche === 'left') o.push(rect(0, (d - nw) / 2, NT, nw, nStyle));
  else if (p.niche === 'right') o.push(rect(w - NT, (d - nw) / 2, NT, nw, nStyle));

  const glassLine = (x1: number, y1: number, x2: number, y2: number) => line(x1, y1, x2, y2, `stroke="${GL}" stroke-width="${2 / S}"`);
  const H = (a: number, b: number, type: string) => {
    if (b - a < 0.2) return;
    if (type === 'wall') o.push(rect(a, d, b - a, T, `fill="${INK}"`));
    else if (type === 'knee') { o.push(rect(a, d - T / 2, b - a, T, `fill="#a4a99f"`)); o.push(glassLine(a, d, b, d)); }
    else if (type === 'glass') { if (curb) o.push(rect(a, d - 2, b - a, 4, `fill="${CURB}"`)); o.push(glassLine(a, d, b, d)); }
    else { if (curb) o.push(rect(a, d - 2, b - a, 4, `fill="${CURB}"`)); else o.push(line(a, d, b, d, `stroke="#777" stroke-width="${line1}" stroke-dasharray="${4 / S} ${3 / S}"`)); }
  };
  const V = (a: number, b: number, type: string, x: number, outLeft: boolean) => {
    if (b - a < 0.2) return;
    if (type === 'wall') o.push(rect(outLeft ? x - T : x, a, T, b - a, `fill="${INK}"`));
    else if (type === 'knee') { o.push(rect(x - T / 2, a, T, b - a, `fill="#a4a99f"`)); o.push(glassLine(x, a, x, b)); }
    else if (type === 'glass') { if (curb) o.push(rect(x - 2, a, 4, b - a, `fill="${CURB}"`)); o.push(glassLine(x, a, x, b)); }
    else { if (curb) o.push(rect(x - 2, a, 4, b - a, `fill="${CURB}"`)); else o.push(line(x, a, x, b, `stroke="#777" stroke-width="${line1}" stroke-dasharray="${4 / S} ${3 / S}"`)); }
  };
  const dashed = `fill="none" stroke="${GL}" stroke-width="${line1}" stroke-dasharray="${4 / S} ${3 / S}"`;
  const doorH = (a: number, b: number, hingeLeft: boolean) => {
    const ww = b - a;
    if (curb) o.push(rect(a, d - 2, ww, 4, `fill="${CURB}"`));
    if (p.door && p.doorType === 'slider') { o.push(glassLine(a, d - 1.4, a + ww * 0.55, d - 1.4)); o.push(glassLine(a + ww * 0.45, d + 0.8, b, d + 0.8)); }
    else if (p.door) {
      o.push(glassLine(a, d, b, d));
      if (hingeLeft) o.push(line(a, d, a, d + ww, `stroke="${GL}" stroke-width="${2 / S}"`) + `<path d="M${b} ${d} A${ww} ${ww} 0 0 1 ${a} ${d + ww}" ${dashed}/>`);
      else o.push(line(b, d, b, d + ww, `stroke="${GL}" stroke-width="${2 / S}"`) + `<path d="M${a} ${d} A${ww} ${ww} 0 0 0 ${b} ${d + ww}" ${dashed}/>`);
    } else if (!curb) o.push(line(a, d, b, d, `stroke="#777" stroke-width="${line1}" stroke-dasharray="${4 / S} ${3 / S}"`));
  };
  const doorV = (a: number, b: number, x: number, outRight: boolean) => {
    const ww = b - a;
    if (curb) o.push(rect(x - 2, a, 4, ww, `fill="${CURB}"`));
    if (p.door && p.doorType === 'slider') { o.push(glassLine(x - 1.4, a, x - 1.4, a + ww * 0.55)); o.push(glassLine(x + 0.8, a + ww * 0.45, x + 0.8, b)); }
    else if (p.door) {
      o.push(glassLine(x, a, x, b));
      if (outRight) o.push(line(x, b, x + ww, b, `stroke="${GL}" stroke-width="${2 / S}"`) + `<path d="M${x} ${a} A${ww} ${ww} 0 0 1 ${x + ww} ${b}" ${dashed}/>`);
      else o.push(line(x, b, x - ww, b, `stroke="${GL}" stroke-width="${2 / S}"`) + `<path d="M${x} ${a} A${ww} ${ww} 0 0 0 ${x - ww} ${b}" ${dashed}/>`);
    } else if (!curb) o.push(line(x, a, x, b, `stroke="#777" stroke-width="${line1}" stroke-dasharray="${4 / S} ${3 / S}"`));
  };
  if (p.free) o.push(rect(0, 0, w, d, `fill="none" stroke="#9aa09a" stroke-width="${line1}" stroke-dasharray="${5 / S} ${3 / S}"`));
  else if (p.entry === 'left') { H(0, w, p.front); V(0, d - dw, p.left, 0, true); doorV(d - dw, d, 0, false); V(0, d, p.right, w, false); }
  else if (p.entry === 'right') { H(0, w, p.front); V(0, d, p.left, 0, true); V(0, d - dw, p.right, w, false); doorV(d - dw, d, w, true); }
  else if (p.entry === 'cornerL') { H(E, w, p.front); V(0, d - E, p.left, 0, true); V(0, d, p.right, w, false); o.push(glassLine(0, d - E, E, d)); o.push(txt('WAY IN', E / 2, d - E / 2, fs * 0.6, '#555')); }
  else if (p.entry === 'cornerR') { H(0, w - E, p.front); V(0, d, p.left, 0, true); V(0, d - E, p.right, w, false); o.push(glassLine(w - E, d, w, d - E)); o.push(txt('WAY IN', w - E / 2, d - E / 2, fs * 0.6, '#555')); }
  else {
    if (p.doorPos === 'left') { doorH(0, dw, true); H(dw, w, p.front); }
    else if (p.doorPos === 'right') { H(0, w - dw, p.front); doorH(w - dw, w, false); }
    else { H(0, (w - dw) / 2, p.front); doorH((w - dw) / 2, (w + dw) / 2, true); H((w + dw) / 2, w, p.front); }
    V(0, d, p.left, 0, true); V(0, d, p.right, w, false);
  }
  const dr = p.drain; const dstyle = `fill="#fff" stroke="${INK}" stroke-width="${line1}"`;
  if (dr === 'center' || dr === 'endL' || dr === 'endR') { const cx = dr === 'center' ? w / 2 : dr === 'endL' ? 9 : w - 9; o.push(circ(cx, d / 2, 2.5, dstyle) + circ(cx, d / 2, 0.9, `fill="${INK}"`)); }
  else if (dr === 'trL') o.push(rect(3, 3, 3, d - 6, dstyle));
  else if (dr === 'trR') o.push(rect(w - 6, 3, 3, d - 6, dstyle));
  else o.push(rect(4, 2.5, w - 8, 3, dstyle));
  if (p.valve === 'back') o.push(rect(w / 2 - 3, 0, 6, 3, `fill="${INK}"`)); else if (p.valve === 'left') o.push(rect(0, d / 2 - 3, 3, 6, `fill="${INK}"`)); else o.push(rect(w - 3, d / 2 - 3, 3, 6, `fill="${INK}"`));
  if (p.valveType === 'slide') { if (p.valve === 'back') o.push(circ(w / 2 + 7.5, 2.3, 1.5, `fill="${GL}"`)); else if (p.valve === 'left') o.push(circ(2.3, d / 2 + 7.5, 1.5, `fill="${GL}"`)); else o.push(circ(w - 2.3, d / 2 + 7.5, 1.5, `fill="${GL}"`)); }
  o.push(txt(`${p.unit === 'sterling' ? 'STERLING' : p.unit === 'base' ? 'KOHLER BASE' : 'SHOWER'} ${Math.round(w * 10) / 10} × ${Math.round(d * 10) / 10}`, w / 2, d * 0.62, fs * (p.unit ? 0.85 : 1), '#333'));
  void stroke; void sw;
  return o.join('');
}

function tub(it: DItem, S: number, fs: number, stroke: string, sw: number): string {
  const w = it.w, d = it.d, p = it.p || {}; const left = (p.drain || 'left') === 'left';
  const line1 = 1.5 / S;
  let o = rect(0, 0, w, d, `fill="#f7f9f9" stroke="${stroke}" stroke-width="${sw}"`) +
    rect(3, 3, w - 6, d - 6, `rx="${Math.min(10, d / 3)}" fill="#ffffff" stroke="${INK}" stroke-width="${1 / S}"`) +
    circ(left ? 8 : w - 8, d / 2, 1.8, `fill="#fff" stroke="${INK}" stroke-width="${1 / S}"`);
  const nStyle = `fill="#f6efe0" stroke="${BRASS}" stroke-width="${line1}"`;
  if (p.niche === 'back') o += rect(w / 2 - 6, 0, 12, 4, nStyle);
  if (p.niche === 'left') o += rect(0, d / 2 - 6, 4, 12, nStyle);
  if (p.niche === 'right') o += rect(w - 4, d / 2 - 6, 4, 12, nStyle);
  const SHF = 8;
  if (p.shelves === 'bl' || p.shelves === 'both') o += `<path d="M0 0 H${SHF} A${SHF} ${SHF} 0 0 1 0 ${SHF} Z" fill="#fff" stroke="${INK}" stroke-width="${line1}"/>`;
  if (p.shelves === 'br' || p.shelves === 'both') o += `<path d="M${w} 0 H${w - SHF} A${SHF} ${SHF} 0 0 0 ${w} ${SHF} Z" fill="#fff" stroke="${INK}" stroke-width="${line1}"/>`;
  if (p.door) { o += line(w * 0.05, d, w * 0.55, d - 1.2, `stroke="${GL}" stroke-width="${2 / S}"`) + line(w * 0.45, d + 1.2, w * 0.95, d, `stroke="${GL}" stroke-width="${2 / S}"`); }
  return o + txt(p.unit === 'sterling' ? `STERLING ${w} × ${d}` : 'TUB', w / 2, d / 2, fs * 0.9, '#333');
}
function ftub(it: DItem, S: number, fs: number, stroke: string, sw: number): string {
  const w = it.w, d = it.d;
  return rect(0, 0, w, d, `rx="${d / 2}" fill="#ffffff" stroke="${stroke}" stroke-width="${sw}"`) +
    rect(3, 3, w - 6, d - 6, `rx="${(d - 6) / 2}" fill="#f4f7f7" stroke="${INK}" stroke-width="${1 / S}"`) +
    circ(w * 0.18, d / 2, 1.8, `fill="#fff" stroke="${INK}" stroke-width="${1 / S}"`) + txt(`FREESTANDING ${w}"`, w / 2, d / 2, fs * 0.8, '#333');
}
function toilet(it: DItem, S: number, fs: number, stroke: string, sw: number): string {
  const w = it.w, d = it.d; const round = it.p?.bowl === 'round';
  const ry = round ? d * 0.3 : d * 0.36, cy = d * 0.28 + ry;
  return rect(1, 0, w - 2, d * 0.28, `rx="2" fill="#fff" stroke="${stroke}" stroke-width="${sw}"`) +
    ell(w / 2, cy, w * 0.42, ry, `fill="#fff" stroke="${stroke}" stroke-width="${sw}"`) +
    ell(w / 2, cy + 1, w * 0.28, ry * 0.7, `fill="none" stroke="${INK}" stroke-width="${0.8 / S}"`) + (w * S > 40 ? txt(round ? 'WC' : 'WC', w / 2, d + fs * 0.9, fs * 0.8, '#555') : '');
}
function vanity(it: DItem, S: number, fs: number, stroke: string, sw: number, label: string): string {
  const w = it.w, d = it.d; const n = it.p?.sinks === 2 ? 2 : 1; const sinks = n === 2 ? [w / 4, w * 3 / 4] : [w / 2];
  let o = rect(0, 0, w, d, `fill="#e9d8b8" stroke="${stroke}" stroke-width="${sw}"`);
  for (const cx of sinks) {
    o += ell(cx, d * 0.5, Math.min(w / (n * 2) - 1.5, 9), Math.min(d * 0.28, 6), `fill="#fff" stroke="${INK}" stroke-width="${1 / S}"`);
    o += circ(cx, 3.2, 0.9, `fill="${INK}"`);
  }
  o += line(1, d - 1.8 / S, w - 1, d - 1.8 / S, `stroke="${INK}" stroke-width="${3.4 / S}" stroke-linecap="round"`); // the doors face the room
  if (label && w * S > label.length * 6.4 + 4) o += txt(label, w / 2, d - fs * 0.9, fs * 0.85);
  return o;
}
function pedestal(it: DItem, S: number, fs: number, stroke: string, sw: number): string {
  const w = it.w, d = it.d;
  return ell(w / 2, d / 2, w / 2, d / 2, `fill="#fff" stroke="${stroke}" stroke-width="${sw}"`) + ell(w / 2, d * 0.5, w * 0.3, d * 0.28, `fill="none" stroke="${INK}" stroke-width="${1 / S}"`) + circ(w / 2, 3.5, 0.9, `fill="${INK}"`) + (w * S > 44 ? txt('PEDESTAL', w / 2, d + fs * 0.9, fs * 0.75, '#555') : '');
}


/** Doors, drawn centred on the wall line: +y is the room side. type: swing | double | pocket | barn | bifold | opening */
function doorShape(it: DItem, S: number, stroke: string, strokeW: number): string {
  const w = it.w, hw = w / 2, hd = it.d / 2; const sw = 1.5 / S; const type = it.p?.type || 'swing';
  const sgn = it.swing === 'out' ? -1 : 1; const y0 = sgn * (T / 2);
  const right = it.hinge === 'right';
  const dash = `stroke-dasharray="${4 / S} ${3 / S}"`;
  let o = rect(-hw, -hd, w, it.d, `fill="#ffffff"`);
  const jamb = line(-hw, -hd, -hw, hd, `stroke="${stroke}" stroke-width="${strokeW}"`) + line(hw, -hd, hw, hd, `stroke="${stroke}" stroke-width="${strokeW}"`);
  const arc = (hx: number, ox: number, r: number, sweepFlag: number) => `<path d="M ${f(ox)} ${f(y0)} A ${f(r)} ${f(r)} 0 0 ${sweepFlag} ${f(hx)} ${f(y0 + sgn * r)}" fill="none" stroke="${stroke}" stroke-width="${sw}" ${dash}/>`;
  if (type === 'opening') {
    o += jamb + line(-hw, 0, hw, 0, `stroke="#999" stroke-width="${sw}" ${dash}`);
  } else if (type === 'double') {
    const r = w / 2;
    o += line(-hw, y0, -hw, y0 + sgn * r, `stroke="${stroke}" stroke-width="${strokeW}"`) + line(hw, y0, hw, y0 + sgn * r, `stroke="${stroke}" stroke-width="${strokeW}"`);
    o += arc(-hw, 0, r, sgn > 0 ? 0 : 1) + arc(hw, 0, r, sgn > 0 ? 1 : 0) + jamb;
  } else if (type === 'pocket') {
    const x1 = right ? hw : -hw, x2 = right ? hw - w * 0.9 : -hw + w * 0.9;
    o += rect(Math.min(x1, x2), -hd + 0.5, Math.abs(x2 - x1), it.d - 1, `fill="none" stroke="${stroke}" stroke-width="${sw}" ${dash}`) + jamb;
    o += line(x1, 0, x2, 0, `stroke="${stroke}" stroke-width="${strokeW}"`) + txt('POCKET', 0, sgn * (hd + fsOf(S) * 0.9), fsOf(S) * 0.8, '#555');
  } else if (type === 'barn') {
    const px = right ? -hw : hw - w; // panel sits on the room side, rides past the opening
    const py = sgn * (hd + 1);
    o += jamb + rect(px - (right ? w * 0.05 : 0) , sgn > 0 ? py : py - 2, w, 2, `fill="#b08a55" stroke="${stroke}" stroke-width="${sw}"`) + line(-hw - 4, sgn * (hd + 4), hw + w + 4, sgn * (hd + 4), `stroke="#777" stroke-width="${sw}" ${dash}`) + txt('BARN', 0, sgn * (hd + 10), fsOf(S) * 0.8, '#555');
  } else if (type === 'bifold') {
    const q = w / 4;
    o += jamb + `<polyline points="${-hw},${f(y0)} ${f(-hw + q * 0.7)},${f(y0 + sgn * q)} ${f(0)},${f(y0)} ${f(q * 0.7)},${f(y0 + sgn * q)} ${hw},${f(y0)}" fill="none" stroke="${stroke}" stroke-width="${strokeW}"/>`;
  } else { // swing
    const hx = right ? hw : -hw, ox = right ? -hw : hw;
    o += line(hx, y0, hx, y0 + sgn * w, `stroke="${stroke}" stroke-width="${strokeW}"`) + arc(hx, ox, w, (sgn > 0) === right ? 1 : 0) + jamb;
  }
  return o;
}
const fsOf = (S: number) => 12 / S;

/** Returns the drawing for kinds that have their own look, or null for plain boxes. */
export function fixtureShape(it: DItem, S: number, fs: number, stroke: string, sw: number, label: string): string | null {
  const w = it.w, d = it.d;
  const body = (() => {
    switch (it.kind) {
      case 'door': return doorShape(it, S, stroke, sw);
      case 'kneewall': return rect(0, 0, w, d, `fill="#a4a99f" stroke="${stroke}" stroke-width="${sw}"`) + (w * S > 40 ? txt(`KNEE ${Math.round(it.p?.height ?? 36)}"`, w / 2, d / 2, Math.min(fs * 0.7, d), '#222') : '');
      case 'partition': return rect(0, 0, w, d, `fill="${INK}" stroke="${stroke}" stroke-width="${sw}"`);
      case 'shower': return shower(it, S, fs, stroke, sw);
      case 'ftub': return ftub(it, S, fs, stroke, sw);
      case 'tub': return tub(it, S, fs, stroke, sw);
      case 'toilet': return toilet(it, S, fs, stroke, sw);
      case 'vanity': return vanity(it, S, fs, stroke, sw, label);
      case 'pedestal': return pedestal(it, S, fs, stroke, sw);
      case 'fan': return rect(0, 0, w, d, `fill="#fff" stroke="${stroke}" stroke-width="${sw}"`) + circ(w / 2, d / 2, w * 0.36, `fill="none" stroke="${INK}" stroke-width="${1 / S}"`) + txt('FAN', w / 2, d + fs * 0.9, fs * 0.8, '#555');
      case 'can': return circ(w / 2, d / 2, w / 2, `fill="#fff" stroke="${stroke}" stroke-width="${sw}"`) + circ(w / 2, d / 2, 0.9, `fill="${INK}"`);
      case 'wet': return circ(w / 2, d / 2, w / 2, `fill="#fff" stroke="${GL}" stroke-width="${sw}"`) + txt('WET', w / 2, d + fs * 0.9, fs * 0.7, '#555');
      case 'pendant': return circ(w / 2, d / 2, w / 2, `fill="#fff" stroke="${stroke}" stroke-width="${sw}"`) + circ(w / 2, d / 2, w * 0.33, `fill="none" stroke="${INK}" stroke-width="${1 / S}"`);
      case 'soffit': return rect(0, 0, w, d, `fill="rgba(160,138,88,0.14)" stroke="${stroke === INK ? '#8a6d2f' : stroke}" stroke-width="${2 / S}" stroke-dasharray="${6 / S} ${4 / S}"`) + txt(`SOFFIT ${Math.round(it.p?.drop ?? 12)}" DROP`, w / 2, d / 2, fs * 0.85, '#5c4614');
      case 'outlet': case 'gfci': case 'switch': {
        const g = it.kind === 'gfci' ? 'GFCI' : it.kind === 'switch' ? (it.p?.gang > 1 ? `S${it.p.gang}` : 'S') : 'O';
        return rect(-w / 2 + w / 2, 0, w, d, `fill="#fff" stroke="${stroke}" stroke-width="${sw}"`) + txt(g, w / 2, d + fs * 0.85, fs * 0.8, '#222');
      }
      default: return null;
    }
  })();
  if (body === null) return null;
  if (it.kind === 'door') return body;
  return `<g transform="translate(${-w / 2} ${-d / 2})">${body}</g>`;
}
