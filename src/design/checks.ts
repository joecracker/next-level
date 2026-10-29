// The robot check: reads the drawing and flags things that will not work or break code.
// ok = nothing said, tight = legal but cramped, fix = should be changed. Tim can "keep it anyway".
import { KINDS, benchSide, corners, frame, fmtIn, inPoly, overlap, ray, segsOf, toWorld, type DItem, type Design } from './model';

export interface Check { id: string; itemId?: string; lvl: 'tight' | 'fix'; title: string; detail: string }

export function runChecks(d: Design): Check[] {
  const out: Check[] = [];
  const bath = d.mode === 'bath';
  const flo = segsOf(d, ['floor']);
  const items = d.items;
  const F = (it: DItem) => frame(it, d.pts);
  const add = (id: string, it: DItem | undefined, lvl: 'tight' | 'fix', title: string, detail: string) => out.push({ id: `${id}:${it?.id || ''}`, itemId: it?.id, lvl, title, detail });
  const nm = (it: DItem) => it.label || KINDS[it.kind].name;
  const clear = (it: DItem, lx: number, ly: number, dx: number, dy: number, f = F(it)) => {
    const o = toWorld(it, f, lx, ly); const segs = segsOf(d, ['floor'], it.id);
    return ray(o[0], o[1], dx, dy, segs);
  };

  for (const it of items) {
    const k = KINDS[it.kind]; const f = F(it); const p = it.p || {};
    // things outside the room
    if (k.layer === 'floor' && it.wall === null && !['kneewall', 'partition'].includes(it.kind)) {
      if (!inPoly(f.cx, f.cy, d.pts)) add('out', it, 'fix', `${nm(it)} is outside the walls`, 'Drag it back inside the room.');
    }
    if (it.kind === 'toilet') {
      const side = (sx: number) => { const r = clear(it, it.w / 2, it.d / 2, f.ux * sx, f.uy * sx, f) ; return r - it.w / 2; };
      const sl = Math.min(side(-1), side(1));
      if (sl < 15) add('wcside', it, 'fix', 'Toilet too close to the side', `${fmtIn(sl)} from the center to a wall or fixture - code needs 15" each side.`);
      else if (sl < 18) add('wcside', it, 'tight', 'Toilet side room is tight', `${fmtIn(sl)} each side; 18" is more comfortable.`);
      const fr = clear(it, it.w / 2, it.d, f.nx, f.ny, f);
      if (fr < 21) add('wcfront', it, 'fix', 'Not enough room in front of the toilet', `${fmtIn(fr)} clear; code needs 21".`);
      else if (fr < 30) add('wcfront', it, 'tight', 'Room in front of the toilet is tight', `${fmtIn(fr)} clear; 30" is comfortable.`);
    }
    if (it.kind === 'vanity' || it.kind === 'pedestal') {
      const fr = clear(it, it.w / 2, it.d, f.nx, f.ny, f);
      if (fr < 21) add('vfront', it, 'fix', `Not enough room in front of the ${KINDS[it.kind].name.toLowerCase()}`, `${fmtIn(fr)} clear; needs 21".`);
      else if (fr < 30) add('vfront', it, 'tight', 'Room in front of the sink is tight', `${fmtIn(fr)} clear.`);
      if (it.kind === 'vanity' && p.sinks === 2 && it.w < 48) add('v2', it, 'fix', 'Two sinks need a wider vanity', `Needs at least 4'-0", this is ${fmtIn(it.w)}.`);
    }
    if (it.kind === 'shower') {
      if (p.walls === 'wetwall' && p.unit !== 'base') add('wetbase', it, 'fix', 'Wet wall panels need a Kohler base', 'Swap this for a Kohler shower base from Add, Plumbing.');
      if (it.w < 30 || it.d < 30) add('shsize', it, 'fix', 'Shower is too small', `Inside must be at least 30" x 30" (this is ${fmtIn(it.w)} x ${fmtIn(it.d)}).`);
      else if (it.w < 32 || it.d < 32) add('shsize', it, 'tight', 'Shower is the bare minimum', 'Inside 32" x 32" is more comfortable.');
      const side = (s: string) => p[s];
      const open = (s: string) => p[s] === 'open' || p[s] === 'glass' || p[s] === 'knee';
      if (!p.free) {
        const entryOk = p.entry === 'front' ? (p.front !== 'wall') : p.entry === 'left' ? p.left !== 'wall' || true : true;
        if (p.entry === 'front' && p.front === 'wall') add('shway', it, 'fix', 'No way into the shower', 'The front is solid wall. Make it glass or open.');
        void side; void entryOk;
        const fr = clear(it, it.w / 2, it.d + 0.5, f.nx, f.ny, f);
        if (fr < 24) add('shfront', it, 'fix', 'Not enough room outside the shower', `${fmtIn(fr)} to the next wall or fixture; needs 24".`);
        else if (fr < 30) add('shfront', it, 'tight', 'Room outside the shower is tight', `${fmtIn(fr)} clear; 30" is comfortable.`);
        const valveOnOpen = p.valve === 'left' ? open('left') : p.valve === 'right' ? open('right') : false;
        if (valveOnOpen) add('shvalve', it, 'fix', 'Valve is on an open side', 'The controls need a wall to mount on.');
        if (p.valve === 'left' && p.left === 'wall' && false) void 0;
      }
      const bs = benchSide(p);
      if (bs === 'left' || bs === 'right') {
        const stand = it.w - Math.min(p.benchW || 15, it.w);
        if (stand < 30) add('shbench', it, 'tight', 'Bench leaves little standing room', `${fmtIn(stand)} left to stand in; 30" is comfortable.`);
        if (p.valve === bs) add('shbv', it, 'tight', 'Valve is over the bench', 'The valve ends up behind the seated person. Move it to the other side.');
        if (!p.curb && false) void 0;
      }
      if (p.niche === 'left' && p.left !== 'wall') add('shniche', it, 'fix', 'Niche is on an open side', 'A niche needs a solid wall.');
      if (p.niche === 'right' && p.right !== 'wall') add('shniche', it, 'fix', 'Niche is on an open side', 'A niche needs a solid wall.');
      if (!items.some(o => o.kind === 'wet' || o.kind === 'fan') && false) void 0;
    }
    if (it.kind === 'door' && it.wall !== null && ['swing', 'double'].includes(it.p?.type || 'swing')) {
      const c = swingBox(it, d);
      if (c) for (const o of items) {
        if (o.id === it.id || KINDS[o.kind].layer !== 'floor' || o.kind === 'shower') continue;
        if (overlap(c, corners(o, F(o)))) { add('swing', it, 'fix', 'Door swing hits something', `The door swings into the ${nm(o).toLowerCase()}. Flip the hinge or swing, or move it.`); break; }
      }
    }
    if (['outlet', 'gfci', 'switch'].includes(it.kind)) {
      const nearShower = items.some(o => (o.kind === 'shower' || o.kind === 'tub') && Math.hypot(f.cx - F(o).cx, f.cy - F(o).cy) < Math.max(o.w, o.d) / 2 + 36 && inside(o, d, f.cx + f.nx * 8, f.cy + f.ny * 8, 36));
      if (nearShower) add('wet', it, 'fix', `${nm(it)} is too close to the ${items.find(o => o.kind === 'shower') ? 'shower' : 'tub'}`, 'Keep switches and outlets out of the wet zone (about 3 feet).');
      if (bath && it.kind === 'outlet') add('gfci', it, 'fix', 'Bathroom outlets must be GFCI', 'Change this to a GFCI outlet.');
    }
  }
  // overlaps between floor items (not walls, not riders)
  const fl = items.filter(it => KINDS[it.kind].layer === 'floor');
  for (let i = 0; i < fl.length; i++) for (let j = i + 1; j < fl.length; j++) {
    const a = fl[i], b = fl[j];
    if (['kneewall', 'partition'].includes(a.kind) || ['kneewall', 'partition'].includes(b.kind)) continue;
    if (overlap(corners(a, F(a)), corners(b, F(b)))) add('hit', a, 'fix', `${nm(a)} overlaps ${nm(b).toLowerCase()}`, 'Two things are in the same spot.');
  }
  // room-level
  if (bath) {
    const vans = items.filter(o => o.kind === 'vanity' || o.kind === 'pedestal');
    for (const v of vans) {
      const fv = F(v); const near = items.some(o => ['outlet', 'gfci'].includes(o.kind) && Math.hypot(F(o).cx - fv.cx, F(o).cy - fv.cy) <= 36 + v.w / 2);
      if (!near) add('nooutlet', v, 'tight', 'No outlet within 3 feet of the sink', 'Add a GFCI outlet beside the vanity.');
    }
    if (!items.some(o => o.kind === 'fan')) out.push({ id: 'nofan:', lvl: 'tight', title: 'No exhaust fan', detail: 'A bathroom needs a vent fan. Add one under Electrical.' });
  } else {
    const dw = items.find(o => o.kind === 'dw'), sk = items.find(o => o.kind === 'sinkbase');
    for (const r of items.filter(o => o.kind === 'range' && o.p?.fuel === 'electric')) if (!items.some(o => o.kind === 'out240')) { add('no240', r, 'tight', 'No 240V outlet for the range', 'An electric range needs its own 240V outlet. Add one under Electrical.'); break; }
    if (dw && sk) { const a = F(dw), b = F(sk); if (Math.hypot(a.cx - b.cx, a.cy - b.cy) > 48) add('dwsink', dw, 'tight', 'Dishwasher is far from the sink', 'Keep it next to the sink base if you can.'); }
    for (const isl of items.filter(o => o.kind === 'island')) {
      const f = F(isl); const segs = segsOf(d, ['floor'], isl.id);
      const dirs: Array<[number, number, number]> = [[1, 0, isl.w / 2], [-1, 0, isl.w / 2], [0, 1, isl.d / 2], [0, -1, isl.d / 2]];
      for (const [dx, dy, half] of dirs) {
        const o = toWorld(isl, f, isl.w / 2 + dx * (isl.w / 2 + 0.2), isl.d / 2 + dy * (isl.d / 2 + 0.2)); void half;
        const r = ray(o[0], o[1], dx, dy, segs);
        if (r < 36) { add('aisle', isl, 'fix', 'Aisle around the island is too narrow', `${fmtIn(r)} on one side; needs 36".`); break; }
        if (r < 42) { add('aisle', isl, 'tight', 'Aisle around the island is tight', `${fmtIn(r)} on one side; 42" is comfortable.`); break; }
      }
    }
  }
  return out.filter(c => !d.accepted?.[c.id]);
}

function inside(shower: DItem, d: Design, x: number, y: number, pad: number): boolean {
  const f = frame(shower, d.pts); const lx = (x - f.cx) * f.ux + (y - f.cy) * f.uy, ly = (x - f.cx) * f.nx + (y - f.cy) * f.ny;
  return Math.abs(lx) <= shower.w / 2 + pad && Math.abs(ly) <= shower.d / 2 + pad;
}
/** The floor patch a door sweeps when it opens. */
function swingBox(it: DItem, d: Design): Array<[number, number]> | null {
  const f = frame(it, d.pts); const w = it.w; const dir = it.swing === 'out' ? -1 : 1;
  const hx = it.hinge === 'right' ? w / 2 : -w / 2;
  const x0 = Math.min(hx, hx - Math.sign(hx) * w), x1 = Math.max(hx, hx - Math.sign(hx) * w);
  const y0 = dir > 0 ? 0 : -w, y1 = dir > 0 ? w : 0; // measured from the wall line, into the room when dir > 0
  const P = (lx: number, ly: number): [number, number] => [f.cx + f.ux * lx + f.nx * ly, f.cy + f.uy * lx + f.ny * ly];
  return [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
}
