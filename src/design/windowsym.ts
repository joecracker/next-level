// The plan symbol for each kind of window, drawn in the window's own box:
// x runs along the wall (-w/2 .. w/2), y runs across it (negative = outside, positive = the room).
import type { DItem } from './model';

const n = (v: number) => String(Math.round(v * 100) / 100);

export function windowSymbol(it: DItem, S: number, stroke: string, strokeW: number): string {
  const hw = it.w / 2, hd = it.d / 2; const t = it.p?.wtype || 'dh'; const sw = 1.5 / S;
  const fill = t === 'picture' ? '#e3eef3' : t === 'block' ? '#dfe5e8' : '#ffffff';
  const ln = (x1: number, y1: number, x2: number, y2: number, extra = '', w = sw) =>
    '<line x1="' + n(x1) + '" y1="' + n(y1) + '" x2="' + n(x2) + '" y2="' + n(y2) + '" stroke="' + stroke + '" stroke-width="' + n(w) + '" ' + extra + '/>';
  const dash = 'stroke-dasharray="' + n(4 / S) + ' ' + n(3 / S) + '"';
  let o = '<rect x="' + n(-hw) + '" y="' + n(-hd) + '" width="' + n(it.w) + '" height="' + n(it.d) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + n(strokeW) + '"/>';
  if (t === 'dh' || t === 'sh') o += ln(-hw, 0, hw, 0);
  else if (t === 'slider') o += ln(-hw, -hd / 2, hw * 0.1, -hd / 2) + ln(-hw * 0.1, hd / 2, hw, hd / 2);
  else if (t === 'casement') { const r = Math.min(it.w * 0.45, 16); o += ln(-hw, 0, hw, 0) + ln(-hw, -hd, -hw, -hd - r, dash) + ln(-hw, -hd - r, hw, -hd, dash); }
  else if (t === 'awning') { const r = Math.min(it.w * 0.25, 8); o += ln(-hw, 0, hw, 0) + ln(-hw, -hd, 0, -hd - r, dash) + ln(0, -hd - r, hw, -hd, dash); }
  else if (t === 'garden') { const r = 8; o += '<rect x="' + n(-hw) + '" y="' + n(-hd - r) + '" width="' + n(it.w) + '" height="' + n(r) + '" fill="#e3eef3" stroke="' + stroke + '" stroke-width="' + n(sw) + '" ' + dash + '/>' + ln(-hw, 0, hw, 0); }
  else if (t === 'block') { for (let x = -hw + 8; x < hw - 0.5; x += 8) o += ln(x, -hd, x, hd, '', 0.8 / S); }
  // picture: just the pane, no center line
  return o;
}
