// Cabinet finishes by maker and line, so the takeoff can carry the maker's own finish name. Names come from
// Homecrest's June 2026 Price and Specification Guide (finish availability pages) and from Wellborn's published
// Select and Premier finish lists. The shade shown on screen is a close guess, NOT the maker's exact color:
// always confirm against the maker's sample.
import type { Swatch } from './finishes';

const sh = (hex: string, f: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return '#' + [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)].map(v => v.toString(16).padStart(2, '0')).join('');
};

// Approximate shades by finish name (shared where the names repeat across makers).
const HEX: Record<string, string> = {
  // stains
  Natural: '#d9b985', Light: '#d6b27a', Medium: '#b98b4e', Dark: '#6b4a32', Ginger: '#c08a3e', Caramel: '#a9743f', Honey: '#c99a5b',
  Sable: '#5b3d2b', Shale: '#8d8478', Boardwalk: '#c9b79a', 'River Rock': '#9a8e80', Drift: '#a89f94', Peppermill: '#5d4a3f', Castle: '#7c7064',
  Gauntlet: '#4e4640', Sienna: '#6a3f2a', Espresso: '#3e2b20', Coffee: '#4a3024', Nightfall: '#2f2926', Ash: '#a39a8d', Oatmeal: '#b9a58a',
  Clove: '#6e4d3a', Cola: '#4d3326', Nutmeg: '#8a5a3a', Unfinished: '#e0c79a',
  Anchor: '#4b3f38', Buckboard: '#a9743f', Churro: '#7a4a2d', Derby: '#8d7f72', Fallow: '#9a6b3f', Karoo: '#5a3b2a', Mane: '#6f6358',
  'Sand Castle': '#d3b98e', Trellis: '#8a7a68', Wren: '#6e4630',
  // paints
  'Bright White': '#f6f6f3', 'Oyster White': '#e9e5d8', Glacier: '#dfe5e6', Divinity: '#efece4', Alabaster: '#efe9dc', 'Gray Mist': '#c3c8c9',
  Pebble: '#b7b2a8', Whisper: '#d9d5cd', Dove: '#c8cacb', Willow: '#9aa09c', 'Mink Gray': '#8a8680', Aqua: '#9cc4c4', Cape: '#8aa3b5',
  Sapphire: '#3d5d82', Bleu: '#6f93b5', Olive: '#7a7d5c', Celtic: '#4f6f66', Midnight: '#222c3a', Onyx: '#2a2c2e',
  Alpine: '#f1f1ec', 'French Vanilla': '#efe3c8', Haven: '#8fa396', Iceberg: '#dfe6e8', Lakeside: '#7d95a1', Mesa: '#b89678', Mystic: '#ebe8e0',
  Sailboat: '#9fbcc8', Wisp: '#b7b39a', Woodland: '#a39b8d',
};
const GLAZE_WORDS = ['Java', 'Slate', 'Charcoal', 'Pewter', 'Granite', 'Sable'];
function hexFor(name: string): string {
  if (HEX[name]) return HEX[name];
  const noGlaze = name.replace(/ w\/ (Brownstone|Ebony)$/, '');
  if (HEX[noGlaze]) return sh(HEX[noGlaze], 0.88);
  const words = name.split(' '); const last = words[words.length - 1];
  if (GLAZE_WORDS.includes(last) && HEX[words.slice(0, -1).join(' ')]) return sh(HEX[words.slice(0, -1).join(' ')], 0.88);
  return sh(HEX[words[0]] || '#8a7a68', 0.9);
}

export interface FinishGroup { title: string; open: boolean; items: Swatch[] }
export const LINES: Array<[string, string]> = [['', 'Simple colors'], ['hc', 'Homecrest'], ['wsel', 'Wellborn Select'], ['wprem', 'Wellborn Premier']];
const LINE_NAME: Record<string, string> = { hc: 'Homecrest', wsel: 'Wellborn Select', wprem: 'Wellborn Premier' };

const list = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);
const HC_STAINS = list('Anchor, Buckboard, Churro, Derby, Fallow, Karoo, Mane, Natural, Sand Castle, Trellis, Wren, Unfinished');
const HC_PAINTS = list('Alpine, French Vanilla, Haven, Iceberg, Lakeside, Mesa, Mystic, Onyx, Sailboat, Willow, Wisp, Woodland');
const glazed = (names: string[], skip: string[]) => names.filter(n => !skip.includes(n)).flatMap(n => [n + ' w/ Brownstone', n + ' w/ Ebony']);

const DATA: Record<string, Array<[string, string[], boolean]>> = {
  hc: [
    ['Stains', HC_STAINS, true], ['Paints', HC_PAINTS, true],
    ['Stains with glaze (Brownstone or Ebony)', glazed(HC_STAINS.filter(n => n !== 'Unfinished'), ['Derby', 'Mane']), false],
    ['Paints with glaze (Brownstone or Ebony)', glazed(HC_PAINTS, ['Lakeside', 'Onyx']), false],
  ],
  wsel: [
    ['Stains', list('Boardwalk, Caramel, Castle, Clove, Coffee, Cola, Dark, Drift, Espresso, Light, Medium, Natural, Nightfall, Peppermill, River Rock, Unfinished'), true],
    ['Paints', list('Alabaster, Bleu, Bright White, Cape, Divinity, Dove, Glacier, Gray Mist, Olive, Onyx, Pebble, Whisper, Willow'), true],
    ['Stains with glaze', list('Caramel Java, Cola Charcoal, Honey Java, Light Java, Natural Java'), false],
    ['Paints with glaze', list('Bright White Java, Divinity Java, Dove Slate, Glacier Java, Olive Pewter, Pebble Java, Gray Mist Granite'), false],
  ],
  wprem: [
    ['Stains', list('Natural, Light, Ginger, Medium, Dark, Caramel, Sable, Shale, Boardwalk, River Rock, Drift, Peppermill, Castle, Gauntlet, Sienna, Espresso, Coffee, Nightfall, Ash, Oatmeal'), true],
    ['Paints', list('Bright White, Oyster White, Glacier, Divinity, Alabaster, Gray Mist, Pebble, Whisper, Dove, Willow, Mink Gray, Aqua, Cape, Sapphire, Bleu, Olive, Celtic, Midnight, Onyx'), true],
    ['Stains with glaze', list('Natural Slate, Natural Java, Light Slate, Light Charcoal, Light Java, Honey Java, Ginger Java, Ginger Charcoal, Nutmeg Java, Dark Charcoal, Caramel Java, Sable Charcoal, Shale Granite, Oatmeal Slate, Oatmeal Charcoal, Oatmeal Java, River Rock Charcoal, Drift Pewter, Drift Slate, Drift Java, Castle Charcoal, Ash Charcoal, Gauntlet Charcoal, Gauntlet Java, Sienna Charcoal, Nightfall Pewter'), false],
    ['Paints with glaze', list('Bright White Java, Oyster White Granite, Oyster White Java, Glacier Pewter, Glacier Java, Divinity Java, Gray Mist Granite, Gray Mist Java, Pebble Pewter, Pebble Java, Whisper Granite, Dove Pewter, Dove Slate, Dove Java, Willow Slate, Willow Java, Mink Gray Granite, Mink Gray Java, Aqua Granite, Aqua Java, Cape Charcoal, Sapphire Granite, Sapphire Java, Bleu Java, Olive Pewter, Celtic Charcoal'), false],
  ],
};

/** The finishes for one line, in groups (the glazed ones start folded away). Ids look like "hc:Alpine". */
export function lineGroups(line: string): FinishGroup[] {
  return (DATA[line] || []).map(([title, names, open]) => ({ title, open, items: names.map(n => ({ id: line + ':' + n, name: n, hex: hexFor(n) })) }));
}
/** Look up a finish by id ("hc:Alpine") across all lines. */
export function findLineFinish(id: string | undefined): { name: string; hex: string; line: string } | undefined {
  if (!id || id.indexOf(':') < 0) return undefined;
  const [line, ...rest] = id.split(':'); const name = rest.join(':');
  if (!LINE_NAME[line]) return undefined;
  return { name, hex: hexFor(name), line: LINE_NAME[line] };
}
